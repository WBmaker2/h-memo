#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const productName = "H Memo";
const desktopBundleRoot = path.resolve(
  rootDir,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle"
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readVersion() {
  const packageJsonPath = path.resolve(rootDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return String(packageJson.version);
}

function resolveMacArch() {
  if (process.env.H_MEMO_MACOS_ARCH) {
    return process.env.H_MEMO_MACOS_ARCH;
  }

  if (process.arch === "arm64") {
    return "aarch64";
  }

  if (process.arch === "x64") {
    return "x64";
  }

  return process.arch;
}

function createInternalDmg() {
  const version = readVersion();
  const appPath = path.join(desktopBundleRoot, "macos", `${productName}.app`);
  if (!existsSync(appPath)) {
    throw new Error(`macOS app bundle was not found: ${appPath}`);
  }

  const dmgDir = path.join(desktopBundleRoot, "dmg");
  const stagingDir = path.join(dmgDir, "internal-staging");
  const stagedAppPath = path.join(stagingDir, `${productName}.app`);
  const dmgPath = path.join(
    dmgDir,
    `${productName}_${version}_${resolveMacArch()}_internal.dmg`
  );

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  cpSync(appPath, stagedAppPath, { recursive: true });
  symlinkSync("/Applications", path.join(stagingDir, "Applications"));

  run("hdiutil", [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);

  rmSync(stagingDir, { recursive: true, force: true });
  console.log(`Created internal macOS DMG: ${dmgPath}`);
}

run("npm", ["run", "tauri:build:macos", "-w", "apps/desktop"]);
createInternalDmg();
