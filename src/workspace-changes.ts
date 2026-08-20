import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export type WorkspaceSnapshot = Map<string, string>;
const IGNORED = new Set([".git", "node_modules"]);

export function snapshotWorkspace(root: string): WorkspaceSnapshot {
	const snapshot: WorkspaceSnapshot = new Map();
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) {
				const stat = statSync(path);
				snapshot.set(relative(root, path).replace(/\\/g, "/"), `${stat.size}:${stat.mtimeMs}`);
			}
		}
	};
	try { walk(root); } catch {}
	return snapshot;
}

export function changedFiles(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
	const files = new Set([...before.keys(), ...after.keys()]);
	return [...files].filter((file) => before.get(file) !== after.get(file)).sort();
}
