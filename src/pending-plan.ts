import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PendingPlan = {
	topicKey: string;
	prompt: string;
	createdAt: string;
};

type PendingPlanStore = { plans: Record<string, PendingPlan> };

function load(path: string): PendingPlanStore {
	try {
		if (!existsSync(path)) return { plans: {} };
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<PendingPlanStore>;
		return { plans: value.plans && typeof value.plans === "object" ? value.plans : {} };
	} catch {
		return { plans: {} };
	}
}

export function createPendingPlanRepo(runtimeDir: string) {
	const path = resolve(runtimeDir, "state", "pending-plans.json");
	let store = load(path);
	const save = (): void => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
	};

	return {
		path,
		get(topicKey: string): PendingPlan | undefined {
			const plan = store.plans[topicKey];
			return plan ? { ...plan } : undefined;
		},
		set(topicKey: string, prompt: string): PendingPlan {
			const plan = { topicKey, prompt, createdAt: new Date().toISOString() };
			store.plans[topicKey] = plan;
			save();
			return { ...plan };
		},
		consume(topicKey: string): PendingPlan | undefined {
			const plan = store.plans[topicKey];
			if (!plan) return undefined;
			delete store.plans[topicKey];
			save();
			return { ...plan };
		},
		clear(topicKey: string): void {
			if (!(topicKey in store.plans)) return;
			delete store.plans[topicKey];
			save();
		},
	};
}
