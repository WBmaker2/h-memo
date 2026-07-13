import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const buildScriptUrl = pathToFileURL(
  path.resolve("scripts", "build-macos-internal.mjs")
).href;

function runDmgScenario(runCommandBody: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import {
          existsSync,
          mkdirSync,
          mkdtempSync,
          rmSync,
          writeFileSync,
        } from "node:fs";
        import os from "node:os";
        import path from "node:path";

        Object.defineProperty(process, "platform", { value: "linux" });

        const { createInternalDmg } = await import(${JSON.stringify(buildScriptUrl)});
        const rootDir = mkdtempSync(path.join(os.tmpdir(), "h-memo-dmg-test-"));
        const productName = "H Memo Test";
        const macosDir = path.join(
          rootDir,
          "apps",
          "desktop",
          "src-tauri",
          "target",
          "release",
          "bundle",
          "macos"
        );
        const stagingDir = path.join(
          rootDir,
          "apps",
          "desktop",
          "src-tauri",
          "target",
          "release",
          "bundle",
          "dmg",
          "internal-staging"
        );

        try {
          mkdirSync(path.join(macosDir, productName + ".app"), { recursive: true });
          writeFileSync(
            path.join(rootDir, "package.json"),
            JSON.stringify({ version: "1.2.3" })
          );
          writeFileSync(
            path.join(rootDir, "apps", "desktop", "src-tauri", "tauri.conf.json"),
            JSON.stringify({ productName })
          );

          let runWasCalled = false;
          let thrownMessage;
          try {
            createInternalDmg({
              rootDir,
              log: () => {},
              runCommand: () => {
                runWasCalled = true;
                ${runCommandBody}
              },
            });
          } catch (error) {
            thrownMessage = error.message;
          }

          console.log(
            JSON.stringify({
              runWasCalled,
              stagingExists: existsSync(stagingDir),
              thrownMessage,
            })
          );
        } finally {
          rmSync(rootDir, { recursive: true, force: true });
        }
      `,
    ],
    { encoding: "utf8" }
  );
}

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
    expect(buildScript).toContain("export function createInternalDmg(");
    expect(buildScript).toContain("const appPath = path.join(");
    expect(buildScript).toContain('"hdiutil"');
    expect(buildScript).toContain('"internal-staging"');
    expect(buildScript).toContain('"Applications"');
    expect(buildScript).not.toContain('const productName = "H Memo";');
  });

  it("cleans temporary staging after a successful DMG command", () => {
    const result = runDmgScenario("");

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      runWasCalled: true,
      stagingExists: false,
    });
  });

  it("cleans temporary staging after a throwing DMG command", () => {
    const result = runDmgScenario('throw new Error("simulated hdiutil failure");');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      runWasCalled: true,
      stagingExists: false,
      thrownMessage: "simulated hdiutil failure",
    });
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
