import { describe, expect, test } from "bun:test";
import { buildTaskCardElements, splitResultText, taskCardSubtitle } from "../src/task-card.ts";
import { createTaskProgress } from "../src/task-progress.ts";

const meta = {
	taskId: "private-id",
	turn: 4,
	project: "private-project",
	branch: "private-branch",
	request: "检查功能",
	model: "private-model",
	reasoning: "high",
	attachments: ["private-file.txt"],
};

describe("task card", () => {
	test("builds a concise running card without internal details", () => {
		const progress = createTaskProgress(1_000);
		progress.liveOutput = "正在检查项目";
		progress.inputTokens = 200_900;
		progress.tools.push({ label: "powershell D:\\Seven\\secret.ps1", status: "success" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text).toContain("当前状态");
		expect(text).not.toContain("检查功能");
		expect(text).not.toContain("private-model");
		expect(text).not.toContain("private-branch");
		expect(text).not.toContain("private-file.txt");
		expect(text).not.toContain("secret.ps1");
	});

	test("builds a concise completed card without diagnostics", () => {
		const progress = createTaskProgress(1_000);
		progress.liveOutput = "任务完成";
		progress.tools.push({ label: "bun test", status: "success" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "complete", "private summary"));

		expect(text).toContain("处理结果");
		expect(text).toContain("任务完成");
		expect(text).not.toContain("bun test");
		expect(text).not.toContain("private summary");
		expect(taskCardSubtitle(meta)).toBeUndefined();
	});

	test("splits long results without truncation", () => {
		const result = "a".repeat(2600) + "b".repeat(2900) + "c".repeat(17);
		const chunks = splitResultText(result);

		expect(chunks.map((chunk) => chunk.length)).toEqual([2600, 2900, 17]);
		expect(chunks.join("")).toBe(result);
	});
});
