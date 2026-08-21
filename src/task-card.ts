import type { TaskProgress } from "./task-progress.js";

export type TaskCardMeta = {
	taskId: string;
	turn: number;
	project: string;
	branch: string;
	request: string;
	model: string;
	reasoning: string;
	contextWindow?: number;
	compactLimit?: number;
	attachments?: string[];
};

export type TaskCardState = "running" | "complete" | "stopped" | "failed";
export type CardElement = Record<string, unknown>;
export const FIRST_RESULT_CHARS = 2600;
export const CONTINUED_RESULT_CHARS = 2900;

export function splitResultText(text: string): string[] {
	const chunks: string[] = [];
	let remaining = text;
	let limit = FIRST_RESULT_CHARS;
	while (remaining) {
		chunks.push(remaining.slice(0, limit));
		remaining = remaining.slice(limit);
		limit = CONTINUED_RESULT_CHARS;
	}
	return chunks.length ? chunks : [""];
}

function phaseText(progress: TaskProgress, state: TaskCardState): string {
	if (state === "complete") return "已完成";
	if (state === "stopped") return "已停止";
	if (state === "failed") return "执行失败";
	if (progress.phase === "queued") return "等待执行";
	if (progress.phase === "analyzing") return "正在分析任务";
	if (progress.phase === "finishing") return "正在整理结果";

	const tool = progress.tools.at(-1);
	if (!tool) return "正在执行本机操作";
	return toolStatusText(tool.label, tool.status);
}

function safeToolName(label: string): string {
	const normalized = label.toLowerCase();
	const command = [
		"npm run verify",
		"npm run build",
		"npm test",
		"bun run verify",
		"bun run build",
		"bun test",
		"pytest",
		"cargo test",
		"go test",
		"git diff",
		"git status",
		"eslint",
		"tsc",
	].find((value) => normalized.includes(value));
	if (command) return command;
	if (normalized.startsWith("修改文件")) return "修改文件";
	if (normalized.startsWith("搜索")) return "搜索资料";
	if (normalized.startsWith("查看图片")) return "查看图片";
	return "";
}

function toolStatusText(label: string, status: "running" | "success" | "failed"): string {
	const safeName = safeToolName(label);
	if (!safeName) return status === "failed" ? "本机操作失败" : status === "success" ? "正在继续处理" : "正在执行本机操作";
	if (status === "failed") return `操作失败 · ${safeName}`;
	return `${status === "success" ? "操作完成" : "正在操作"} · ${safeName}`;
}

function renderToolActivity(label: string, status: "running" | "success" | "failed"): string {
	if (!safeToolName(label) && status === "success") return "";
	return `**${toolStatusText(label, status)}**`;
}

function elapsedText(startedAt: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
}

function runningProcess(progress: TaskProgress): string {
	const entries: string[] = [];
	for (const activity of progress.activities) {
		const entry = activity.kind === "commentary"
			? activity.text.trim()
			: renderToolActivity(activity.label, activity.status);
		if (entry && entries.at(-1) !== entry) entries.push(entry);
	}
	let timeline = entries.join("\n\n") || phaseText(progress, "running");
	if (timeline.length > 2_200) timeline = `…\n\n${timeline.slice(-2_200)}`;
	return `已处理 ${elapsedText(progress.startedAt)}\n\n---\n\n${timeline}`;
}

function surface(content: string): CardElement {
	return {
		tag: "column_set",
		flex_mode: "stretch",
		columns: [{
			tag: "column",
			width: "weighted",
			weight: 1,
			background_style: "blue-50",
			padding: "12px",
			vertical_align: "top",
			elements: [{ tag: "markdown", content }],
		}],
	};
}

export function buildTaskCardElements(
	_meta: TaskCardMeta,
	progress: TaskProgress,
	state: TaskCardState,
	_summary = "",
): CardElement[] {
	const finished = state !== "running";
	const liveOutput = progress.liveOutput.trim() || "Codex 正在处理。";
	const result = state === "stopped"
			? "任务已停止。"
			: splitResultText(liveOutput)[0];
	return [surface(finished ? `**处理结果**\n${result}` : runningProcess(progress))];
}

export function taskCardSubtitle(_meta: TaskCardMeta): undefined {
	return undefined;
}
