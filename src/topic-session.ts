// CLAW_TOPIC_SESSION — 飞书 thread_id ↔ Codex sessionId 绑定（Topic Session）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export interface TopicSessionStore {
	/** topicKey → sessionId */
	bindings: Record<string, string>;
}

export function emptyTopicSessionStore(): TopicSessionStore {
	return { bindings: {} };
}

export function topicSessionsPath(workspace: string): string {
	return resolve(workspace, "state", "topic-sessions.json");
}

export function loadTopicSessions(path: string): TopicSessionStore {
	try {
		if (!existsSync(path)) return emptyTopicSessionStore();
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		if (!raw || typeof raw !== "object") return emptyTopicSessionStore();
		const bindings =
			raw.bindings && typeof raw.bindings === "object"
				? (raw.bindings as Record<string, string>)
				: (raw as Record<string, string>);
		const cleaned: Record<string, string> = {};
		for (const [k, v] of Object.entries(bindings)) {
			if (typeof k === "string" && typeof v === "string" && k && v) cleaned[k] = v;
		}
		return { bindings: cleaned };
	} catch {
		return emptyTopicSessionStore();
	}
}

export function saveTopicSessions(path: string, store: TopicSessionStore): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

export function getTopicSessionId(store: TopicSessionStore, topicKey: string): string | undefined {
	return store.bindings[topicKey] || undefined;
}

export function setTopicSessionId(store: TopicSessionStore, topicKey: string, sessionId: string): TopicSessionStore {
	return {
		bindings: { ...store.bindings, [topicKey]: sessionId },
	};
}

export function clearTopicSession(store: TopicSessionStore, topicKey: string): TopicSessionStore {
	if (!(topicKey in store.bindings)) return store;
	const bindings = { ...store.bindings };
	delete bindings[topicKey];
	return { bindings };
}

/** 内存缓存 + 磁盘持久化，供 Claw server 使用 */
export function createTopicSessionRepo(workspace: string) {
	const path = topicSessionsPath(workspace);
	let store = loadTopicSessions(path);

	return {
		path,
		get(topicKey: string): string | undefined {
			return getTopicSessionId(store, topicKey);
		},
		set(topicKey: string, sessionId: string): void {
			store = setTopicSessionId(store, topicKey, sessionId);
			saveTopicSessions(path, store);
		},
		clear(topicKey: string): void {
			store = clearTopicSession(store, topicKey);
			saveTopicSessions(path, store);
		},
		reload(): void {
			store = loadTopicSessions(path);
		},
	};
}

export type TopicSessionRepo = ReturnType<typeof createTopicSessionRepo>;
