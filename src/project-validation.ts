import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ValidationCheck = {
	name: string;
	ok: boolean;
	durationMs: number;
	output: string;
};

export type ValidationResult = {
	ok: boolean;
	checks: ValidationCheck[];
};

export function selectValidationScripts(packageJson: { scripts?: Record<string, string> }): string[] {
	const scripts = packageJson.scripts || {};
	return ["test", "verify"].filter((name) => Boolean(scripts[name]));
}

function runScript(root: string, name: string, timeoutMs: number, signal?: AbortSignal): Promise<ValidationCheck> {
	return new Promise((resolveCheck) => {
		const startedAt = Date.now();
		const child = spawn(process.execPath, ["run", name], {
			cwd: root,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let output = "";
		let timedOut = false;
		let aborted = false;
		let settled = false;
		const finish = (check: ValidationCheck): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			resolveCheck(check);
		};
		const abort = (): void => {
			aborted = true;
			try { child.kill("SIGTERM"); } catch {}
		};
		const append = (chunk: Buffer): void => {
			output = `${output}${chunk.toString("utf8")}`.slice(-6_000);
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const timer = setTimeout(() => {
			timedOut = true;
			try { child.kill("SIGTERM"); } catch {}
		}, timeoutMs);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		child.on("error", (error) => {
			finish({ name, ok: false, durationMs: Date.now() - startedAt, output: String(error) });
		});
		child.on("close", (code) => {
			finish({
				name,
				ok: !timedOut && !aborted && code === 0,
				durationMs: Date.now() - startedAt,
				output: aborted ? `${output}\nValidation cancelled.`.trim() : timedOut ? `${output}\nValidation timed out.`.trim() : output.trim(),
			});
		});
	});
}

export async function runProjectValidation(root: string, timeoutMs = 10 * 60_000, signal?: AbortSignal): Promise<ValidationResult> {
	const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
	const checks: ValidationCheck[] = [];
	for (const name of selectValidationScripts(packageJson)) {
		if (signal?.aborted) break;
		checks.push(await runScript(root, name, timeoutMs, signal));
	}
	return { ok: checks.every((check) => check.ok), checks };
}

export function formatValidationSummary(result: ValidationResult): string {
	if (!result.checks.length) return "**自动验收**\n- 未配置测试或验证脚本";
	return [
		"**自动验收**",
		...result.checks.map((check) => `- ${check.ok ? "通过" : "失败"}：\`${check.name}\`（${(check.durationMs / 1000).toFixed(1)}s）`),
	].join("\n");
}

export function validationFailurePrompt(result: ValidationResult): string {
	const failed = result.checks.filter((check) => !check.ok);
	return [
		"[自动验收修复]",
		"你刚才的改动未通过项目验收。请分析以下输出，修复问题，并再次确保改动满足原始需求。不要只解释，直接完成修复。",
		...failed.map((check) => `\n## ${check.name}\n\`\`\`text\n${check.output.slice(-4_000)}\n\`\`\``),
	].join("\n");
}
