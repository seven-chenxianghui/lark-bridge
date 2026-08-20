import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduler, formatDuration, parseDuration } from "../src/scheduler.ts";

describe("scheduler", () => {
	test("parses supported durations", () => {
		expect(parseDuration("30m")).toBe(1_800_000);
		expect(parseDuration("2h")).toBe(7_200_000);
		expect(parseDuration("1d")).toBe(86_400_000);
		expect(parseDuration("5s")).toBeUndefined();
		expect(formatDuration(7_200_000)).toBe("2h");
	});

	test("persists and removes tasks by topic", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-scheduler-"));
		try {
			const scheduler = createScheduler(dir, async () => {});
			const task = scheduler.add({ topicKey: "topic-a", messageId: "m1", intervalMs: 60_000, prompt: "检查" });
			expect(createScheduler(dir, async () => {}).list("topic-a")).toHaveLength(1);
			expect(scheduler.remove("topic-b", task.id)).toBe(false);
			expect(scheduler.remove("topic-a", task.id)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
