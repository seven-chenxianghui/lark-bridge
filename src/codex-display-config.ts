import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type CodexDisplayConfig = {
	model: string;
	reasoning: string;
	contextWindow?: number;
	compactLimit?: number;
};

export function parseCodexDisplayConfig(text: string, env: NodeJS.ProcessEnv = process.env): CodexDisplayConfig {
	let value: Record<string, unknown> = {};
	try { value = Bun.TOML.parse(text) as Record<string, unknown>; } catch {}
	const positiveNumber = (input: unknown): number | undefined => {
		const number = Number(input);
		return Number.isFinite(number) && number > 0 ? number : undefined;
	};
	return {
		model: (env.CODEX_MODEL || String(value.model || "Codex")).trim(),
		reasoning: (env.CODEX_REASONING_EFFORT || String(value.model_reasoning_effort || "默认")).trim(),
		contextWindow: positiveNumber(env.CODEX_CONTEXT_WINDOW || value.model_context_window),
		compactLimit: positiveNumber(env.CODEX_COMPACT_LIMIT || value.model_auto_compact_token_limit),
	};
}

export function loadCodexDisplayConfig(env: NodeJS.ProcessEnv = process.env): CodexDisplayConfig {
	const home = env.CODEX_HOME || resolve(env.USERPROFILE || env.HOME || ".", ".codex");
	const path = resolve(home, "config.toml");
	return parseCodexDisplayConfig(existsSync(path) ? readFileSync(path, "utf8") : "", env);
}
