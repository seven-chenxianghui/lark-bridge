import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	emptyTopicSessionStore,
	getTopicSessionId,
	setTopicSessionId,
	clearTopicSession,
	loadTopicSessions,
	saveTopicSessions,
	topicSessionsPath,
	createTopicSessionRepo,
} from "../src/topic-session.ts";

describe("Topic Session binding", () => {
	test("empty store has no binding", () => {
		const store = emptyTopicSessionStore();
		expect(getTopicSessionId(store, "thread-a")).toBeUndefined();
	});

	test("set then get returns same sessionId", () => {
		let store = emptyTopicSessionStore();
		store = setTopicSessionId(store, "thread-a", "sess-1");
		expect(getTopicSessionId(store, "thread-a")).toBe("sess-1");
	});

	test("different topics do not share session", () => {
		let store = emptyTopicSessionStore();
		store = setTopicSessionId(store, "thread-a", "sess-a");
		store = setTopicSessionId(store, "thread-b", "sess-b");
		expect(getTopicSessionId(store, "thread-a")).toBe("sess-a");
		expect(getTopicSessionId(store, "thread-b")).toBe("sess-b");
	});

	test("clear removes only that topic binding", () => {
		let store = emptyTopicSessionStore();
		store = setTopicSessionId(store, "thread-a", "sess-a");
		store = setTopicSessionId(store, "thread-b", "sess-b");
		store = clearTopicSession(store, "thread-a");
		expect(getTopicSessionId(store, "thread-a")).toBeUndefined();
		expect(getTopicSessionId(store, "thread-b")).toBe("sess-b");
	});

	test("persist and reload round-trip", () => {
		const dir = mkdtempSync(join(tmpdir(), "topic-sess-"));
		try {
			const path = topicSessionsPath(dir);
			let store = setTopicSessionId(emptyTopicSessionStore(), "t1", "s1");
			saveTopicSessions(path, store);
			expect(existsSync(path)).toBe(true);
			const loaded = loadTopicSessions(path);
			expect(getTopicSessionId(loaded, "t1")).toBe("s1");
			const raw = JSON.parse(readFileSync(path, "utf-8"));
			expect(raw.bindings.t1).toBe("s1");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("repo get/set/clear persists", () => {
		const dir = mkdtempSync(join(tmpdir(), "topic-repo-"));
		try {
			const repo = createTopicSessionRepo(dir);
			expect(repo.get("t1")).toBeUndefined();
			repo.set("t1", "s1");
			expect(repo.get("t1")).toBe("s1");
			const again = createTopicSessionRepo(dir);
			expect(again.get("t1")).toBe("s1");
			again.clear("t1");
			expect(createTopicSessionRepo(dir).get("t1")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
