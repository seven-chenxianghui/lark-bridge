import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ScheduledTask = {
	id: string;
	topicKey: string;
	messageId: string;
	intervalMs: number;
	prompt: string;
	nextRunAt: string;
	createdAt: string;
};

type TaskStore = { tasks: ScheduledTask[] };

export function parseDuration(value: string): number | undefined {
	const match = value.trim().match(/^(\d+)(m|h|d)$/i);
	if (!match) return undefined;
	const amount = Number(match[1]);
	const unit = match[2].toLowerCase();
	if (amount < 1) return undefined;
	return amount * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
}

export function formatDuration(ms: number): string {
	if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
	if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
	return `${ms / 60_000}m`;
}

function load(path: string): TaskStore {
	try {
		if (!existsSync(path)) return { tasks: [] };
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<TaskStore>;
		return { tasks: Array.isArray(value.tasks) ? value.tasks : [] };
	} catch {
		return { tasks: [] };
	}
}

export function createScheduler(runtimeDir: string, execute: (task: ScheduledTask) => Promise<void>) {
	const path = resolve(runtimeDir, "state", "scheduled-tasks.json");
	let store = load(path);
	const running = new Set<string>();
	let timer: ReturnType<typeof setInterval> | undefined;
	const save = (): void => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
	};
	const tick = async (): Promise<void> => {
		const now = Date.now();
		for (const task of store.tasks) {
			if (running.has(task.id) || Date.parse(task.nextRunAt) > now) continue;
			running.add(task.id);
			task.nextRunAt = new Date(now + task.intervalMs).toISOString();
			save();
			void execute({ ...task }).catch((error) => console.error(`[定时任务 ${task.id}] 执行失败`, error))
				.finally(() => running.delete(task.id));
		}
	};
	return {
		path,
		add(input: Omit<ScheduledTask, "id" | "nextRunAt" | "createdAt">): ScheduledTask {
			const now = Date.now();
			const task: ScheduledTask = {
				...input,
				id: randomUUID().slice(0, 8),
				createdAt: new Date(now).toISOString(),
				nextRunAt: new Date(now + input.intervalMs).toISOString(),
			};
			store.tasks.push(task);
			save();
			return task;
		},
		list(topicKey: string): ScheduledTask[] {
			return store.tasks.filter((task) => task.topicKey === topicKey).map((task) => ({ ...task }));
		},
		remove(topicKey: string, id: string): boolean {
			const before = store.tasks.length;
			store.tasks = store.tasks.filter((task) => task.topicKey !== topicKey || task.id !== id);
			if (store.tasks.length === before) return false;
			save();
			return true;
		},
		start(): void {
			if (!timer) timer = setInterval(() => void tick(), 15_000);
		},
		stop(): void {
			if (timer) clearInterval(timer);
			timer = undefined;
		},
		tick,
	};
}
