import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packRoot, "src");
const outputFile = join(tmpdir(), `seven-lark-bridge-${process.pid}.js`);
const blocked = ["easy" + "go", "cur" + "sor", "AGENT_BIN"];
const npmBun = process.env.APPDATA
  ? join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", "bun.exe")
  : "";
const bunBin = process.platform === "win32" && existsSync(npmBun) ? npmBun : "bun";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "bun.lock") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

for (const path of sourceFiles(sourceDir)) {
  const text = readFileSync(path, "utf8").toLowerCase();
  const match = blocked.find((value) => text.includes(value.toLowerCase()));
  if (match) throw new Error(`Legacy execution path found in ${path}`);
}

try {
  const result = spawnSync(
    bunBin,
    ["build", "src/server.ts", "--target=bun", "--outfile", outputFile],
    { cwd: packRoot, encoding: "utf8", stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log("Seven Lark Bridge source verified");
} finally {
  rmSync(outputFile, { force: true });
}
