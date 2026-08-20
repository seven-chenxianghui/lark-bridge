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
	return ({ queued: "等待执行", analyzing: "分析任务", working: "执行中", finishing: "整理结果" })[progress.phase];
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
	return [surface(finished ? `**处理结果**\n${result}` : `**当前状态**\n${phaseText(progress, state)}`)];
}

export function taskCardSubtitle(_meta: TaskCardMeta): undefined {
	return undefined;
}
