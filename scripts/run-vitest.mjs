import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSTORAGE_FLAGS = new Set([
  "--experimental-webstorage",
  "--webstorage",
  "--no-experimental-webstorage",
]);

export function buildNodeOptions(existingNodeOptions = process.env.NODE_OPTIONS ?? "") {
  const existingOptions = existingNodeOptions
    .split(/\s+/)
    .map((option) => option.trim())
    .filter((option) => option !== "" && !WEBSTORAGE_FLAGS.has(option));

  if (process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")) {
    existingOptions.push("--no-experimental-webstorage");
  }

  return existingOptions.join(" ");
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");
  const vitestCliPath = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
  const result = spawnSync(process.execPath, [vitestCliPath, ...process.argv.slice(2)], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_OPTIONS: buildNodeOptions(),
    },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
