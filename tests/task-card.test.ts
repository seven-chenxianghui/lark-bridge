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
		progress.phase = "working";
		progress.tools.push({ label: "powershell D:\\Seven\\secret.ps1", status: "success" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text).toContain("已处理");
		expect(text).not.toContain("检查功能");
		expect(text).not.toContain("private-model");
		expect(text).not.toContain("private-branch");
		expect(text).not.toContain("private-file.txt");
		expect(text).not.toContain("secret.ps1");
	});

	test("shows a safe one-line verification activity", () => {
		const progress = createTaskProgress(1_000);
		progress.phase = "working";
		progress.tools.push({ label: "powershell.exe -Command npm test -- --watch=false", status: "running" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text).toContain("正在操作 · npm test");
		expect(text).not.toContain("powershell.exe");
		expect(text).not.toContain("watch=false");
	});

	test("renders streamed commentary and tools in order", () => {
		const progress = createTaskProgress(Date.now() - 65_000);
		progress.phase = "working";
		progress.activities.push(
			{ kind: "commentary", text: "先检查项目结构。" },
			{ kind: "tool", label: "npm test", status: "success" },
			{ kind: "commentary", text: "测试通过，继续核对结果。" },
		);
		progress.tools.push({ label: "npm test", status: "success" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text).toContain("已处理 1分");
		expect(text.indexOf("先检查项目结构")).toBeLessThan(text.indexOf("操作完成 · npm test"));
		expect(text.indexOf("操作完成 · npm test")).toBeLessThan(text.indexOf("测试通过"));
	});

	test("does not repeat the fallback phase", () => {
		const progress = createTaskProgress();
		progress.phase = "finishing";
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text.match(/正在整理结果/g)?.length).toBe(1);
	});

	test("hides repeated generic tool completions", () => {
		const progress = createTaskProgress();
		progress.phase = "working";
		progress.activities.push(
			{ kind: "tool", label: "powershell Get-Content README.md", status: "success" },
			{ kind: "tool", label: "powershell Get-Content package.json", status: "success" },
			{ kind: "commentary", text: "已读取项目文件，继续检查。" },
			{ kind: "tool", label: "powershell Get-Content src/server.ts", status: "success" },
		);
		progress.tools.push({ label: "powershell Get-Content src/server.ts", status: "success" });
		const text = JSON.stringify(buildTaskCardElements(meta, progress, "running"));

		expect(text).toContain("已读取项目文件");
		expect(text).not.toContain("本机操作完成");
		expect(text).not.toContain("Get-Content");
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
