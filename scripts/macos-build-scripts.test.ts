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
    expect(buildScript).toContain("const appPath = path.join(");
    expect(buildScript).toContain('"hdiutil"');
    expect(buildScript).toContain('"internal-staging"');
    expect(buildScript).toContain('"Applications"');
    expect(buildScript).toContain("createInternalDmgGuide");
    expect(buildScript).toContain("H Memo 내부 테스트 실행 안내.txt");
    expect(buildScript).toContain("xattr -dr com.apple.quarantine");
    expect(buildScript).toContain("createAppArchive");
    expect(buildScript).toContain("_app.tar.gz");
    expect(buildScript).toContain('"tar"');
    expect(buildScript).not.toContain('const productName = "H Memo";');
  });
});
