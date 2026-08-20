import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type CodexStreamEvent = Record<string, unknown>;

export type CodexTurnResult = {
	result: string;
	threadId: string;
};

type RpcId = number | string;
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ActiveTurn = {
	topicKey: string;
	threadId: string;
	turnId?: string;
	interruptRequested: boolean;
	text: string;
	usage?: Record<string, number>;
	onEvent?: (event: CodexStreamEvent) => void;
	resolve: (value: CodexTurnResult) => void;
	reject: (error: Error) => void;
};

type RpcMessage = {
	id?: RpcId;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code?: number; message?: string };
};

export function resolveCodexAppServerExecutable(env = process.env, platform = process.platform): string {
	if (env.CODEX_BIN) return env.CODEX_BIN;
	if (platform !== "win32") return "codex";
	const npmRoot = env.APPDATA && join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules");
	const candidates = npmRoot ? [
		join(npmRoot, "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"),
		join(npmRoot, "@openai", "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "codex", "codex.exe"),
	] : [];
	return candidates.find(existsSync) || "codex.exe";
}

export function buildSandboxPolicy(
	mode: "read-only" | "workspace-write",
	writableRoot: string,
	platform = process.platform,
): Record<string, unknown> {
	if (mode === "read-only") return { type: "readOnly", networkAccess: true };
	// The restricted-token sandbox can fail to initialize on Windows. Full access
	// still runs as the current Windows user and makes D:\Seven reliably writable.
	if (platform === "win32") return { type: "dangerFullAccess" };
	return {
		type: "workspaceWrite",
		writableRoots: [resolve(writableRoot)],
		networkAccess: true,
		excludeTmpdirEnvVar: false,
		excludeSlashTmp: false,
	};
}

function toolEvent(item: Record<string, unknown>, subtype: "started" | "completed"): CodexStreamEvent | undefined {
	const type = String(item.type || "");
	let name = "toolCall";
	let label = type || "工具调用";
	let failed = false;
	if (type === "commandExecution") {
		name = "shellToolCall";
		label = String(item.command || "命令执行");
		failed = subtype === "completed" && (item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0));
	} else if (type === "fileChange") {
		name = "fileChangeToolCall";
		const changes = Array.isArray(item.changes) ? item.changes as Array<Record<string, unknown>> : [];
		label = changes.length ? `修改文件：${changes.map((change) => String(change.path || change.file || "")).filter(Boolean).slice(0, 3).join(", ")}` : "修改文件";
		failed = subtype === "completed" && item.status === "failed";
	} else if (type === "mcpToolCall") {
		name = "callMcpToolToolCall";
		label = `${String(item.server || "mcp")}.${String(item.tool || "tool")}`;
		failed = subtype === "completed" && (item.status === "failed" || Boolean(item.error));
	} else if (type === "webSearch") {
		name = "webSearchToolCall";
		label = `搜索：${String(item.query || "")}`;
	} else if (type === "imageView") {
		name = "imageViewToolCall";
		label = `查看图片：${String(item.path || "")}`;
	} else {
		return undefined;
	}
	return {
		type: "tool_call",
		subtype,
		tool_call: {
			[name]: {
				args: { description: label },
				...(subtype === "completed" ? { result: failed ? { error: { message: "执行失败" } } : { success: { content: "完成" } } } : {}),
			},
		},
	};
}

export class CodexAppServer {
	private child?: ChildProcessWithoutNullStreams;
	private ready?: Promise<void>;
	private nextId = 1;
	private stdoutBuffer = "";
	private stderr = "";
	private readonly pending = new Map<string, PendingRequest>();
	private readonly loadedThreads = new Set<string>();
	private readonly activeByThread = new Map<string, ActiveTurn>();
	private readonly threadByTopic = new Map<string, string>();

	constructor(private readonly options: {
		cwd: string;
		writableRoot: string;
		executable?: string;
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
	}) {}

	get pid(): number | undefined {
		return this.child?.pid;
	}

	private send(message: RpcMessage): void {
		if (!this.child?.stdin.writable) throw new Error("Codex App Server is not writable");
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private rawRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolveRequest, rejectRequest) => {
			this.pending.set(String(id), {
				resolve: (value) => resolveRequest(value as T),
				reject: rejectRequest,
			});
			this.send({ id, method, params });
		});
	}

	private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		await this.start();
		return this.rawRequest<T>(method, params);
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = (async () => {
			const executable = this.options.executable || resolveCodexAppServerExecutable(this.options.env);
			const child = spawn(executable, ["app-server", "--listen", "stdio://", "--disable", "plugins"], {
				cwd: this.options.cwd,
				env: this.options.env || process.env,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
			this.child = child;
			child.stdout.on("data", (chunk: Buffer) => this.consumeStdout(chunk.toString("utf8")));
			child.stderr.on("data", (chunk: Buffer) => { this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8_000); });
			child.on("error", (error) => this.failAll(error));
			child.on("close", (code) => this.failAll(new Error(this.stderr.trim() || `Codex App Server exited with ${code}`)));
			await this.rawRequest("initialize", {
				clientInfo: { name: "seven-lark-bridge", title: "Seven Lark Bridge", version: "1.0.0" },
				capabilities: { experimentalApi: false },
			});
			this.send({ method: "initialized", params: {} });
		})();
		try {
			await this.ready;
		} catch (error) {
			this.ready = undefined;
			throw error;
		}
	}

	private consumeStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		const lines = this.stdoutBuffer.split(/\r?\n/);
		this.stdoutBuffer = lines.pop() || "";
		for (const line of lines) {
			if (!line.trim().startsWith("{")) continue;
			try { this.handleMessage(JSON.parse(line) as RpcMessage); } catch {}
		}
	}

	private handleMessage(message: RpcMessage): void {
		if (this.options.env?.CODEX_APP_SERVER_DEBUG === "1" || process.env.CODEX_APP_SERVER_DEBUG === "1") {
			console.error(`[Codex RPC] ${message.method || `response:${String(message.id)}`} ${JSON.stringify(message.params || message.error || {}).slice(0, 2_000)}`);
		}
		if (message.id != null && !message.method) {
			const pending = this.pending.get(String(message.id));
			if (!pending) return;
			this.pending.delete(String(message.id));
			if (message.error) pending.reject(new Error(message.error.message || `Codex RPC error ${message.error.code || ""}`));
			else pending.resolve(message.result);
			return;
		}
		if (message.id != null && message.method) {
			this.handleServerRequest(message);
			return;
		}
		if (message.method) this.handleNotification(message.method, message.params || {});
	}

	private handleServerRequest(message: RpcMessage): void {
		if (message.id == null) return;
		if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
			this.send({ id: message.id, result: { decision: "decline" } });
			return;
		}
		if (message.method === "item/tool/requestUserInput") {
			this.send({ id: message.id, result: { answers: {} } });
			return;
		}
		this.send({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
	}

	private handleNotification(method: string, params: Record<string, unknown>): void {
		const threadId = String(params.threadId || (params.thread as Record<string, unknown> | undefined)?.id || "");
		const active = this.activeByThread.get(threadId);
		if (!active) return;
		if (method === "turn/started") {
			const turn = params.turn as Record<string, unknown> | undefined;
			active.turnId = String(turn?.id || active.turnId || "");
			active.onEvent?.({ type: "thinking", text: "Codex 正在分析任务..." });
			if (active.interruptRequested) void this.interrupt(active.topicKey);
			return;
		}
		if (method === "item/agentMessage/delta") {
			const delta = String(params.delta || "");
			active.text += delta;
			if (delta) active.onEvent?.({ type: "assistant_delta", text: delta });
			return;
		}
		if (method === "item/started" || method === "item/completed") {
			const item = params.item as Record<string, unknown> | undefined;
			if (!item) return;
			if (item.type === "agentMessage" && method === "item/completed" && !active.text) {
				active.text = String(item.text || "");
				if (active.text) active.onEvent?.({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: active.text }] } });
				return;
			}
			const event = toolEvent(item, method === "item/started" ? "started" : "completed");
			if (event) active.onEvent?.(event);
			return;
		}
		if (method === "thread/tokenUsage/updated") {
			const tokenUsage = params.tokenUsage as Record<string, Record<string, number>> | undefined;
			const last = tokenUsage?.last;
			if (last) active.usage = {
				input_tokens: last.inputTokens || 0,
				cached_input_tokens: last.cachedInputTokens || 0,
				output_tokens: last.outputTokens || 0,
				reasoning_tokens: last.reasoningOutputTokens || 0,
			};
			return;
		}
		if (method === "turn/completed") {
			const turn = params.turn as Record<string, unknown> | undefined;
			const status = String(turn?.status || "failed");
			this.activeByThread.delete(threadId);
			this.threadByTopic.delete(active.topicKey);
			if (status === "completed") {
				const result = active.text.trim() || "(Codex 已完成，无文本回复)";
				active.onEvent?.({ type: "result", subtype: "success", result, usage: active.usage || {} });
				active.resolve({ result, threadId });
			} else {
				const error = turn?.error as Record<string, unknown> | undefined;
				active.reject(new Error(String(error?.message || `Codex turn ${status}`)));
			}
		}
	}

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		for (const active of this.activeByThread.values()) active.reject(error);
		this.activeByThread.clear();
		this.threadByTopic.clear();
		this.loadedThreads.clear();
		this.child = undefined;
		this.ready = undefined;
	}

	private async loadThread(threadId: string | undefined, mode: "read-only" | "workspace-write"): Promise<string> {
		const platform = this.options.platform || process.platform;
		const common = {
			cwd: this.options.cwd,
			approvalPolicy: "never",
			sandbox: mode === "read-only" ? "read-only" : platform === "win32" ? "danger-full-access" : "workspace-write",
			...(process.env.CODEX_MODEL?.trim() ? { model: process.env.CODEX_MODEL.trim() } : {}),
		};
		if (threadId) {
			if (!this.loadedThreads.has(threadId)) await this.request("thread/resume", { threadId, ...common });
			this.loadedThreads.add(threadId);
			return threadId;
		}
		const response = await this.request<{ thread: { id: string } }>("thread/start", {
			...common,
			serviceName: "seven-lark-bridge",
		});
		this.loadedThreads.add(response.thread.id);
		return response.thread.id;
	}

	async runTurn(input: {
		topicKey: string;
		threadId?: string;
		prompt: string;
		imagePaths?: string[];
		mode: "read-only" | "workspace-write";
		onEvent?: (event: CodexStreamEvent) => void;
		onStarted?: (threadId: string) => void;
	}): Promise<CodexTurnResult> {
		const threadId = await this.loadThread(input.threadId, input.mode);
		if (this.activeByThread.has(threadId)) throw new Error("Codex thread already has an active turn");
		let resolveTurn!: (value: CodexTurnResult) => void;
		let rejectTurn!: (error: Error) => void;
		const completion = new Promise<CodexTurnResult>((resolveCompletion, rejectCompletion) => {
			resolveTurn = resolveCompletion;
			rejectTurn = rejectCompletion;
		});
		const active: ActiveTurn = {
			topicKey: input.topicKey,
			threadId,
			interruptRequested: false,
			text: "",
			onEvent: input.onEvent,
			resolve: resolveTurn,
			reject: rejectTurn,
		};
		this.activeByThread.set(threadId, active);
		this.threadByTopic.set(input.topicKey, threadId);
		input.onStarted?.(threadId);
		try {
			const response = await this.request<{ turn: { id: string } }>("turn/start", {
				threadId,
				input: [
					{ type: "text", text: input.prompt, text_elements: [] },
					...(input.imagePaths || []).map((path) => ({ type: "localImage", path: resolve(path) })),
				],
				cwd: this.options.cwd,
				approvalPolicy: "never",
				sandboxPolicy: buildSandboxPolicy(input.mode, this.options.writableRoot, this.options.platform),
			});
			active.turnId = response.turn.id;
			if (active.interruptRequested) await this.interrupt(input.topicKey);
		} catch (error) {
			this.activeByThread.delete(threadId);
			this.threadByTopic.delete(input.topicKey);
			throw error;
		}
		return completion;
	}

	async steer(topicKey: string, instruction: string): Promise<boolean> {
		const threadId = this.threadByTopic.get(topicKey);
		const active = threadId ? this.activeByThread.get(threadId) : undefined;
		if (!active?.turnId) return false;
		try {
			await this.request("turn/steer", {
				threadId,
				expectedTurnId: active.turnId,
				input: [{ type: "text", text: instruction, text_elements: [] }],
			});
			return true;
		} catch {
			return false;
		}
	}

	async interrupt(topicKey: string): Promise<boolean> {
		const threadId = this.threadByTopic.get(topicKey);
		const active = threadId ? this.activeByThread.get(threadId) : undefined;
		if (!active) return false;
		if (!active.turnId) {
			active.interruptRequested = true;
			return true;
		}
		try {
			await this.request("turn/interrupt", { threadId, turnId: active.turnId });
			return true;
		} catch {
			return false;
		}
	}

	close(): void {
		try { this.child?.kill("SIGTERM"); } catch {}
	}
}
