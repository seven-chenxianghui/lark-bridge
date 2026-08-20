import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatMemoryRepo, createLocalEmbedding, formatMemory } from "../src/chat-memory.ts";

describe("chat memory", () => {
	test("persists, searches, formats, and clears topic turns", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-memory-"));
		try {
			const repo = createChatMemoryRepo(dir);
			repo.append("topic-a", "user", "检查项目");
			repo.append("topic-a", "assistant", "检查完成");
			expect(repo.count("topic-a")).toBe(2);
			expect(repo.search("topic-a", "项目检查")[0]?.text).toContain("检查项目");
			expect(formatMemory(repo.get("topic-a"))).toContain("检查项目");
			repo.close();
			const reopened = createChatMemoryRepo(dir);
			expect(reopened.get("topic-a")).toHaveLength(2);
			reopened.clear("topic-a");
			expect(reopened.get("topic-a")).toEqual([]);
			reopened.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("creates normalized deterministic local embeddings", () => {
		const first = createLocalEmbedding("检查 ABC 项目");
		expect(first).toEqual(createLocalEmbedding("检查 ABC 项目"));
		expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 5);
	});

	test("imports the legacy JSON store once", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-memory-migration-"));
		try {
			const stateDir = join(dir, "state");
			mkdirSync(stateDir, { recursive: true });
			writeFileSync(join(stateDir, "chat-memory.json"), JSON.stringify({
				topics: { "topic-old": [{ role: "user", text: "旧记忆内容", at: "2026-01-01T00:00:00.000Z" }] },
			}));
			const repo = createChatMemoryRepo(dir);
			expect(repo.get("topic-old")).toEqual([{ role: "user", text: "旧记忆内容", at: "2026-01-01T00:00:00.000Z" }]);
			repo.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
