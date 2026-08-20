import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, snapshotWorkspace } from "../src/workspace-changes.ts";

describe("workspace changes", () => {
	test("detects created and modified files while ignoring dependencies", async () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-workspace-"));
		try {
			writeFileSync(join(dir, "a.txt"), "a");
			mkdirSync(join(dir, "node_modules"));
			writeFileSync(join(dir, "node_modules", "ignored.txt"), "x");
			const before = snapshotWorkspace(dir);
			await Bun.sleep(5);
			writeFileSync(join(dir, "a.txt"), "changed");
			writeFileSync(join(dir, "b.txt"), "new");
			expect(changedFiles(before, snapshotWorkspace(dir))).toEqual(["a.txt", "b.txt"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
