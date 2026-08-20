import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type AccessStatus = "pending" | "authorized" | "rejected";
export type AccessRequest = {
	openId: string;
	status: AccessStatus;
	messageId: string;
	requestText: string;
	requestedAt: string;
};

export function createAccessControlRepo(runtimeDir: string, configuredOwnerOpenId = "") {
	const stateDir = resolve(runtimeDir, "state");
	mkdirSync(stateDir, { recursive: true });
	const path = resolve(stateDir, "access-control.sqlite");
	const db = new Database(path, { create: true });
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		CREATE TABLE IF NOT EXISTS access_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS access_users (
			open_id TEXT PRIMARY KEY,
			status TEXT NOT NULL CHECK(status IN ('pending', 'authorized', 'rejected')),
			message_id TEXT NOT NULL,
			request_text TEXT NOT NULL,
			requested_at TEXT NOT NULL,
			decided_at TEXT
		);
	`);

	function ownerOpenId(): string {
		return db.query<{ value: string }, []>("SELECT value FROM access_meta WHERE key = 'owner_open_id'").get()?.value || "";
	}

	function setOwner(openId: string): void {
		const value = openId.trim();
		if (!value) return;
		db.run("INSERT INTO access_meta(key, value) VALUES ('owner_open_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [value]);
	}

	if (configuredOwnerOpenId.trim()) setOwner(configuredOwnerOpenId);

	return {
		path,
		ownerOpenId,
		setOwner,
		isAuthorized(openId: string): boolean {
			if (!openId) return false;
			if (openId === ownerOpenId()) return true;
			return db.query<{ status: AccessStatus }, [string]>("SELECT status FROM access_users WHERE open_id = ?").get(openId)?.status === "authorized";
		},
		status(openId: string): AccessStatus | undefined {
			return db.query<{ status: AccessStatus }, [string]>("SELECT status FROM access_users WHERE open_id = ?").get(openId)?.status;
		},
		request(openId: string, messageId: string, requestText: string): "created" | "pending" | "authorized" {
			if (this.isAuthorized(openId)) return "authorized";
			if (this.status(openId) === "pending") return "pending";
			db.run(
				`INSERT INTO access_users(open_id, status, message_id, request_text, requested_at, decided_at)
				 VALUES (?, 'pending', ?, ?, ?, NULL)
				 ON CONFLICT(open_id) DO UPDATE SET status = 'pending', message_id = excluded.message_id,
				 request_text = excluded.request_text, requested_at = excluded.requested_at, decided_at = NULL`,
				[openId, messageId, requestText.slice(0, 1_000), new Date().toISOString()],
			);
			return "created";
		},
		get(openId: string): AccessRequest | undefined {
			const row = db.query<{
				open_id: string; status: AccessStatus; message_id: string; request_text: string; requested_at: string;
			}, [string]>("SELECT open_id, status, message_id, request_text, requested_at FROM access_users WHERE open_id = ?").get(openId);
			return row ? { openId: row.open_id, status: row.status, messageId: row.message_id, requestText: row.request_text, requestedAt: row.requested_at } : undefined;
		},
		decide(openId: string, approved: boolean): AccessRequest | undefined {
			const request = this.get(openId);
			if (!request || request.status !== "pending") return undefined;
			db.run("UPDATE access_users SET status = ?, decided_at = ? WHERE open_id = ?", [approved ? "authorized" : "rejected", new Date().toISOString(), openId]);
			return request;
		},
		close(): void {
			db.run("PRAGMA wal_checkpoint(TRUNCATE)");
			db.close();
		},
	};
}
