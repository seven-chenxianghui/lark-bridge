import { describe, expect, test } from "bun:test";
import { formatValidationSummary, selectValidationScripts, validationFailurePrompt } from "../src/project-validation.js";

describe("project validation", () => {
	test("selects only supported scripts in a stable order", () => {
		expect(selectValidationScripts({ scripts: { verify: "x", start: "x", test: "x" } })).toEqual(["test", "verify"]);
		expect(selectValidationScripts({ scripts: { start: "x" } })).toEqual([]);
	});

	test("formats results and repair context", () => {
		const result = { ok: false, checks: [{ name: "test", ok: false, durationMs: 1250, output: "boom" }] };
		expect(formatValidationSummary(result)).toContain("失败：`test`（1.3s）");
		expect(validationFailurePrompt(result)).toContain("boom");
	});
});
