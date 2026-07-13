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
import { fileURLToPath } from "node:url";

const DEFAULT_FILE_SYSTEM = {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
};

function resolveBuildPaths(rootDir) {
  const TAURI_CONFIG_PATH = path.resolve(
    rootDir,
    "apps",
    "desktop",
    "src-tauri",
    "tauri.conf.json"
  );
  const desktopBundleRoot = path.resolve(
    rootDir,
    "apps",
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle"
  );

  return { TAURI_CONFIG_PATH, desktopBundleRoot };
}

function ensureMacosOnly() {
  if (process.platform !== "darwin") {
    console.error("이 스크립트는 macOS 전용 빌드입니다. macOS 환경에서만 실행할 수 있습니다.");
    process.exit(1);
  }
}

function readProductName(tauriConfigPath, readFile) {
  const config = JSON.parse(readFile(tauriConfigPath, "utf8"));
  const productName = config.productName;

  if (typeof productName !== "string" || productName.length === 0) {
    throw new Error(`productName is missing in ${tauriConfigPath}`);
  }

  return productName;
}

function run(command, args, rootDir) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 1}`);
  }
}

function readVersion(rootDir, readFile) {
  const packageJsonPath = path.resolve(rootDir, "package.json");
  const packageJson = JSON.parse(readFile(packageJsonPath, "utf8"));
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

export function createInternalDmg({
  rootDir = process.cwd(),
  fileSystem = DEFAULT_FILE_SYSTEM,
  runCommand = (command, args) => run(command, args, rootDir),
  log = console.log,
} = {}) {
  const { TAURI_CONFIG_PATH, desktopBundleRoot } = resolveBuildPaths(rootDir);
  const {
    cpSync: copy,
    existsSync: exists,
    mkdirSync: makeDirectory,
    readFileSync: readFile,
    rmSync: remove,
    symlinkSync: symlink,
  } = fileSystem;
  const version = readVersion(rootDir, readFile);
  const productName = readProductName(TAURI_CONFIG_PATH, readFile);
  const appPath = path.join(desktopBundleRoot, "macos", `${productName}.app`);
  if (!exists(appPath)) {
    throw new Error(`macOS app bundle was not found: ${appPath}`);
  }

  const dmgDir = path.join(desktopBundleRoot, "dmg");
  const stagingDir = path.join(dmgDir, "internal-staging");
  const stagedAppPath = path.join(stagingDir, `${productName}.app`);
  const dmgPath = path.join(
    dmgDir,
    `${productName}_${version}_${resolveMacArch()}_internal.dmg`
  );

  try {
    remove(stagingDir, { recursive: true, force: true });
    makeDirectory(stagingDir, { recursive: true });
    copy(appPath, stagedAppPath, { recursive: true });
    symlink("/Applications", path.join(stagingDir, "Applications"));

    runCommand("hdiutil", [
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
  } finally {
    remove(stagingDir, { recursive: true, force: true });
  }

  log(`Created internal macOS DMG: ${dmgPath}`);
}

function isCliEntryPoint() {
  const entryPath = process.argv[1];
  return entryPath && path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isCliEntryPoint()) {
  const rootDir = process.cwd();
  ensureMacosOnly();
  run("npm", ["run", "tauri:build:macos", "-w", "apps/desktop"], rootDir);
  createInternalDmg({ rootDir });
}
