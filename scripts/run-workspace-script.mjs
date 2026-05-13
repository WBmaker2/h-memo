#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const scriptName = process.argv[2];

if (!scriptName) {
  console.error("Usage: node scripts/run-workspace-script.mjs <scriptName>");
  process.exit(1);
}

function discoverWorkspaces() {
  const workspaceRoots = ["apps", "packages"];
  const workspaces = [];

  for (const root of workspaceRoots) {
    if (!existsSync(root)) continue;

    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workspacePath = join(root, entry.name);
      const pkgPath = join(workspacePath, "package.json");
      if (!existsSync(pkgPath)) continue;

      workspaces.push(workspacePath);
    }
  }

  return workspaces;
}

function runScriptInWorkspace(workspacePath, scriptName) {
  const packageJsonPath = join(workspacePath, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts || {};

  if (!scripts[scriptName]) {
    return { workspacePath, skipped: true };
  }

  execFileSync("npm", ["run", scriptName, "-w", workspacePath], {
    stdio: "inherit",
  });

  return { workspacePath, skipped: false };
}

function main() {
  const workspaces = discoverWorkspaces();
  let didRun = false;

  for (const workspacePath of workspaces) {
    const result = runScriptInWorkspace(workspacePath, scriptName);
    if (result.skipped) {
      console.info(`[workspace-script] skip ${workspacePath}: no '${scriptName}' script`);
      continue;
    }
    didRun = true;
    console.info(`[workspace-script] ran ${scriptName} in ${workspacePath}`);
  }

  if (!didRun) {
    console.info(`[workspace-script] no workspaces with script '${scriptName}'.`);
  }
}

main();
