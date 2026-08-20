import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type MemoryRole = "user" | "assistant";
export type MemoryTurn = { role: MemoryRole; text: string; at: string };
export type MemorySearchResult = MemoryTurn & { score: number };

type MemoryRow = { id: number; role: MemoryRole; text: string; at: string; embedding: string };
type LegacyStore = { topics?: Record<string, MemoryTurn[]> };

const PROMPT_TURNS = 20;
const MAX_STORED_TURNS = 2_000;
const MAX_TURN_CHARS = 4_000;
const EMBEDDING_DIMENSIONS = 256;

function hashToken(token: string): number {
	let hash = 2166136261;
	for (let index = 0; index < token.length; index++) {
		hash ^= token.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function embeddingTokens(text: string): string[] {
	const normalized = text.normalize("NFKC").toLowerCase();
	const tokens = normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g) || [];
	const compact = normalized.replace(/\s+/g, "");
	for (let index = 0; index < compact.length - 1; index++) tokens.push(compact.slice(index, index + 2));
	return tokens;
}

export function createLocalEmbedding(text: string): number[] {
	const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
	for (const token of embeddingTokens(text)) {
		const hash = hashToken(token);
		vector[hash % EMBEDDING_DIMENSIONS] += (hash & 0x100) === 0 ? 1 : -1;
	}
	const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
	return vector.map((value) => value / norm);
}

function cosine(left: number[], right: number[]): number {
	let score = 0;
	for (let index = 0; index < Math.min(left.length, right.length); index++) score += left[index] * right[index];
	return score;
}

function ftsQuery(value: string): string {
	return (value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])
		.map((token) => `"${token.replace(/"/g, '""')}"`)
		.join(" OR ");
}

export function createChatMemoryRepo(runtimeDir: string) {
	const stateDir = resolve(runtimeDir, "state");
	mkdirSync(stateDir, { recursive: true });
	const path = resolve(stateDir, "chat-memory.sqlite");
	const legacyPath = resolve(stateDir, "chat-memory.json");
	const db = new Database(path, { create: true });
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS memory_turns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			topic_key TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
			text TEXT NOT NULL,
			at TEXT NOT NULL,
			embedding TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_memory_topic_id ON memory_turns(topic_key, id DESC);
		CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(text, content='memory_turns', content_rowid='id');
		CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_turns BEGIN
			INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
		END;
		CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_turns BEGIN
			INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.id, old.text);
		END;
	`);

	const insert = db.prepare("INSERT INTO memory_turns(topic_key, role, text, at, embedding) VALUES (?, ?, ?, ?, ?)");
	const importDone = db.query<{ value: string }, []>("SELECT value FROM memory_meta WHERE key = 'legacy_import_done'").get();
	if (!importDone) {
		const importLegacy = db.transaction(() => {
			if (existsSync(legacyPath)) {
				try {
					const legacy = JSON.parse(readFileSync(legacyPath, "utf8")) as LegacyStore;
					for (const [topicKey, turns] of Object.entries(legacy.topics || {})) {
						for (const turn of turns) {
							if (!turn?.text || (turn.role !== "user" && turn.role !== "assistant")) continue;
							const text = turn.text.slice(0, MAX_TURN_CHARS);
							insert.run(topicKey, turn.role, text, turn.at || new Date().toISOString(), JSON.stringify(createLocalEmbedding(text)));
						}
					}
				} catch {}
			}
			db.run("INSERT INTO memory_meta(key, value) VALUES ('legacy_import_done', ?)", [new Date().toISOString()]);
		});
		importLegacy();
	}

	return {
		path,
		get(topicKey: string): MemoryTurn[] {
			const rows = db.query<MemoryRow, [string, number]>(
				"SELECT id, role, text, at, embedding FROM memory_turns WHERE topic_key = ? ORDER BY id DESC LIMIT ?",
			).all(topicKey, PROMPT_TURNS);
			return rows.reverse().map(({ role, text, at }) => ({ role, text, at }));
		},
		count(topicKey: string): number {
			return db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM memory_turns WHERE topic_key = ?").get(topicKey)?.total || 0;
		},
		privateOpenIds(): string[] {
			return db.query<{ topic_key: string }, []>("SELECT DISTINCT topic_key FROM memory_turns WHERE topic_key LIKE 'p2p:%'")
				.all()
				.map((row) => row.topic_key.slice(4))
				.filter(Boolean);
		},
		append(topicKey: string, role: MemoryRole, text: string): void {
			const value = text.trim().slice(0, MAX_TURN_CHARS);
			if (!value) return;
			insert.run(topicKey, role, value, new Date().toISOString(), JSON.stringify(createLocalEmbedding(value)));
			db.run(
				"DELETE FROM memory_turns WHERE topic_key = ? AND id NOT IN (SELECT id FROM memory_turns WHERE topic_key = ? ORDER BY id DESC LIMIT ?)",
				[topicKey, topicKey, MAX_STORED_TURNS],
			);
		},
		search(topicKey: string, query: string, limit = 5): MemorySearchResult[] {
			const value = query.trim();
			if (!value) return [];
			const vector = createLocalEmbedding(value);
			const ftsIds = new Set<number>();
			const match = ftsQuery(value);
			if (match) {
				try {
					for (const row of db.query<{ id: number }, [string, string, number]>(
						"SELECT memory_turns.id FROM memory_fts JOIN memory_turns ON memory_turns.id = memory_fts.rowid WHERE memory_fts MATCH ? AND memory_turns.topic_key = ? LIMIT ?",
					).all(match, topicKey, Math.max(limit * 4, 20))) ftsIds.add(row.id);
				} catch {}
			}
			const lower = value.toLocaleLowerCase();
			return db.query<MemoryRow, [string]>(
				"SELECT id, role, text, at, embedding FROM memory_turns WHERE topic_key = ? ORDER BY id DESC",
			).all(topicKey)
				.map((row) => {
					let stored: number[] = [];
					try { stored = JSON.parse(row.embedding) as number[]; } catch {}
					const vectorScore = Math.max(0, cosine(vector, stored));
					const lexical = row.text.toLocaleLowerCase().includes(lower) ? 0.35 : 0;
					const fts = ftsIds.has(row.id) ? 0.2 : 0;
					return { role: row.role, text: row.text, at: row.at, score: vectorScore * 0.65 + lexical + fts };
				})
				.filter((row) => row.score > 0.08)
				.sort((left, right) => right.score - left.score)
				.slice(0, Math.max(1, Math.min(limit, 10)));
		},
		clear(topicKey: string): void {
			db.run("DELETE FROM memory_turns WHERE topic_key = ?", [topicKey]);
		},
		close(): void {
			insert.finalize();
			db.run("PRAGMA wal_checkpoint(TRUNCATE)");
			db.close();
		},
	};
}

export function formatMemory(turns: MemoryTurn[], maxChars = 12_000): string {
	const selected: string[] = [];
	let size = 0;
	for (const turn of [...turns].reverse()) {
		const line = `[${turn.role === "user" ? "用户" : "助手"}]\n${turn.text}`;
		if (selected.length && size + line.length > maxChars) break;
		selected.unshift(line);
		size += line.length;
	}
	return selected.length ? `[最近对话记忆]\n${selected.join("\n\n")}\n\n` : "";
}
