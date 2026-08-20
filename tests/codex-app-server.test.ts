import { describe, expect, test } from "bun:test";
import { buildSandboxPolicy, resolveCodexAppServerExecutable } from "../src/codex-app-server.js";

describe("Codex App Server execution policy", () => {
	test("uses full current-user access on Windows so D:\\Seven is reliably writable", () => {
		expect(buildSandboxPolicy("workspace-write", "D:\\Seven", "win32")).toEqual({
			type: "dangerFullAccess",
		});
	});

	test("limits non-Windows writes to the configured tree", () => {
		expect(buildSandboxPolicy("workspace-write", "/srv/seven", "linux")).toEqual({
			type: "workspaceWrite",
			writableRoots: [expect.stringContaining("srv")],
			networkAccess: true,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		});
	});

	test("keeps plan mode read-only", () => {
		expect(buildSandboxPolicy("read-only", "D:\\Seven")).toEqual({ type: "readOnly", networkAccess: true });
	});

	test("honors an explicit Codex executable", () => {
		expect(resolveCodexAppServerExecutable({ CODEX_BIN: "D:\\tools\\codex.exe" }, "win32")).toBe("D:\\tools\\codex.exe");
	});
});
