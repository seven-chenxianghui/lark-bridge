import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskCounter } from "../src/task-counter.ts";

describe("task counter", () => {
	test("persists turns and resets a topic", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-turns-"));
		try {
			const counter = createTaskCounter(dir);
			expect(counter.next("topic-a")).toBe(1);
			expect(counter.next("topic-a")).toBe(2);
			expect(createTaskCounter(dir).get("topic-a")).toBe(2);
			counter.clear("topic-a");
			expect(counter.get("topic-a")).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
