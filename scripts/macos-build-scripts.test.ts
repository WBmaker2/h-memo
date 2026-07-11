import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("macOS build scripts", () => {
  it("uses a stable internal DMG wrapper around the Tauri app bundle", () => {
    const rootPackage = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    const desktopPackage = JSON.parse(
      readFileSync(path.resolve("apps", "desktop", "package.json"), "utf8")
    );
    const buildScript = readFileSync(
      path.resolve("scripts", "build-macos-internal.mjs"),
      "utf8"
    );

    expect(rootPackage.scripts["tauri:build:macos"]).toBe(
      "node scripts/build-macos-internal.mjs"
    );
    expect(desktopPackage.scripts["tauri:build:macos"]).toBe(
      "tauri build --bundles app"
    );
    expect(buildScript).toContain("TAURI_CONFIG_PATH");
    expect(buildScript).toContain('process.platform !== "darwin"');
    expect(buildScript).toContain(
      "이 스크립트는 macOS 전용 빌드입니다. macOS 환경에서만 실행할 수 있습니다."
    );
    expect(buildScript).toContain("readProductName");
    expect(buildScript).toContain("export function createInternalDmg()");
    expect(buildScript).toContain("const appPath = path.join(");
    expect(buildScript).toContain('"hdiutil"');
    expect(buildScript).toContain('"internal-staging"');
    expect(buildScript).toContain('"Applications"');
    expect(buildScript).not.toContain('const productName = "H Memo";');
  });

  it("cleans internal DMG staging after hdiutil succeeds or fails", () => {
    const buildScript = readFileSync(
      path.resolve("scripts", "build-macos-internal.mjs"),
      "utf8"
    );

    expect(buildScript).toMatch(
      /try\s*\{[\s\S]*run\("hdiutil"[\s\S]*\}\s*finally\s*\{/
    );
    expect(buildScript).toMatch(
      /finally\s*\{\s*rmSync\(stagingDir, \{ recursive: true, force: true \}\);\s*\}/
    );
  });

  it("throws failed command statuses instead of exiting inside run", () => {
    const buildScript = readFileSync(
      path.resolve("scripts", "build-macos-internal.mjs"),
      "utf8"
    );
    const runFunction = buildScript.match(/function run\([\s\S]*?\n\}/)?.[0];

    expect(runFunction).toBeDefined();
    expect(runFunction).toContain("throw new Error");
    expect(runFunction).not.toContain("process.exit");
  });
});
