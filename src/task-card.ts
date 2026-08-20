import { formatTokens, type TaskProgress } from "./task-progress.js";

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

function phaseText(progress: TaskProgress, state: TaskCardState): string {
	if (state === "complete") return "已完成";
	if (state === "stopped") return "已停止";
	if (state === "failed") return "执行失败";
	return ({ queued: "等待执行", analyzing: "分析任务", working: "执行操作", finishing: "整理输出" })[progress.phase];
}

function metrics(meta: TaskCardMeta, progress: TaskProgress): string {
	const firstOutput = progress.firstOutputAt == null ? "等待" : `${((progress.firstOutputAt - progress.startedAt) / 1000).toFixed(1)}s`;
	const context = progress.inputTokens == null
		? "等待统计"
		: `${formatTokens(progress.inputTokens)}${meta.contextWindow ? ` / ${formatTokens(meta.contextWindow)}` : ""}`;
	const tokens = progress.inputTokens == null && progress.outputTokens == null
		? "等待统计"
		: [
			`输入 ${formatTokens(progress.inputTokens || 0)}`,
			progress.cachedInputTokens != null ? `缓存 ${formatTokens(progress.cachedInputTokens)}` : "",
			`输出 ${formatTokens(progress.outputTokens || 0)}`,
			progress.reasoningTokens != null ? `推理 ${formatTokens(progress.reasoningTokens)}` : "",
		].filter(Boolean).join(" · ");
	const lines = [
		`**${meta.model} · ${meta.reasoning} · 快速 · ${cardElapsed(progress.startedAt)}**`,
		`来源：飞书 · 首次输出：${firstOutput} · 上下文：${context}`,
		`最近调用：${progress.toolCalls} 次${progress.toolFailures ? ` · 失败 ${progress.toolFailures}` : ""}`,
		`Tokens：${tokens}`,
	];
	if (meta.compactLimit) lines.push(`压缩阈值：${formatTokens(meta.compactLimit)}`);
	return lines.join("\n");
}

function cardElapsed(startedAt: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function markdown(content: string): CardElement {
	return { tag: "markdown", content };
}

function surface(content: string, background = "blue-50"): CardElement {
	return {
		tag: "column_set",
		flex_mode: "stretch",
		columns: [{
			tag: "column",
			width: "weighted",
			weight: 1,
			background_style: background,
			padding: "12px",
			vertical_align: "top",
			elements: [markdown(content)],
		}],
	};
}

function statColumn(value: string, label: string, color = "blue"): CardElement {
	return {
		tag: "column",
		width: "weighted",
		weight: 1,
		background_style: "grey",
		padding: "12px",
		vertical_align: "center",
		horizontal_align: "center",
		elements: [markdown(`<font color='${color}'>**${value}**</font>\n${label}`)],
	};
}

function collapsible(title: string, content: string, expanded: boolean): CardElement {
	return {
		tag: "collapsible_panel",
		expanded,
		background_color: "grey-50",
		border: { color: "grey-200", corner_radius: "5px" },
		padding: "8px 12px 8px 12px",
		header: {
			title: { tag: "plain_text", content: title },
			vertical_align: "center",
		},
		elements: content ? [markdown(content)] : [],
	};
}

function activityText(progress: TaskProgress): string {
	if (!progress.tools.length) return "Codex 正在分析请求，尚未调用本机工具。";
	return progress.tools.map((tool) => {
		const status = tool.status === "running" ? "进行中" : tool.status === "success" ? "完成" : "失败";
		return `- ${status} · \`${tool.label.replace(/`/g, "'")}\``;
	}).join("\n");
}

export function buildTaskCardElements(
	meta: TaskCardMeta,
	progress: TaskProgress,
	state: TaskCardState,
	summary = "",
): CardElement[] {
	const liveOutput = progress.liveOutput.trim() || "Codex 正在处理，输出将在这里持续更新。";
	const output = liveOutput.length > 2600 ? `${liveOutput.slice(0, 2600)}\n\n（完整输出见后续消息）` : liveOutput;
	const status = phaseText(progress, state);
	const completed = state === "complete";
	const finished = state !== "running";
	const statusDetail = `${status}${progress.tools.at(-1) ? ` · ${progress.tools.at(-1)!.label}` : ""}`;
	const attachments = (meta.attachments || []).map((name) => `- 输入 · \`${name.replace(/`/g, "'")}\``).join("\n");
	const finalOutput = `${output}${summary ? `\n\n${summary.replace(/^---\s*/, "")}` : ""}`;
	return [
		surface(metrics(meta, progress), completed ? "green-50" : "blue-50"),
		{
			tag: "column_set",
			flex_mode: "stretch",
			horizontal_spacing: "8px",
			columns: [
				statColumn(status, "状态", completed ? "green" : "blue"),
				statColumn(meta.project, "项目"),
				statColumn(`#${meta.turn}`, "Turn", "purple"),
			],
		},
		surface(`<font color='blue'>**需求正文**</font>\n**${meta.request.slice(0, 1200)}**`),
		...(finished ? [
			collapsible("动态 Prompt（已展开）", `本轮请求由本机 Codex 在项目 \`${meta.project}\` 中执行。`, true),
			...(attachments ? [surface(`**输入附件 (${meta.attachments!.length})**\n${attachments}`)] : []),
			collapsible("思考过程", activityText(progress), false),
		] : []),
		surface(`**${finished ? "最终输出" : "实时输出（已精简）"}**\n${finished ? finalOutput : output}`),
		surface(`**当前状态**\n${statusDetail}`),
	];
}

export function taskCardSubtitle(meta: TaskCardMeta): string {
	return `Work · \`${meta.taskId}\` · Turn #${meta.turn} · 分支 \`${meta.branch}\``;
}
