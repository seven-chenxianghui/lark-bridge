import * as Lark from "@larksuiteoapi/node-sdk";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as AgentLifecycle from "./agent-lifecycle.js";
import { parseAuthorizationCardAction, parseTaskCardAction } from "./card-actions.js";
import { loadCodexDisplayConfig } from "./codex-display-config.js";
import {
	bridgeHelpText,
	gateInboundMessage,
	parseBridgeCommand,
	RESET_REPLY,
	unknownSlashReply,
} from "./bridge-commands.js";
import * as ThreadContext from "./thread-context.js";
import * as TopicAgent from "./topic-agent.js";
import { createChatMemoryRepo, formatMemory } from "./chat-memory.js";
import { parseFeishuMessage } from "./feishu-message.js";
import { createScheduler, formatDuration, parseDuration, type ScheduledTask } from "./scheduler.js";
import { applyAgentEvent, createTaskProgress, renderProgress, renderTaskSummary, type TaskProgress } from "./task-progress.js";
import { buildCard, type CardButton, type CardHeader } from "./feishu-card.js";
import { buildTaskCardElements, splitResultText, taskCardSubtitle, type CardElement, type TaskCardMeta, type TaskCardState } from "./task-card.js";
import { createTaskCounter } from "./task-counter.js";
import { createTopicSessionRepo } from "./topic-session.js";
import { changedFiles, snapshotWorkspace } from "./workspace-changes.js";
import { formatValidationSummary, runProjectValidation, validationFailurePrompt, type ValidationResult } from "./project-validation.js";
import { createSteeringQueue } from "./steering.js";
import { createPendingPlanRepo } from "./pending-plan.js";
import { CodexAppServer } from "./codex-app-server.js";
import { safeAttachmentName } from "./attachments.js";
import { createAccessControlRepo } from "./access-control.js";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG_PATH = resolve(ROOT, "config/bridge.env");
const runtimeDir = process.env.RUNTIME_DIR || (process.platform === "win32"
	? resolve(ROOT, "..", ".seven-lark-runtime")
	: resolve(process.env.HOME || ROOT, ".seven-lark-runtime"));
mkdirSync(resolve(runtimeDir, "state"), { recursive: true });
const attachmentsDir = resolve(runtimeDir, "attachments");
mkdirSync(attachmentsDir, { recursive: true });

function readConfig(): { appId: string; appSecret: string; ownerOpenId: string } {
	if (!existsSync(CONFIG_PATH)) throw new Error(`配置文件不存在: ${CONFIG_PATH}`);
	const values: Record<string, string> = {};
	for (const raw of readFileSync(CONFIG_PATH, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const index = line.indexOf("=");
		if (index < 0) continue;
		values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
	}
	const appId = values.FEISHU_APP_ID || "";
	const appSecret = values.FEISHU_APP_SECRET || "";
	if (!appId || !appSecret) throw new Error("请在 config/bridge.env 中填写飞书 App ID 和 App Secret");
	return { appId, appSecret, ownerOpenId: values.FEISHU_OWNER_OPEN_ID || "" };
}

const config = readConfig();
const sessions = createTopicSessionRepo(runtimeDir);
const memory = createChatMemoryRepo(runtimeDir);
const access = createAccessControlRepo(runtimeDir, config.ownerOpenId);
if (!access.ownerOpenId()) {
	const knownPrivateOpenIds = memory.privateOpenIds();
	if (knownPrivateOpenIds.length === 1) {
		access.setOwner(knownPrivateOpenIds[0]);
		console.log("[权限] 已从现有唯一私聊历史迁移管理员身份");
	} else {
		console.error("[权限] 无法唯一确定管理员，请在 config/bridge.env 设置 FEISHU_OWNER_OPEN_ID");
	}
}
const taskCounter = createTaskCounter(runtimeDir);
const steering = createSteeringQueue();
const pendingPlans = createPendingPlanRepo(runtimeDir);
const codexDisplay = loadCodexDisplayConfig();
const codexWritableRoot = process.env.CODEX_WRITABLE_ROOT || (process.platform === "win32" ? "D:\\Seven" : resolve(ROOT, ".."));
const codexAppServer = new CodexAppServer({ cwd: ROOT, writableRoot: codexWritableRoot });
const client = new Lark.Client({
	appId: config.appId,
	appSecret: config.appSecret,
	domain: Lark.Domain.Feishu,
});

type FeishuMention = { key?: string; id?: string | { open_id?: string }; name?: string };

function taskButtons(topicKey: string, running: boolean): CardButton[] {
	return running
		? [{ text: "停止当前任务", action: "stop", topicKey, type: "danger" }]
		: [{ text: "新建会话", action: "reset", topicKey, type: "primary" }];
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt < 3) await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 400));
		}
	}
	throw lastError;
}

async function replyCard(
	messageId: string,
	markdown: string,
	header?: CardHeader,
	buttons: CardButton[] = [],
	elements: CardElement[] = [],
): Promise<string | undefined> {
	try {
		const response = await retry(() => client.im.message.reply({
			path: { message_id: messageId },
			data: { msg_type: "interactive", content: buildCard(markdown, header, buttons, elements) },
		}));
		return response.data?.message_id;
	} catch (error) {
		console.error("[飞书] 回复失败", error);
		try {
			const response = await client.im.message.reply({
				path: { message_id: messageId },
				data: { msg_type: "text", content: JSON.stringify({ text: markdown }) },
			});
			return response.data?.message_id;
		} catch (fallbackError) {
			console.error("[飞书] 纯文本回退失败", fallbackError);
		}
		return undefined;
	}
}

async function sendCardToOpenId(
	openId: string,
	markdown: string,
	header?: CardHeader,
	buttons: CardButton[] = [],
): Promise<string | undefined> {
	const response = await retry(() => client.im.message.create({
		params: { receive_id_type: "open_id" },
		data: { receive_id: openId, msg_type: "interactive", content: buildCard(markdown, header, buttons) },
	}));
	return response.data?.message_id;
}

async function requestAuthorization(senderOpenId: string, messageId: string, requestText: string): Promise<void> {
	const ownerOpenId = access.ownerOpenId();
	if (!ownerOpenId) {
		await replyCard(messageId, "机器人尚未绑定管理员，当前不会执行任何本机任务。", { title: "权限未初始化", color: "red" });
		return;
	}
	const state = access.request(senderOpenId, messageId, requestText);
	if (state === "authorized") return;
	if (state === "created") {
		try {
			await sendCardToOpenId(
				ownerOpenId,
				[
					"有用户申请在群聊话题中调用本机 Codex。",
					`- 申请人 OPEN_ID：\`${senderOpenId}\``,
					`- 请求内容：${requestText.slice(0, 500) || "（附件或图片任务）"}`,
				].join("\n"),
				{ title: "Codex 使用授权申请", color: "orange" },
				[
					{ text: "批准", action: "approve-access", value: { applicantOpenId: senderOpenId }, type: "primary" },
					{ text: "拒绝", action: "reject-access", value: { applicantOpenId: senderOpenId }, type: "danger" },
				],
			);
		} catch (error) {
			console.error("[权限] 发送管理员审批卡失败", error);
			access.decide(senderOpenId, false);
			await replyCard(messageId, "授权申请保存成功，但通知管理员失败，请稍后重新申请。", { title: "等待授权", color: "orange" });
			return;
		}
	}
	await replyCard(
		messageId,
		state === "created" ? "授权申请已发送给管理员，批准后才能在群聊话题中调用 Codex。" : "授权申请正在等待管理员处理。",
		{ title: "等待授权", color: "orange" },
	);
}

async function updateCard(
	messageId: string,
	markdown: string,
	header?: CardHeader,
	buttons: CardButton[] = [],
	elements: CardElement[] = [],
): Promise<boolean> {
	try {
		await retry(() => client.im.message.patch({
			path: { message_id: messageId },
			data: { content: buildCard(markdown, header, buttons, elements) },
		}));
		return true;
	} catch (error) {
		console.error("[飞书] 更新卡片失败", error);
		return false;
	}
}

function gitValue(args: string[]): string {
	const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
	return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function createTaskMeta(topicKey: string, request: string, taskId = randomUUID().slice(0, 6), attachments: string[] = []): TaskCardMeta {
	return {
		taskId,
		turn: taskCounter.next(topicKey),
		project: basename(ROOT),
		branch: gitValue(["branch", "--show-current"]) || gitValue(["rev-parse", "--short", "HEAD"]) || "未识别",
		request,
		attachments,
		...codexDisplay,
	};
}

function taskHeader(state: TaskCardState, meta?: TaskCardMeta): CardHeader {
	const subtitle = meta ? taskCardSubtitle(meta) : undefined;
	if (state === "complete") return { title: "Codex Remote", status: "已完成", subtitle, color: "green" };
	if (state === "stopped") return { title: "Codex Remote", status: "已停止", subtitle, color: "orange" };
	if (state === "failed") return { title: "Codex Remote", status: "执行失败", subtitle, color: "red" };
	return { title: "Codex Remote", status: "执行中", subtitle, color: "blue" };
}

async function updateTaskCard(
	cardId: string | undefined,
	topicKey: string,
	meta: TaskCardMeta,
	progress: TaskProgress,
	state: TaskCardState,
	summary = "",
): Promise<boolean> {
	if (!cardId) return false;
	return updateCard(cardId, "", taskHeader(state, meta), taskButtons(topicKey, state === "running"), buildTaskCardElements(meta, progress, state, summary));
}

async function deliverResultContinuations(messageId: string, text: string, title = "Codex Remote"): Promise<void> {
	const chunks = splitResultText(text.trim());
	for (let index = 1; index < chunks.length; index++) {
		await replyCard(messageId, chunks[index], { title: `${title} · ${index + 1}/${chunks.length}` });
	}
}

async function deliverTaskResult(
	messageId: string,
	cardId: string | undefined,
	topicKey: string,
	meta: TaskCardMeta,
	progress: TaskProgress,
	text: string,
	summary: string,
	state: "complete" | "failed" = "complete",
): Promise<void> {
	const result = text.trim() || "(Codex 已完成，无文本回复)";
	progress.liveOutput = result;
	const updated = await updateTaskCard(cardId, topicKey, meta, progress, state, summary);
	if (!updated) {
		await replyCard(
			messageId,
			`${result}\n\n${summary}`,
			taskHeader(state, meta),
			taskButtons(topicKey, false),
			buildTaskCardElements(meta, progress, state, summary),
		);
	}
	await deliverResultContinuations(messageId, result);
}

function createProgressReporter(cardId: string | undefined, topicKey: string, meta: TaskCardMeta, progress: TaskProgress) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let lastUpdate = 0;
	let closed = false;
	let updates = Promise.resolve();
	const flush = (): void => {
		if (closed || !cardId) return;
		lastUpdate = Date.now();
		updates = updates.then(async () => {
			await updateTaskCard(cardId, topicKey, meta, progress, "running");
		});
	};
	if (cardId) ticker = setInterval(flush, 10_000);
	return {
		push(event: Record<string, unknown>): void {
			applyAgentEvent(progress, event);
			if (!cardId || closed) return;
			const wait = Math.max(0, 1200 - (Date.now() - lastUpdate));
			if (!wait) flush();
			else if (!timer) timer = setTimeout(() => { timer = undefined; flush(); }, wait);
		},
		async close(): Promise<void> {
			closed = true;
			if (timer) clearTimeout(timer);
			if (ticker) clearInterval(ticker);
			await updates;
		},
	};
}

AgentLifecycle.initGracefulShutdown(async (cardId, markdown) => {
	await updateCard(cardId, markdown, { title: "服务重启", color: "orange" });
});

let botOpenId = "";
let botName = "";

async function loadBotIdentity(): Promise<void> {
	try {
		const response = await client.request({ url: "/open-apis/bot/v3/info", method: "GET" }) as {
			bot?: { open_id?: string; app_name?: string };
		};
		botOpenId = response.bot?.open_id || "";
		botName = response.bot?.app_name || "";
		console.log(`[飞书] 机器人已就绪: ${botName || botOpenId}`);
	} catch (error) {
		console.warn("[飞书] 获取机器人身份失败，将在群消息到达时重试", error);
	}
}

function isBotMentioned(mentions: FeishuMention[]): boolean {
	return mentions.some((mention) => {
		const id = typeof mention.id === "string" ? mention.id : mention.id?.open_id;
		return Boolean((botOpenId && id === botOpenId) || (botName && mention.name === botName));
	});
}

function stripMentions(text: string, mentions: FeishuMention[]): string {
	let result = text;
	for (const mention of mentions) {
		if (mention.key) result = result.split(mention.key).join("");
	}
	return result.replace(/\s+/g, " ").trim();
}

async function downloadImage(messageId: string, imageKey: string): Promise<string> {
	const path = resolve(attachmentsDir, `${randomUUID()}.png`);
	const response = await (client.im.messageResource.get as unknown as (input: unknown) => Promise<unknown>)({
		path: { message_id: messageId, file_key: imageKey },
		params: { type: "image" },
	});
	const resource = response as { writeFile?: (path: string) => Promise<void>; data?: unknown };
	if (typeof resource.writeFile === "function") await resource.writeFile(path);
	else if (Buffer.isBuffer(response)) writeFileSync(path, response);
	else if (Buffer.isBuffer(resource.data)) writeFileSync(path, resource.data);
	else throw new Error("飞书图片下载返回了未知格式");
	return path;
}

async function downloadFile(messageId: string, fileKey: string, fileName: string): Promise<string> {
	const path = resolve(attachmentsDir, `${randomUUID()}-${safeAttachmentName(fileName)}`);
	const response = await (client.im.messageResource.get as unknown as (input: unknown) => Promise<unknown>)({
		path: { message_id: messageId, file_key: fileKey },
		params: { type: "file" },
	});
	const resource = response as { writeFile?: (path: string) => Promise<void>; data?: unknown };
	if (typeof resource.writeFile === "function") await resource.writeFile(path);
	else if (Buffer.isBuffer(response)) writeFileSync(path, response);
	else if (Buffer.isBuffer(resource.data)) writeFileSync(path, resource.data);
	else throw new Error("飞书文件下载返回了未知格式");
	if (statSync(path).size > 20 * 1024 * 1024) {
		try { unlinkSync(path); } catch {}
		throw new Error("单个文件不能超过 20 MB");
	}
	return path;
}

type AgentResult = { result: string; sessionId?: string };

function runCodex(
	topicKey: string,
	prompt: string,
	sessionId: string | undefined,
	imagePaths: string[],
	cardId: string | undefined,
	onEvent?: (event: Record<string, unknown>) => void,
	mode = "agent",
): Promise<AgentResult> {
	const lockKey = TopicAgent.topicLockKey(topicKey);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const execution = codexAppServer.runTurn({
		topicKey,
		threadId: sessionId,
		prompt,
		imagePaths,
		mode: mode === "ask" ? "read-only" : "workspace-write",
		onEvent,
		onStarted: (threadId) => {
			sessions.set(topicKey, threadId);
			onEvent?.({ type: "system", session_id: threadId });
			AgentLifecycle.registerAgent(lockKey, {
				pid: codexAppServer.pid || process.pid,
				cardId,
				kill: () => { void codexAppServer.interrupt(topicKey); },
			});
		},
	});
	const expired = new Promise<never>((_, rejectExpired) => {
		timeout = setTimeout(() => {
			void codexAppServer.interrupt(topicKey);
			rejectExpired(new Error("Codex 执行超过 60 分钟，已终止"));
		}, 60 * 60 * 1000);
	});
	return Promise.race([execution, expired])
		.then((output) => ({ result: output.result, sessionId: output.threadId }))
		.finally(() => {
			if (timeout) clearTimeout(timeout);
			AgentLifecycle.unregisterAgent(lockKey);
		});
}

async function executeTask(
	topicKey: string,
	prompt: string,
	freshPrompt: string,
	imagePaths: string[] = [],
	cardId?: string,
	onEvent?: (event: Record<string, unknown>) => void,
	mode = "agent",
): Promise<AgentResult & { renewed: boolean }> {
	const release = await TopicAgent.acquireTopicParallelSlot(topicKey);
	try {
		const currentSession = sessions.get(topicKey);
		try {
			const output = await runCodex(topicKey, currentSession ? prompt : freshPrompt, currentSession, imagePaths, cardId, onEvent, mode);
			if (output.sessionId) sessions.set(topicKey, output.sessionId);
			return { ...output, renewed: false };
		} catch (error) {
			if (steering.has(topicKey) || stopRequestedTopics.has(topicKey) || AgentLifecycle.isShuttingDown()) throw error;
			if (!currentSession) {
				sessions.clear(topicKey);
				throw error;
			}
			console.warn(`[Codex] Session 续接失败，创建新会话: ${String(error)}`);
			sessions.clear(topicKey);
			const output = await runCodex(topicKey, freshPrompt, undefined, imagePaths, cardId, onEvent, mode);
			if (output.sessionId) sessions.set(topicKey, output.sessionId);
			return { ...output, renewed: true };
		}
	} finally {
		release();
	}
}

const seenMessages = new Map<string, number>();
const stopRequestedTopics = new Set<string>();
const activeTaskViews = new Map<string, { meta: TaskCardMeta; progress: TaskProgress }>();
const validationControllers = new Map<string, AbortController>();

function requestStop(topicKey: string): boolean {
	steering.clear(topicKey);
	const active = AgentLifecycle.getActiveAgent(TopicAgent.topicLockKey(topicKey));
	const validation = validationControllers.get(topicKey);
	if (!active && !validation) return false;
	stopRequestedTopics.add(topicKey);
	active?.kill();
	validation?.abort();
	return true;
}

function isDuplicate(messageId: string): boolean {
	const now = Date.now();
	for (const [id, time] of seenMessages) if (now - time > 5 * 60_000) seenMessages.delete(id);
	if (seenMessages.has(messageId)) return true;
	seenMessages.set(messageId, now);
	return false;
}

type GuidedTaskResult = AgentResult & {
	renewed: boolean;
	validation?: ValidationResult;
};

async function executeGuidedTask(input: {
	topicKey: string;
	prompt: string;
	freshPrompt: string;
	imagePaths: string[];
	cardId?: string;
	meta: TaskCardMeta;
	progress: TaskProgress;
	workspaceBefore: ReturnType<typeof snapshotWorkspace>;
}): Promise<GuidedTaskResult> {
	let prompt = input.prompt;
	let freshPrompt = input.freshPrompt;
	let imagePaths = input.imagePaths;
	let renewed = false;
	let repairAttempts = 0;

	while (true) {
		const queuedGuide = steering.consume(input.topicKey);
		if (queuedGuide) {
			stopRequestedTopics.delete(input.topicKey);
			memory.append(input.topicKey, "user", `[中途引导]\n${queuedGuide}`);
			input.progress.phase = "queued";
			input.progress.liveOutput = `${input.progress.liveOutput}${input.progress.liveOutput ? "\n\n" : ""}已收到补充指令，继续处理。`;
			await updateTaskCard(input.cardId, input.topicKey, input.meta, input.progress, "running");
			prompt = `[中途引导]\n${queuedGuide}`;
			freshPrompt = `${formatMemory(memory.get(input.topicKey))}${prompt}`;
			imagePaths = [];
		}
		const reporter = createProgressReporter(input.cardId, input.topicKey, input.meta, input.progress);
		let output: AgentResult & { renewed: boolean };
		try {
			output = await executeTask(
				input.topicKey,
				prompt,
				freshPrompt,
				imagePaths,
				input.cardId,
				(event) => reporter.push(event),
			);
			await reporter.close();
		} catch (error) {
			await reporter.close();
			if (!steering.has(input.topicKey)) throw error;
			continue;
		}

		renewed ||= output.renewed;
		const files = changedFiles(input.workspaceBefore, snapshotWorkspace(ROOT));
		let validation: ValidationResult | undefined;
		if (files.length) {
			input.progress.phase = "working";
			input.progress.liveOutput = `${input.progress.liveOutput}${input.progress.liveOutput ? "\n\n" : ""}代码变更已完成，正在自动运行项目验收。`;
			await updateTaskCard(input.cardId, input.topicKey, input.meta, input.progress, "running");
			const controller = new AbortController();
			validationControllers.set(input.topicKey, controller);
			try {
				validation = await runProjectValidation(ROOT, 10 * 60_000, controller.signal);
			} finally {
				if (validationControllers.get(input.topicKey) === controller) validationControllers.delete(input.topicKey);
			}
		}
		if (stopRequestedTopics.has(input.topicKey)) throw new Error("Task stopped during validation");
		if (steering.has(input.topicKey)) continue;
		if (validation && !validation.ok && repairAttempts < 1) {
			repairAttempts++;
			const repairPrompt = validationFailurePrompt(validation);
			memory.append(input.topicKey, "user", repairPrompt);
			input.progress.phase = "queued";
			input.progress.liveOutput = `${input.progress.liveOutput}\n\n自动验收未通过，正在让 Codex 修复一次。`;
			await updateTaskCard(input.cardId, input.topicKey, input.meta, input.progress, "running");
			prompt = repairPrompt;
			freshPrompt = `${formatMemory(memory.get(input.topicKey))}${repairPrompt}`;
			imagePaths = [];
			continue;
		}
		return { ...output, renewed, validation };
	}
}

type InboundMessage = {
	messageId: string;
	chatId: string;
	chatType: string;
	threadId?: string;
	topicKey: string;
	text: string;
	imageKeys: string[];
	files: Array<{ key: string; name: string }>;
};

async function executePlanRequest(input: InboundMessage, request: string): Promise<void> {
	if (activeTaskViews.has(input.topicKey)) {
		await replyCard(input.messageId, "当前已有任务执行中，请先停止或等待完成后再创建计划。", { title: "计划模式", color: "orange" });
		return;
	}
	let prompt = `${ThreadContext.isolationBanner(input.chatId, input.threadId)}\n\n[计划模式]\n${request}\n\n只读分析项目并给出可执行计划、影响文件和验收方式。不要修改文件。`;
	if (input.chatType === "group" && input.threadId) {
		const context = await ThreadContext.buildThreadContextPrefix(client as never, {
			chatId: input.chatId,
			threadId: input.threadId,
			currentMessageId: input.messageId,
		});
		if (context) prompt = `${context}\n\n[计划模式]\n${request}\n\n只读分析项目并给出可执行计划、影响文件和验收方式。不要修改文件。`;
	}

	const history = memory.get(input.topicKey);
	const progress = createTaskProgress();
	const meta = createTaskMeta(input.topicKey, `计划：${request}`);
	const cardId = await replyCard(
		input.messageId,
		renderProgress(progress),
		{ title: "Codex Plan", status: "分析中", subtitle: taskCardSubtitle(meta), color: "blue" },
		taskButtons(input.topicKey, true),
		buildTaskCardElements(meta, progress, "running"),
	);
	activeTaskViews.set(input.topicKey, { meta, progress });
	memory.append(input.topicKey, "user", `[计划模式]\n${request}`);
	const reporter = createProgressReporter(cardId, input.topicKey, meta, progress);
	try {
		const output = await executeTask(input.topicKey, prompt, `${formatMemory(history)}${prompt}`, [], cardId, (event) => reporter.push(event), "ask");
		await reporter.close();
		stopRequestedTopics.delete(input.topicKey);
		memory.append(input.topicKey, "assistant", output.result);
		pendingPlans.set(input.topicKey, request);
		progress.liveOutput = output.result;
		const buttons: CardButton[] = [
			{ text: "批准执行", action: "approve-plan", topicKey: input.topicKey, type: "primary" },
			{ text: "放弃计划", action: "discard-plan", topicKey: input.topicKey, type: "danger" },
		];
		const header = { title: "Codex Plan", status: "等待批准", subtitle: taskCardSubtitle(meta), color: "yellow" };
		const elements = buildTaskCardElements(meta, progress, "complete", "**下一步**\n批准后将在同一 Codex Session 中执行，并自动运行项目验收。");
		if (cardId) await updateCard(cardId, "", header, buttons, elements);
		else await replyCard(input.messageId, "", header, buttons, elements);
		await deliverResultContinuations(input.messageId, output.result, "Codex Plan");
	} catch (error) {
		await reporter.close();
		if (stopRequestedTopics.delete(input.topicKey)) {
			progress.liveOutput = `${progress.liveOutput}${progress.liveOutput ? "\n\n" : ""}计划分析已由用户停止。`;
			await updateTaskCard(cardId, input.topicKey, meta, progress, "stopped");
			return;
		}
		console.error("[计划] 分析失败", error);
		progress.liveOutput = "计划分析失败，请查看本机日志。";
		await updateTaskCard(cardId, input.topicKey, meta, progress, "failed");
	} finally {
		activeTaskViews.delete(input.topicKey);
	}
}

async function executeApprovedPlan(messageId: string, topicKey: string, request: string): Promise<void> {
	const prompt = `[计划已由用户批准]\n${request}\n\n请根据上一轮计划直接完成项目修改，并确保实现满足需求。`;
	const history = memory.get(topicKey);
	const progress = createTaskProgress();
	const meta = createTaskMeta(topicKey, request);
	const cardId = await replyCard(messageId, renderProgress(progress), taskHeader("running", meta), taskButtons(topicKey, true), buildTaskCardElements(meta, progress, "running"));
	const workspaceBefore = snapshotWorkspace(ROOT);
	activeTaskViews.set(topicKey, { meta, progress });
	memory.append(topicKey, "user", `[批准执行]\n${request}`);
	try {
		const output = await executeGuidedTask({
			topicKey,
			prompt,
			freshPrompt: `${formatMemory(history)}${prompt}`,
			imagePaths: [],
			cardId,
			meta,
			progress,
			workspaceBefore,
		});
		stopRequestedTopics.delete(topicKey);
		memory.append(topicKey, "assistant", output.result);
		const files = changedFiles(workspaceBefore, snapshotWorkspace(ROOT));
		const validationSummary = output.validation ? `\n\n${formatValidationSummary(output.validation)}` : "";
		const summary = `${renderTaskSummary(progress, files, output.renewed)}${validationSummary}`;
		await deliverTaskResult(messageId, cardId, topicKey, meta, progress, output.result, summary, output.validation?.ok === false ? "failed" : "complete");
	} catch (error) {
		if (stopRequestedTopics.delete(topicKey)) {
			progress.liveOutput = `${progress.liveOutput}${progress.liveOutput ? "\n\n" : ""}任务已由用户停止。`;
			await updateTaskCard(cardId, topicKey, meta, progress, "stopped");
			return;
		}
		console.error("[计划] 执行失败", error);
		progress.liveOutput = "任务执行失败，请查看本机日志。";
		await updateTaskCard(cardId, topicKey, meta, progress, "failed");
	} finally {
		activeTaskViews.delete(topicKey);
		steering.clear(topicKey);
	}
}

async function handleMessage(input: InboundMessage): Promise<void> {
	const command = parseBridgeCommand(input.text);
	if (!input.imageKeys.length && !input.files.length && command.kind === "help") return void await replyCard(input.messageId, bridgeHelpText(), { title: "帮助" });
	if (command.kind === "reset") {
		if (activeTaskViews.has(input.topicKey)) {
			return void await replyCard(input.messageId, "请先停止当前任务，再新建会话。", { title: "任务执行中", color: "orange" });
		}
		sessions.clear(input.topicKey);
		memory.clear(input.topicKey);
		taskCounter.clear(input.topicKey);
		pendingPlans.clear(input.topicKey);
		return void await replyCard(input.messageId, RESET_REPLY, { title: "新会话" });
	}
	if (command.kind === "status") {
		const view = activeTaskViews.get(input.topicKey);
		const pendingPlan = pendingPlans.get(input.topicKey);
		const running = Boolean(view);
		return void await replyCard(
			input.messageId,
			[
				"**当前话题**",
				`- 状态：${running ? "Codex 正在执行" : "空闲"}`,
				...(view ? [
					`- 任务：${view.meta.request.slice(0, 80)}`,
				] : []),
				...(pendingPlan ? [`- 待批准计划：${pendingPlan.prompt.slice(0, 120)}`] : []),
				`- Turn：${taskCounter.get(input.topicKey)}`,
			].join("\n"),
			{ title: "任务状态", color: running ? "blue" : "green" },
			taskButtons(input.topicKey, running),
		);
	}
	if (command.kind === "stop") {
		const stopped = requestStop(input.topicKey);
		return void await replyCard(input.messageId, stopped ? "已请求停止当前任务。" : "当前没有正在执行的任务。", { title: "终止" });
	}
	if (command.kind === "memorySearch") {
		const total = memory.count(input.topicKey);
		if (!command.query) {
			return void await replyCard(input.messageId, `当前话题共有 **${total}** 条 SQLite 记忆。\n发送 \`/记忆 <关键词>\` 可查询。`, { title: "聊天记忆" });
		}
		const results = memory.search(input.topicKey, command.query, 3);
		const body = results.length
			? results.map((item, index) => `${index + 1}. **${item.role === "user" ? "用户" : "Codex"}**\n${item.text.slice(0, 200)}`).join("\n\n")
			: `没有找到与 **${command.query}** 相关的记忆。`;
		return void await replyCard(input.messageId, body, { title: `记忆查询 · ${total} 条` });
	}
	if (command.kind === "plan") {
		return void await executePlanRequest(input, command.prompt);
	}
	if (command.kind === "unknown") {
		return void await replyCard(input.messageId, unknownSlashReply(command.cmd), { title: "未知指令", color: "orange" });
	}
	if (command.kind === "schedule") {
		const intervalMs = parseDuration(command.duration);
		if (!intervalMs) return void await replyCard(input.messageId, "周期格式无效，请使用 `30m`、`2h` 或 `1d`。", { title: "定时任务", color: "orange" });
		const task = scheduler.add({ topicKey: input.topicKey, messageId: input.messageId, intervalMs, prompt: command.prompt });
		return void await replyCard(input.messageId, `已创建定时任务 \`${task.id}\`，每 ${formatDuration(intervalMs)} 执行一次。`, { title: "定时任务" });
	}
	if (command.kind === "scheduleList") {
		const tasks = scheduler.list(input.topicKey);
		const body = tasks.length ? tasks.map((task) => `- \`${task.id}\` 每 ${formatDuration(task.intervalMs)}：${task.prompt}`).join("\n") : "当前话题没有定时任务。";
		return void await replyCard(input.messageId, body, { title: "定时任务" });
	}
	if (command.kind === "scheduleCancel") {
		const removed = scheduler.remove(input.topicKey, command.id);
		return void await replyCard(input.messageId, removed ? `已删除定时任务 \`${command.id}\`。` : `未找到定时任务 \`${command.id}\`。`, { title: "定时任务", color: removed ? "green" : "orange" });
	}

	if (!input.imageKeys.length && !input.files.length && activeTaskViews.has(input.topicKey)) {
		const steered = await codexAppServer.steer(input.topicKey, input.text);
		if (steered) memory.append(input.topicKey, "user", `[中途引导]\n${input.text}`);
		else steering.enqueue(input.topicKey, input.text);
		return void await replyCard(
			input.messageId,
			steered
				? "已收到补充指令，正在处理。"
				: "已收到补充指令，当前阶段结束后继续处理。",
			{ title: "中途引导", color: "blue" },
		);
	}

	pendingPlans.clear(input.topicKey);
	const userText = input.text || (input.files.length ? "请读取附件并根据附件内容完成相关任务。" : "请分析图片内容，并根据图片完成相关任务。");
	let prompt = `${ThreadContext.isolationBanner(input.chatId, input.threadId)}\n\n[当前用户请求]\n${userText}`;
	if (input.chatType === "group" && input.threadId) {
		const context = await ThreadContext.buildThreadContextPrefix(client as never, {
			chatId: input.chatId,
			threadId: input.threadId,
			currentMessageId: input.messageId,
		});
		if (context) prompt = `${context}\n${userText}`;
	}

	const progress = createTaskProgress();
	const meta = createTaskMeta(
		input.topicKey,
		userText,
		undefined,
		[
			...input.imageKeys.map((_, index) => `飞书图片 ${index + 1}`),
			...input.files.map((file) => file.name),
		],
	);
	const cardId = await replyCard(
		input.messageId,
		renderProgress(progress),
		taskHeader("running", meta),
		taskButtons(input.topicKey, true),
		buildTaskCardElements(meta, progress, "running"),
	);
	const workspaceBefore = snapshotWorkspace(ROOT);
	const history = memory.get(input.topicKey);
	memory.append(input.topicKey, "user", `${input.imageKeys.length ? `[图片 x${input.imageKeys.length}]\n` : ""}${input.files.length ? `[文件: ${input.files.map((file) => file.name).join(", ")}]\n` : ""}${userText}`);
	const imagePaths: string[] = [];
	const filePaths: string[] = [];
	activeTaskViews.set(input.topicKey, { meta, progress });
	try {
		for (const imageKey of input.imageKeys) imagePaths.push(await downloadImage(input.messageId, imageKey));
		for (const file of input.files) filePaths.push(await downloadFile(input.messageId, file.key, file.name));
		if (filePaths.length) {
			prompt += `\n\n[输入文件]\n${filePaths.map((path) => `- ${path}`).join("\n")}\n请使用本机工具读取这些文件；不要修改原始附件。`;
		}
		const output = await executeGuidedTask({
			topicKey: input.topicKey,
			prompt,
			freshPrompt: `${formatMemory(history)}${prompt}`,
			imagePaths,
			cardId,
			meta,
			progress,
			workspaceBefore,
		});
		stopRequestedTopics.delete(input.topicKey);
		memory.append(input.topicKey, "assistant", output.result);
		const result = output.renewed ? `原会话无法续接，已创建新会话。\n\n${output.result}` : output.result;
		const files = changedFiles(workspaceBefore, snapshotWorkspace(ROOT));
		const validationSummary = output.validation ? `\n\n${formatValidationSummary(output.validation)}` : "";
		const summary = `${renderTaskSummary(progress, files, output.renewed)}${validationSummary}`;
		await deliverTaskResult(input.messageId, cardId, input.topicKey, meta, progress, result, summary, output.validation?.ok === false ? "failed" : "complete");
	} catch (error) {
		if (AgentLifecycle.isShuttingDown()) return;
		if (stopRequestedTopics.delete(input.topicKey)) {
			progress.liveOutput = `${progress.liveOutput}${progress.liveOutput ? "\n\n" : ""}任务已由用户停止。`;
			await updateTaskCard(cardId, input.topicKey, meta, progress, "stopped");
			return;
		}
		console.error("[任务] 执行失败", error);
		progress.liveOutput = "任务执行失败，请查看本机日志。";
		if (cardId) await updateTaskCard(cardId, input.topicKey, meta, progress, "failed");
		else await replyCard(input.messageId, progress.liveOutput, { title: "失败", color: "red" });
	} finally {
		activeTaskViews.delete(input.topicKey);
		steering.clear(input.topicKey);
		for (const path of imagePaths) try { unlinkSync(path); } catch {}
		for (const path of filePaths) try { unlinkSync(path); } catch {}
	}
}

async function executeScheduledTask(task: ScheduledTask): Promise<void> {
	const history = memory.get(task.topicKey);
	const prompt = `[定时任务 ${task.id}]\n${task.prompt}`;
	const progress = createTaskProgress();
	const meta = createTaskMeta(task.topicKey, task.prompt, task.id);
	const cardId = await replyCard(task.messageId, renderProgress(progress), taskHeader("running", meta), taskButtons(task.topicKey, true), buildTaskCardElements(meta, progress, "running"));
	const workspaceBefore = snapshotWorkspace(ROOT);
	memory.append(task.topicKey, "user", prompt);
	try {
		const output = await executeGuidedTask({
			topicKey: task.topicKey,
			prompt,
			freshPrompt: `${formatMemory(history)}${prompt}`,
			imagePaths: [],
			cardId,
			meta,
			progress,
			workspaceBefore,
		});
		stopRequestedTopics.delete(task.topicKey);
		memory.append(task.topicKey, "assistant", output.result);
		const files = changedFiles(workspaceBefore, snapshotWorkspace(ROOT));
		const validationSummary = output.validation ? `\n\n${formatValidationSummary(output.validation)}` : "";
		const summary = `${renderTaskSummary(progress, files, output.renewed)}${validationSummary}`;
		await deliverTaskResult(task.messageId, cardId, task.topicKey, meta, progress, output.result, summary, output.validation?.ok === false ? "failed" : "complete");
	} catch (error) {
		if (stopRequestedTopics.delete(task.topicKey)) {
			progress.liveOutput = `${progress.liveOutput}${progress.liveOutput ? "\n\n" : ""}定时任务已由用户停止。`;
			await updateTaskCard(cardId, task.topicKey, meta, progress, "stopped");
			return;
		}
		console.error("[定时任务] 执行失败", error);
		progress.liveOutput = "任务执行失败，请查看本机日志。";
		if (cardId) await updateTaskCard(cardId, task.topicKey, meta, progress, "failed");
		throw error;
	}
}

const scheduler = createScheduler(runtimeDir, executeScheduledTask);
scheduler.start();

async function handleCardAction(data: unknown): Promise<Record<string, unknown> | undefined> {
	const authorizationAction = parseAuthorizationCardAction(data);
	if (authorizationAction) {
		if (authorizationAction.operatorOpenId !== access.ownerOpenId()) {
			return { toast: { type: "warning", content: "只有管理员可以处理授权申请" } };
		}
		const approved = authorizationAction.action === "approve-access";
		const request = access.decide(authorizationAction.applicantOpenId, approved);
		if (!request) return { toast: { type: "info", content: "该申请已处理或不存在" } };
		await updateCard(
			authorizationAction.messageId,
			`申请人 \`${authorizationAction.applicantOpenId}\` 已${approved ? "获得" : "被拒绝"}群聊使用权限。`,
			{ title: "Codex 使用授权", color: approved ? "green" : "grey" },
		);
		await replyCard(
			request.messageId,
			approved ? "管理员已批准。现在可以在群聊话题中 @机器人执行任务。" : "管理员拒绝了本次使用申请。",
			{ title: approved ? "授权已通过" : "授权未通过", color: approved ? "green" : "red" },
		);
		return { toast: { type: "success", content: approved ? "已批准该用户" : "已拒绝该用户" } };
	}
	const action = parseTaskCardAction(data);
	if (!action) return undefined;
	const event = data as Record<string, unknown>;
	const operator = event.operator as Record<string, unknown> | undefined;
	const operatorOpenId = String(operator?.open_id || "");
	if (!access.isAuthorized(operatorOpenId)) {
		return { toast: { type: "warning", content: "你没有操作该任务的权限" } };
	}
	if (action.action === "approve-plan") {
		if (activeTaskViews.has(action.topicKey)) {
			return { toast: { type: "warning", content: "当前已有任务执行中，请稍后再批准" } };
		}
		const plan = pendingPlans.consume(action.topicKey);
		if (!plan) return { toast: { type: "info", content: "该计划已处理或已失效" } };
		setTimeout(() => {
			void executeApprovedPlan(action.messageId, action.topicKey, plan.prompt)
				.catch((error) => console.error("[计划执行] 启动失败", error));
		}, 0);
		return { toast: { type: "success", content: "计划已批准，本机 Codex 即将开始执行" } };
	}
	if (action.action === "discard-plan") {
		const existed = Boolean(pendingPlans.get(action.topicKey));
		pendingPlans.clear(action.topicKey);
		if (existed) await replyCard(action.messageId, "计划已放弃。可以发送新的任务或使用 `/plan` 重新规划。", { title: "Codex Plan", color: "grey" });
		return { toast: { type: existed ? "success" : "info", content: existed ? "计划已放弃" : "该计划已处理" } };
	}
	if (action.action === "stop") {
		const stopped = requestStop(action.topicKey);
		return { toast: { type: stopped ? "success" : "info", content: stopped ? "已请求停止任务" : "任务已经结束" } };
	}
	if (action.action === "reset") {
		if (activeTaskViews.has(action.topicKey)) {
			return { toast: { type: "warning", content: "请先停止正在执行的任务" } };
		}
		sessions.clear(action.topicKey);
		memory.clear(action.topicKey);
		taskCounter.clear(action.topicKey);
		pendingPlans.clear(action.topicKey);
		await replyCard(action.messageId, RESET_REPLY, { title: "新会话" });
		return { toast: { type: "success", content: "已创建新会话" } };
	}
	return undefined;
}

const dispatcher = new Lark.EventDispatcher({});
dispatcher.register({
	"card.action.trigger": handleCardAction,
	"im.message.receive_v1": async (data) => {
		try {
			const event = data as Record<string, unknown>;
			const message = event.message as Record<string, unknown> | undefined;
			if (!message) return;
			const messageId = String(message.message_id || "");
			if (!messageId || isDuplicate(messageId)) return;
			const messageType = String(message.message_type || "");
			if (messageType !== "text" && messageType !== "post" && messageType !== "image" && messageType !== "file") {
				await replyCard(messageId, "当前仅支持文本、富文本、图片和文件消息。", { title: "不支持的消息", color: "orange" });
				return;
			}
			const chatId = String(message.chat_id || "");
			const chatType = String(message.chat_type || "p2p");
			const threadId = message.thread_id ? String(message.thread_id) : undefined;
			const sender = event.sender as { sender_id?: { open_id?: string } } | undefined;
			const senderOpenId = sender?.sender_id?.open_id || "";
			const mentions = (message.mentions as FeishuMention[] | undefined) || [];
			const parsed = parseFeishuMessage(messageType, String(message.content || ""));
			let text = parsed.text;

			if (chatType === "group") {
				if (!botOpenId && !botName) await loadBotIdentity();
				if (messageType !== "image" && messageType !== "file" && !isBotMentioned(mentions)) return;
				text = stripMentions(text, mentions);
			}

			const gate = gateInboundMessage(chatType, threadId, { senderOpenId, ownerOpenId: access.ownerOpenId() });
			if (gate.action === "reject") {
				await replyCard(messageId, gate.reply, { title: "无法处理", color: "orange" });
				return;
			}
			if (!senderOpenId) {
				await replyCard(messageId, "飞书事件未提供发送者 OPEN_ID，无法进行权限校验。", { title: "无法识别用户", color: "red" });
				return;
			}
			if (!access.isAuthorized(senderOpenId)) {
				const requestText = text || (parsed.files.length ? `[文件] ${parsed.files.map((file) => file.name).join(", ")}` : "[图片任务]");
				await requestAuthorization(senderOpenId, messageId, requestText);
				return;
			}
			if (!text && !parsed.imageKeys.length && !parsed.files.length) return;
			void handleMessage({ messageId, chatId, chatType, threadId, topicKey: gate.topicKey, text, imageKeys: parsed.imageKeys, files: parsed.files })
				.catch((error) => console.error("[消息] 处理失败", error));
		} catch (error) {
			console.error("[飞书] 事件处理失败", error);
		}
	},
});

const ws = new Lark.WSClient({
	appId: config.appId,
	appSecret: config.appSecret,
	domain: Lark.Domain.Feishu,
	loggerLevel: Lark.LoggerLevel.info,
});

void loadBotIdentity();
ws.start({ eventDispatcher: dispatcher });
process.on("exit", () => {
	codexAppServer.close();
	memory.close();
	access.close();
});
console.log(`Seven Lark Bridge 已启动\n项目: ${ROOT}\nCodex 可写范围: ${codexWritableRoot}\n状态: ${runtimeDir}`);
