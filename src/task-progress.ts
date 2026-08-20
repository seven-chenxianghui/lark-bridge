export type ToolStatus = "running" | "success" | "failed";
export type ToolActivity = { label: string; status: ToolStatus };

export type TaskProgress = {
	startedAt: number;
	phase: "queued" | "analyzing" | "working" | "finishing";
	sessionId?: string;
	toolCalls: number;
	toolFailures: number;
	tools: ToolActivity[];
	firstOutputAt?: number;
	liveOutput: string;
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
};

export function createTaskProgress(now = Date.now()): TaskProgress {
	return { startedAt: now, phase: "queued", toolCalls: 0, toolFailures: 0, tools: [], liveOutput: "" };
}

function toolLabel(event: Record<string, unknown>): string {
	const calls = event.tool_call as Record<string, { args?: Record<string, unknown> }> | undefined;
	const entry = calls ? Object.entries(calls)[0] : undefined;
	if (!entry) return "工具调用";
	const [name, detail] = entry;
	const args = detail?.args || {};
	const raw = args.command || (args.server && args.tool ? `${args.server}.${args.tool}` : args.description) || name;
	return String(raw).replace(/\s+/g, " ").trim().slice(0, 120) || "工具调用";
}

export function applyAgentEvent(progress: TaskProgress, event: Record<string, unknown>, now = Date.now()): void {
	if (event.type === "system" && event.session_id) progress.sessionId = String(event.session_id);
	if (event.type === "thinking") progress.phase = "analyzing";
	if (event.type === "assistant_delta") {
		progress.phase = "finishing";
		const text = String(event.text || "");
		if (text) {
			progress.firstOutputAt ??= now;
			progress.liveOutput = `${progress.liveOutput}${text}`.slice(-4_000);
		}
	}
	if (event.type === "assistant") {
		progress.phase = "finishing";
		const message = event.message as { content?: Array<{ text?: unknown }> } | undefined;
		const text = (message?.content || []).map((item) => String(item.text || "")).join("\n").trim();
		if (text) {
			progress.firstOutputAt ??= now;
			progress.liveOutput = `${progress.liveOutput}${progress.liveOutput ? "\n\n" : ""}${text}`.slice(-4_000);
		}
	}
	if (event.type === "tool_call") {
		progress.phase = "working";
		const label = toolLabel(event);
		if (event.subtype === "started") {
			progress.toolCalls++;
			progress.tools.push({ label, status: "running" });
			progress.tools = progress.tools.slice(-6);
		} else if (event.subtype === "completed") {
			const calls = event.tool_call as Record<string, { result?: Record<string, unknown> }> | undefined;
			const failed = Boolean(calls && Object.values(calls)[0]?.result?.error);
			const target = [...progress.tools].reverse().find((tool) => tool.status === "running" && tool.label === label);
			if (target) target.status = failed ? "failed" : "success";
			else progress.tools.push({ label, status: failed ? "failed" : "success" });
			if (failed) progress.toolFailures++;
		}
	}
	if (event.type === "result") {
		progress.phase = "finishing";
		const usage = event.usage as Record<string, unknown> | undefined;
		if (typeof usage?.input_tokens === "number") progress.inputTokens = usage.input_tokens;
		if (typeof usage?.cached_input_tokens === "number") progress.cachedInputTokens = usage.cached_input_tokens;
		if (typeof usage?.output_tokens === "number") progress.outputTokens = usage.output_tokens;
		if (typeof usage?.reasoning_tokens === "number") progress.reasoningTokens = usage.reasoning_tokens;
	}
}

export function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return String(value);
}

export function formatElapsed(startedAt: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function renderProgress(progress: TaskProgress, now = Date.now()): string {
	const phases = { queued: "等待执行", analyzing: "分析任务", working: "执行操作", finishing: "整理结果" };
	const lines = [
		`**当前阶段：${phases[progress.phase]}**`,
		`耗时 \`${formatElapsed(progress.startedAt, now)}\` · 工具调用 ${progress.toolCalls}`,
	];
	if (progress.tools.length) {
		lines.push("", "**最近活动**");
		for (const tool of progress.tools) {
			const status = tool.status === "running" ? "进行中" : tool.status === "success" ? "完成" : "失败";
			lines.push(`- ${status} · \`${tool.label.replace(/`/g, "'")}\``);
		}
	}
	return lines.join("\n");
}

export function renderTaskSummary(progress: TaskProgress, changedFiles: string[], renewed: boolean): string {
	const lines = [
		"---",
		"**任务摘要**",
		`- 耗时：\`${formatElapsed(progress.startedAt)}\``,
		`- 工具调用：${progress.toolCalls}${progress.toolFailures ? `（失败 ${progress.toolFailures}）` : ""}`,
		`- 会话：${renewed ? "已自动重建" : "已延续"}`,
	];
	if (progress.inputTokens != null || progress.outputTokens != null) {
		lines.push(`- Tokens：输入 ${progress.inputTokens || 0} / 输出 ${progress.outputTokens || 0}`);
	}
	if (changedFiles.length) {
		lines.push(`- 文件变化：${changedFiles.length} 个`);
		for (const file of changedFiles.slice(0, 8)) lines.push(`  - \`${file.replace(/`/g, "'")}\``);
		if (changedFiles.length > 8) lines.push(`  - 另有 ${changedFiles.length - 8} 个`);
	} else {
		lines.push("- 文件变化：无");
	}
	return lines.join("\n");
}
