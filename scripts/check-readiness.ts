import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveCodexAppServerExecutable } from "../src/codex-app-server.ts";

export type BridgeConfig = { appId: string; appSecret: string; ownerOpenId: string };

export function parseBridgeConfig(text: string): BridgeConfig {
	const values: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const index = line.indexOf("=");
		if (index < 0) continue;
		values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
	}
	return {
		appId: values.FEISHU_APP_ID || "",
		appSecret: values.FEISHU_APP_SECRET || "",
		ownerOpenId: values.FEISHU_OWNER_OPEN_ID || "",
	};
}

export function validateBridgeConfig(config: BridgeConfig): string[] {
	const missing: string[] = [];
	if (!/^cli_[A-Za-z0-9]+$/.test(config.appId)) missing.push("FEISHU_APP_ID");
	if (!config.appSecret || /x{8,}/i.test(config.appSecret)) missing.push("FEISHU_APP_SECRET");
	return missing;
}

function runtimeDir(root: string): string {
	return process.env.RUNTIME_DIR || (process.platform === "win32"
		? resolve(root, "..", ".seven-lark-runtime")
		: resolve(homedir(), ".seven-lark-runtime"));
}

function hasPersistedOwner(root: string): boolean {
	const path = resolve(runtimeDir(root), "state", "access-control.sqlite");
	if (!existsSync(path)) return false;
	try {
		const db = new Database(path, { readonly: true });
		const owner = db.query<{ value: string }, []>("SELECT value FROM access_meta WHERE key = 'owner_open_id'").get()?.value;
		db.close();
		return Boolean(owner);
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dirname, "..");
	const configPath = resolve(root, "config", "bridge.env");
	let ready = true;
	const report = (ok: boolean, label: string, detail: string): void => {
		console.log(`[${ok ? "OK" : "MISSING"}] ${label}: ${detail}`);
		if (!ok) ready = false;
	};

	if (!existsSync(configPath)) {
		report(false, "配置", "缺少 config/bridge.env");
		process.exitCode = 1;
		return;
	}
	const config = parseBridgeConfig(readFileSync(configPath, "utf8"));
	const missing = validateBridgeConfig(config);
	report(missing.length === 0, "飞书配置", missing.length ? `请填写 ${missing.join("、")}` : "App ID 和 App Secret 已填写");
	const ownerReady = Boolean(config.ownerOpenId || hasPersistedOwner(root));
	report(ownerReady, "管理员", ownerReady ? "管理员身份已配置或已迁移" : "需要 FEISHU_OWNER_OPEN_ID 或已迁移的管理员身份");
	report(existsSync(resolve(root, "node_modules", "@larksuiteoapi", "node-sdk")), "项目依赖", "node_modules 已安装");

	const codex = resolveCodexAppServerExecutable();
	const login = spawnSync(codex, ["login", "status"], { encoding: "utf8", windowsHide: true });
	report(login.status === 0, "Codex", login.status === 0 ? "已安装并登录" : "请安装 Codex CLI 并完成登录");

	if (missing.length === 0 && !process.argv.includes("--skip-feishu")) {
		try {
			const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
				signal: AbortSignal.timeout(10_000),
			});
			const body = await response.json() as { code?: number; app_access_token?: string; msg?: string };
			report(response.ok && body.code === 0 && Boolean(body.app_access_token), "飞书连接", body.code === 0 ? "App 凭据有效" : (body.msg || "凭据验证失败"));
		} catch (error) {
			report(false, "飞书连接", `网络验证失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	console.log(ready ? "\nREADY: 当前电脑满足运行条件。" : "\nNOT READY: 请处理上面的缺失项后重新检查。");
	process.exitCode = ready ? 0 : 1;
}

if (import.meta.main) await main();
