import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectVersionEntries,
  checkVersionConsistency,
  parseArgs,
  runVersionCheck,
} from "./lib/check-version-consistency.js";

function createFixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "h-memo-version-check-"));
  const paths = {
    root,
    appsDir: path.join(root, "apps"),
    packagesDir: path.join(root, "packages"),
  };

  mkdirSync(paths.appsDir, { recursive: true });
  mkdirSync(paths.packagesDir, { recursive: true });

  return {
    root: paths.root,
    mkdirDesktop() {
      const appRoot = path.join(paths.appsDir, "desktop", "src-tauri");
      mkdirSync(appRoot, { recursive: true });
      return path.join(paths.appsDir, "desktop");
    },
    mkdirWorkspacePackage(name) {
      const packageRoot = path.join(paths.packagesDir, name);
      mkdirSync(path.join(packageRoot), { recursive: true });
      return packageRoot;
    },
    cleanup() {
      rmSync(paths.root, { recursive: true, force: true });
    },
  };
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data)}\n`);
}

function writeCargoToml(filePath, version) {
  writeFileSync(
    filePath,
    `[package]\nname = "h-memo-desktop"\nversion = "${version}" # release version\n`
  );
}

describe("check-version-consistency args", () => {
  it("parses supported options", () => {
    const parsed = parseArgs([
      "--root",
      "/tmp/h-memo",
      "--workspace-patterns",
      "apps/*,packages/*,custom.json",
      "--root-package",
      "package.root.json",
      "--desktop-package",
      "apps/desktop/package.json",
      "--tauri-conf",
      "apps/desktop/src-tauri/tauri.conf.json",
      "--cargo",
      "apps/desktop/src-tauri/Cargo.toml",
      "--release-tag",
      "v0.9.0",
    ]);

    expect(parsed.rootDir).toBe("/tmp/h-memo");
    expect(parsed.rootPackagePath).toBe("package.root.json");
    expect(parsed.workspacePatterns).toEqual([
      "apps/*",
      "packages/*",
      "custom.json",
    ]);
    expect(parsed.tauriConfigPath).toBe("apps/desktop/src-tauri/tauri.conf.json");
    expect(parsed.desktopPackagePath).toBe("apps/desktop/package.json");
    expect(parsed.cargoTomlPath).toBe("apps/desktop/src-tauri/Cargo.toml");
    expect(parsed.releaseTag).toBe("v0.9.0");
  });
});

describe("check-version-consistency", () => {
  it("passes when all managed version fields match", () => {
    const fixture = createFixtureRoot();
    try {
      const coreRoot = fixture.mkdirDesktop();
      const packageRoot1 = fixture.mkdirWorkspacePackage("memo-core");
      const packageRoot2 = fixture.mkdirWorkspacePackage("memo-ui");
      const packageRoot3 = fixture.mkdirWorkspacePackage("memo-sync");

      writeJson(path.join(fixture.root, "package.json"), {
        name: "h-memo",
        version: "0.9.0",
      });
      writeJson(path.join(coreRoot, "package.json"), {
        name: "@h-memo/desktop",
        version: "0.9.0",
      });
      writeJson(path.join(coreRoot, "src-tauri", "tauri.conf.json"), {
        productName: "H Memo",
        identifier: "com.hmemo.desktop",
        version: "0.9.0",
      });
      writeJson(path.join(packageRoot1, "package.json"), {
        name: "@h-memo/memo-core",
        version: "0.9.0",
      });
      writeJson(path.join(packageRoot2, "package.json"), {
        name: "@h-memo/memo-ui",
        version: "0.9.0",
      });
      writeJson(path.join(packageRoot3, "package.json"), {
        name: "@h-memo/memo-sync",
        version: "0.9.0",
      });
      writeCargoToml(path.join(coreRoot, "src-tauri", "Cargo.toml"), "0.9.0");

      const entries = collectVersionEntries({ rootDir: fixture.root });
      const result = checkVersionConsistency(entries);

      expect(result.allMatch).toBe(true);
      expect(result.expectedVersion).toBe("0.9.0");
      expect(entries).toHaveLength(7);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports mismatches from runVersionCheck", () => {
    const fixture = createFixtureRoot();
    try {
      const coreRoot = fixture.mkdirDesktop();
      const packageRoot1 = fixture.mkdirWorkspacePackage("memo-core");
      const packageRoot2 = fixture.mkdirWorkspacePackage("memo-ui");
      const packageRoot3 = fixture.mkdirWorkspacePackage("memo-sync");

      writeJson(path.join(fixture.root, "package.json"), {
        name: "h-memo",
        version: "1.0.0",
      });
      writeJson(path.join(coreRoot, "package.json"), {
        name: "@h-memo/desktop",
        version: "1.0.1",
      });
      writeJson(path.join(coreRoot, "src-tauri", "tauri.conf.json"), {
        productName: "H Memo",
        identifier: "com.hmemo.desktop",
        version: "1.0.0",
      });
      writeJson(path.join(packageRoot1, "package.json"), {
        name: "@h-memo/memo-core",
        version: "1.0.0",
      });
      writeJson(path.join(packageRoot2, "package.json"), {
        name: "@h-memo/memo-ui",
        version: "1.0.0",
      });
      writeJson(path.join(packageRoot3, "package.json"), {
        name: "@h-memo/memo-sync",
        version: "1.0.0",
      });
      writeCargoToml(path.join(coreRoot, "src-tauri", "Cargo.toml"), "1.0.0");

      const result = runVersionCheck({ rootDir: fixture.root });
      expect(result.allMatch).toBe(false);
      expect(result.mismatches).toEqual([
        expect.objectContaining({
          version: "1.0.1",
          expected: "1.0.0",
        }),
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it("passes when the release tag matches the shared version", () => {
    const fixture = createFixtureRoot();
    try {
      const desktopRoot = fixture.mkdirDesktop();
      const packageRoot = fixture.mkdirWorkspacePackage("memo-core");

      writeJson(path.join(fixture.root, "package.json"), {
        name: "h-memo",
        version: "2.0.0",
      });
      writeJson(path.join(desktopRoot, "package.json"), {
        name: "@h-memo/desktop",
        version: "2.0.0",
      });
      writeJson(path.join(desktopRoot, "src-tauri", "tauri.conf.json"), {
        productName: "H Memo",
        identifier: "com.hmemo.desktop",
        version: "2.0.0",
      });
      writeJson(path.join(packageRoot, "package.json"), {
        name: "@h-memo/memo-core",
        version: "2.0.0",
      });
      writeCargoToml(path.join(desktopRoot, "src-tauri", "Cargo.toml"), "2.0.0");

      const result = runVersionCheck({
        rootDir: fixture.root,
        releaseTag: "v2.0.0",
      });

      expect(result.allMatch).toBe(true);
      expect(result.releaseTagCheck).toEqual(
        expect.objectContaining({
          ok: true,
          releaseTag: "v2.0.0",
          tagVersion: "2.0.0",
          expectedTag: "v2.0.0",
        })
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("fails the release tag check when the tag is malformed or mismatched", () => {
    const fixture = createFixtureRoot();
    try {
      const desktopRoot = fixture.mkdirDesktop();

      writeJson(path.join(fixture.root, "package.json"), {
        name: "h-memo",
        version: "2.0.0",
      });
      writeJson(path.join(desktopRoot, "package.json"), {
        name: "@h-memo/desktop",
        version: "2.0.0",
      });
      writeJson(path.join(desktopRoot, "src-tauri", "tauri.conf.json"), {
        productName: "H Memo",
        identifier: "com.hmemo.desktop",
        version: "2.0.0",
      });
      writeCargoToml(path.join(desktopRoot, "src-tauri", "Cargo.toml"), "2.0.0");

      const noPrefix = runVersionCheck({
        rootDir: fixture.root,
        releaseTag: "2.0.0",
      });
      const mismatched = runVersionCheck({
        rootDir: fixture.root,
        releaseTag: "v2.0.1",
      });

      expect(noPrefix.releaseTagCheck).toEqual(
        expect.objectContaining({
          ok: false,
          expectedTag: "v2.0.0",
        })
      );
      expect(noPrefix.releaseTagCheck.failures[0]).toMatch(
        /must start with 'v'/
      );
      expect(mismatched.releaseTagCheck).toEqual(
        expect.objectContaining({
          ok: false,
          releaseTag: "v2.0.1",
          expectedTag: "v2.0.0",
        })
      );
      expect(mismatched.releaseTagCheck.failures[0]).toMatch(
        /does not match shared version/
      );
    } finally {
      fixture.cleanup();
    }
  });
});
