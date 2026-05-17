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
    expect(buildScript).toContain('"hdiutil"');
    expect(buildScript).toContain('"internal-staging"');
    expect(buildScript).toContain('"Applications"');
  });
});
