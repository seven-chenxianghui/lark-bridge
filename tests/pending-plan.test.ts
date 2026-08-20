import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPendingPlanRepo } from "../src/pending-plan.js";

describe("pending plans", () => {
	test("persists and atomically consumes one plan per topic", () => {
		const root = mkdtempSync(join(tmpdir(), "seven-plan-"));
		const repo = createPendingPlanRepo(root);
		repo.set("topic", "实现登录页");
		expect(createPendingPlanRepo(root).get("topic")?.prompt).toBe("实现登录页");
		expect(repo.consume("topic")?.prompt).toBe("实现登录页");
		expect(repo.consume("topic")).toBeUndefined();
	});
});
