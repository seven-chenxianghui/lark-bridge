import { describe, expect, test } from "bun:test";
import { buildTaskCardElements, taskCardSubtitle } from "../src/task-card.ts";
import { createTaskProgress } from "../src/task-progress.ts";

describe("task card", () => {
	test("builds task card sections from real metadata", () => {
		const progress = createTaskProgress(1_000);
		progress.firstOutputAt = 5_900;
		progress.liveOutput = "正在检查项目";
		progress.inputTokens = 200_900;
		progress.cachedInputTokens = 199_400;
		progress.outputTokens = 449;
		const elements = buildTaskCardElements({
			taskId: "a6acd2",
			turn: 16,
			project: "seven-lark-bridge",
			branch: "main",
			request: "检查接口",
			model: "gpt-test",
			reasoning: "high",
			contextWindow: 258_400,
			compactLimit: 240_000,
		}, progress, "running");
		const text = JSON.stringify(elements);
		expect(text).toContain("**#16**");
		expect(text).toContain("首次输出：4.9s");
		expect(text).toContain("缓存 199.4K");
		expect(text).toContain("需求正文");
		expect(text).toContain("实时输出");
		expect(text).toContain("column_set");
		expect(text).toContain("blue-50");
		expect(text).not.toContain("collapsible_panel");
	});

	test("builds the completed card with collapsible details and attachments", () => {
		const progress = createTaskProgress(1_000);
		progress.liveOutput = "任务完成";
		progress.tools.push({ label: "bun test", status: "success" });
		const meta = {
			taskId: "done01",
			turn: 3,
			project: "seven-lark-bridge",
			branch: "main",
			request: "检查卡片",
			model: "gpt-test",
			reasoning: "high",
			attachments: ["飞书图片 1"],
		};
		const elements = buildTaskCardElements(meta, progress, "complete", "**任务摘要**\n- 文件变化：无");
		const text = JSON.stringify(elements);
		expect(text).toContain("最终输出");
		expect(text).toContain("动态 Prompt（已展开）");
		expect(text).toContain("输入附件 (1)");
		expect(text).toContain("思考过程");
		expect(text).toContain("green-50");
		expect(taskCardSubtitle(meta)).toContain("Work · `done01` · Turn #3");
	});
});
