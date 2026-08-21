import { describe, expect, test } from "bun:test";
import { applyAgentEvent, createTaskProgress, formatElapsed, renderProgress, renderTaskSummary } from "../src/task-progress.ts";

describe("task progress", () => {
	test("tracks Codex phases and tool results", () => {
		const progress = createTaskProgress(1_000);
		applyAgentEvent(progress, { type: "thinking" });
		applyAgentEvent(progress, {
			type: "tool_call",
			subtype: "started",
			tool_call: { shellToolCall: { args: { command: "npm test" } } },
		});
		applyAgentEvent(progress, {
			type: "tool_call",
			subtype: "completed",
			tool_call: { shellToolCall: { args: { command: "npm test" }, result: { success: {} } } },
		});
		expect(progress.phase).toBe("working");
		expect(progress.toolCalls).toBe(1);
		expect(progress.tools[0]).toEqual({ label: "npm test", status: "success" });
		expect(renderProgress(progress, 6_000)).toContain("npm test");
	});

	test("captures live assistant output, latency, and extended usage", () => {
		const progress = createTaskProgress(1_000);
		applyAgentEvent(progress, {
			type: "assistant",
			message: { content: [{ text: "开始检查" }] },
		}, 5_900);
		applyAgentEvent(progress, {
			type: "result",
			usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_tokens: 5 },
		});
		expect(progress.firstOutputAt).toBe(5_900);
		expect(progress.liveOutput).toBe("开始检查");
		expect(progress.cachedInputTokens).toBe(80);
		expect(progress.reasoningTokens).toBe(5);
	});

	test("appends App Server streaming deltas without extra line breaks", () => {
		const progress = createTaskProgress(1_000);
		applyAgentEvent(progress, { type: "assistant_delta", text: "正在" }, 1_100);
		applyAgentEvent(progress, { type: "assistant_delta", text: "处理" }, 1_200);
		expect(progress.liveOutput).toBe("正在处理");
	});

	test("keeps reasoning summaries and tools in chronological order", () => {
		const progress = createTaskProgress(1_000);
		applyAgentEvent(progress, { type: "commentary_delta", text: "先检查" });
		applyAgentEvent(progress, { type: "commentary_delta", text: "配置。" });
		applyAgentEvent(progress, {
			type: "tool_call",
			subtype: "started",
			tool_call: { shellToolCall: { args: { command: "npm test" } } },
		});
		applyAgentEvent(progress, { type: "commentary_delta", text: "测试后继续。" });

		expect(progress.activities).toEqual([
			{ kind: "commentary", text: "先检查配置。" },
			{ kind: "tool", label: "npm test", status: "running" },
			{ kind: "commentary", text: "测试后继续。" },
		]);
	});

	test("renders elapsed time and final changes", () => {
		const progress = createTaskProgress(Date.now() - 65_000);
		expect(formatElapsed(0, 65_000)).toBe("01:05");
		const summary = renderTaskSummary(progress, ["src/server.ts"], false);
		expect(summary).toContain("src/server.ts");
		expect(summary).toContain("已延续");
	});
});
