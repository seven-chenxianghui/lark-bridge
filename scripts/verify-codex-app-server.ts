import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CodexAppServer } from "../src/codex-app-server.js";

const workspace = resolve(process.argv[2] || resolve(import.meta.dirname, ".."));
const writeOnly = process.argv.includes("--write-only");
const writableRoot = process.platform === "win32" ? "D:\\Seven" : resolve(workspace, "..");
const permissionProbe = resolve(writableRoot, ".seven-codex-permission-check.txt");
const runtimeDir = process.env.RUNTIME_DIR || (process.platform === "win32"
	? resolve(workspace, "..", ".seven-lark-runtime")
	: resolve(homedir(), ".seven-lark-runtime"));
const statePath = resolve(runtimeDir, "state", "codex-verification.json");
const server = new CodexAppServer({ cwd: workspace, writableRoot });
let threadId = readVerificationThreadId();

function readVerificationThreadId(): string | undefined {
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8")) as { threadId?: unknown };
		return typeof state.threadId === "string" && state.threadId.trim() ? state.threadId : undefined;
	} catch {
		return undefined;
	}
}

function saveVerificationThreadId(id: string): void {
	mkdirSync(resolve(runtimeDir, "state"), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify({ threadId: id }, null, 2)}\n`, "utf8");
	threadId = id;
}

async function runVerificationTurn(input: {
	prompt: string;
	mode: "read-only" | "workspace-write";
	onEvent?: Parameters<CodexAppServer["runTurn"]>[0]["onEvent"];
}) {
	return server.runTurn({
		topicKey: "verify",
		threadId,
		...input,
		onStarted: saveVerificationThreadId,
	});
}

try {
	if (threadId) {
		try {
			await server.unarchiveThread(threadId);
			console.log(`==> Reusing archived Codex verification thread: ${threadId}`);
		} catch {
			console.warn(`==> Saved verification thread is unavailable; creating one replacement: ${threadId}`);
			threadId = undefined;
		}
	}

	if (!writeOnly) {
		console.log(`==> Codex App Server ${threadId ? "reused" : "new"} thread (read-only)`);
		const first = await runVerificationTurn({
			prompt: "Reply exactly CODEX_WINDOWS_OK. Do not use tools.",
			mode: "read-only",
		});
		if (!first.threadId || !first.result.includes("CODEX_WINDOWS_OK")) {
			throw new Error("New thread did not return the expected result");
		}
		console.log(`  thread: ${first.threadId}`);

		console.log("==> Codex App Server resume thread");
		const second = await runVerificationTurn({
			prompt: "Reply exactly CODEX_RESUME_OK. Do not use tools.",
			mode: "read-only",
		});
		if (second.threadId !== first.threadId || !second.result.includes("CODEX_RESUME_OK")) {
			throw new Error("Resumed thread did not return the expected result");
		}
	}

	console.log(`==> Codex workspace-write permission (${writableRoot})`);
	const writeResult = await runVerificationTurn({
		prompt: `Use a shell command to create the file ${permissionProbe} with exactly this content: CODEX_D_SEVEN_WRITE_OK`,
		mode: "workspace-write",
		onEvent: (event) => {
			if (event.type === "tool_call") console.log(`  tool: ${JSON.stringify(event.tool_call)}`);
		},
	});
	if (!existsSync(permissionProbe) || readFileSync(permissionProbe, "utf8").trim() !== "CODEX_D_SEVEN_WRITE_OK") {
		throw new Error(`Codex could not write the permission probe under ${writableRoot}: ${writeResult.result}`);
	}
	console.log("Codex App Server verified (fixed thread + resume + workspace write).");
} finally {
	if (existsSync(permissionProbe)) unlinkSync(permissionProbe);
	try {
		if (threadId) {
			await server.archiveThread(threadId);
			console.log(`==> Archived Codex verification thread: ${threadId}`);
		}
	} finally {
		server.close();
	}
}
