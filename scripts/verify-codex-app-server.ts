import { resolve } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { CodexAppServer } from "../src/codex-app-server.js";

const workspace = resolve(process.argv[2] || resolve(import.meta.dirname, ".."));
const writeOnly = process.argv.includes("--write-only");
const writableRoot = process.platform === "win32" ? "D:\\Seven" : resolve(workspace, "..");
const permissionProbe = resolve(writableRoot, ".seven-codex-permission-check.txt");
const server = new CodexAppServer({ cwd: workspace, writableRoot });

try {
	if (!writeOnly) {
		console.log("==> Codex App Server new thread (read-only)");
		const first = await server.runTurn({
			topicKey: "verify",
			prompt: "Reply exactly CODEX_WINDOWS_OK. Do not use tools.",
			mode: "read-only",
		});
		if (!first.threadId || !first.result.includes("CODEX_WINDOWS_OK")) {
			throw new Error("New thread did not return the expected result");
		}
		console.log(`  thread: ${first.threadId}`);

		console.log("==> Codex App Server resume thread");
		const second = await server.runTurn({
			topicKey: "verify",
			threadId: first.threadId,
			prompt: "Reply exactly CODEX_RESUME_OK. Do not use tools.",
			mode: "read-only",
		});
		if (second.threadId !== first.threadId || !second.result.includes("CODEX_RESUME_OK")) {
			throw new Error("Resumed thread did not return the expected result");
		}
	}

	console.log(`==> Codex workspace-write permission (${writableRoot})`);
	const writeResult = await server.runTurn({
		topicKey: "verify-write",
		prompt: `Use a shell command to create the file ${permissionProbe} with exactly this content: CODEX_D_SEVEN_WRITE_OK`,
		mode: "workspace-write",
		onEvent: (event) => {
			if (event.type === "tool_call") console.log(`  tool: ${JSON.stringify(event.tool_call)}`);
		},
	});
	if (!existsSync(permissionProbe) || readFileSync(permissionProbe, "utf8").trim() !== "CODEX_D_SEVEN_WRITE_OK") {
		throw new Error(`Codex could not write the permission probe under ${writableRoot}: ${writeResult.result}`);
	}
	console.log("Codex App Server verified (new thread + resume + workspace write). ");
} finally {
	server.close();
	if (existsSync(permissionProbe)) unlinkSync(permissionProbe);
}
