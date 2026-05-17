#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
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
const INTERNAL_TEST_GUIDE_FILE_NAME = "H Memo 내부 테스트 실행 안내.txt";

function ensureMacosOnly() {
  if (process.platform !== "darwin") {
    console.error("이 스크립트는 macOS 전용 빌드입니다. macOS 환경에서만 실행할 수 있습니다.");
    process.exit(1);
  }
}

function readProductName() {
  const config = JSON.parse(readFileSync(TAURI_CONFIG_PATH, "utf8"));
  const productName = config.productName;

  if (typeof productName !== "string" || productName.length === 0) {
    throw new Error(`productName is missing in ${TAURI_CONFIG_PATH}`);
  }

  return productName;
}

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

function createInternalDmgGuide(stagingDir, productName) {
  const guideText = [
    `${productName} macOS 내부 테스트 실행 안내`,
    "",
    "이 앱은 Apple Developer ID 서명과 notarization이 적용되지 않은 내부 테스트용 빌드입니다.",
    "macOS 보안 경고가 나타나는 것은 예상된 동작입니다.",
    "",
    "권장 실행 방법",
    `1. 이 DMG 안의 ${productName}.app을 Applications 폴더로 드래그해서 복사하세요.`,
    `2. Applications 폴더에서 ${productName}.app을 Control-클릭 또는 오른쪽 클릭하세요.`,
    "3. 메뉴에서 열기를 선택하고, macOS가 다시 확인하면 열기를 선택하세요.",
    "",
    "그래도 열리지 않으면 시스템 설정 > 개인정보 보호 및 보안에서 차단된 앱의 그래도 열기를 선택하세요.",
    "",
    "내부 테스트용 터미널 우회 방법",
    `xattr -dr com.apple.quarantine "/Applications/${productName}.app"`,
    `open "/Applications/${productName}.app"`,
    "",
    "일반 사용자에게 경고 없이 배포하려면 Apple Developer Program, Developer ID 서명, notarization이 필요합니다.",
    "",
  ].join("\n");

  writeFileSync(
    path.join(stagingDir, INTERNAL_TEST_GUIDE_FILE_NAME),
    guideText,
    "utf8"
  );
}

function createAppArchive() {
  const version = readVersion();
  const productName = readProductName();
  const appDir = path.join(desktopBundleRoot, "macos");
  const appPath = path.join(appDir, `${productName}.app`);
  if (!existsSync(appPath)) {
    throw new Error(`macOS app bundle was not found: ${appPath}`);
  }

  const archivePath = path.join(
    appDir,
    `${productName}_${version}_${resolveMacArch()}_app.tar.gz`
  );

  rmSync(archivePath, { force: true });
  run("tar", ["-czf", archivePath, "-C", appDir, `${productName}.app`]);
  console.log(`Created macOS app archive: ${archivePath}`);
}

function createInternalDmg() {
  const version = readVersion();
  const productName = readProductName();
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
  createInternalDmgGuide(stagingDir, productName);

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

ensureMacosOnly();
run("npm", ["run", "tauri:build:macos", "-w", "apps/desktop"]);
createAppArchive();
createInternalDmg();
