import { describe, expect, test } from "bun:test";
import { parseCodexDisplayConfig } from "../src/codex-display-config.ts";

describe("Codex display config", () => {
	test("reads model metadata from TOML", () => {
		const config = parseCodexDisplayConfig(`
model = "gpt-test"
model_reasoning_effort = "high"
model_context_window = 200000
model_auto_compact_token_limit = 180000
`, {});
		expect(config).toEqual({ model: "gpt-test", reasoning: "high", contextWindow: 200000, compactLimit: 180000 });
	});

	test("environment overrides display values", () => {
		expect(parseCodexDisplayConfig("model = 'old'", { CODEX_MODEL: "new" }).model).toBe("new");
	});
});
