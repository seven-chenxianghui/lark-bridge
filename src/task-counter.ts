import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type CounterStore = { turns: Record<string, number> };

export function createTaskCounter(runtimeDir: string) {
	const path = resolve(runtimeDir, "state", "task-turns.json");
	let store: CounterStore = { turns: {} };
	try {
		if (existsSync(path)) {
			const value = JSON.parse(readFileSync(path, "utf8")) as Partial<CounterStore>;
			if (value.turns && typeof value.turns === "object") store = { turns: value.turns };
		}
	} catch {}
	const save = (): void => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
	};
	return {
		next(topicKey: string): number {
			const turn = Math.max(0, Number(store.turns[topicKey]) || 0) + 1;
			store.turns[topicKey] = turn;
			save();
			return turn;
		},
		get(topicKey: string): number {
			return Math.max(0, Number(store.turns[topicKey]) || 0);
		},
		clear(topicKey: string): void {
			delete store.turns[topicKey];
			save();
		},
	};
}
