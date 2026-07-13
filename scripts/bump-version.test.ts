import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bumpPatch, bumpVersion, parseArgs } from "./lib/bump-version.js";

const VERSION = "1.0.0";

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workspacePackage(name: string, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>) {
  return {
    name,
    version: VERSION,
    ...(dependencies ? { dependencies } : {}),
    ...(peerDependencies ? { peerDependencies } : {}),
  };
}

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "h-memo-bump-version-"));
  const desktopTauri = path.join(root, "apps", "desktop", "src-tauri");
  mkdirSync(desktopTauri, { recursive: true });
  mkdirSync(path.join(root, "apps", "web"), { recursive: true });
  for (const name of ["memo-core", "memo-sync", "memo-ui"]) {
    mkdirSync(path.join(root, "packages", name), { recursive: true });
  }

  const desktopDependencies = {
    "@h-memo/memo-core": VERSION,
    "@h-memo/memo-sync": VERSION,
    "@h-memo/memo-ui": VERSION,
    react: "^19.0.0",
  };
  const webDependencies = {
    "@h-memo/memo-core": VERSION,
    "@h-memo/memo-sync": VERSION,
    "@h-memo/memo-ui": VERSION,
    react: "^19.0.0",
  };

  writeJson(path.join(root, "package.json"), { name: "h-memo", version: VERSION });
  writeJson(
    path.join(root, "apps", "desktop", "package.json"),
    workspacePackage("@h-memo/desktop", desktopDependencies)
  );
  writeJson(
    path.join(root, "apps", "web", "package.json"),
    workspacePackage("@h-memo/web", webDependencies)
  );
  writeJson(
    path.join(root, "packages", "memo-core", "package.json"),
    workspacePackage("@h-memo/memo-core")
  );
  writeJson(
    path.join(root, "packages", "memo-sync", "package.json"),
    workspacePackage("@h-memo/memo-sync", { "@h-memo/memo-core": "file:../memo-core" })
  );
  writeJson(
    path.join(root, "packages", "memo-ui", "package.json"),
    workspacePackage(
      "@h-memo/memo-ui",
      { "@h-memo/memo-core": "file:../memo-core" },
      { "@h-memo/memo-core": VERSION }
    )
  );

  const packages = {
    "": { name: "h-memo", version: VERSION },
    "apps/desktop": workspacePackage("@h-memo/desktop", { ...desktopDependencies }),
    "apps/web": workspacePackage("@h-memo/web", { ...webDependencies }),
    "packages/memo-core": workspacePackage("@h-memo/memo-core"),
    "packages/memo-sync": workspacePackage("@h-memo/memo-sync", {
      "@h-memo/memo-core": "file:../memo-core",
    }),
    "packages/memo-ui": workspacePackage(
      "@h-memo/memo-ui",
      { "@h-memo/memo-core": "file:../memo-core" },
      { "@h-memo/memo-core": VERSION }
    ),
  };
  writeJson(path.join(root, "package-lock.json"), {
    lockfileVersion: 3,
    version: VERSION,
    packages,
  });
  writeJson(path.join(desktopTauri, "tauri.conf.json"), { productName: "H Memo", version: VERSION });
  writeFileSync(
    path.join(desktopTauri, "Cargo.toml"),
    `[package]\nname = "h-memo-desktop"\nversion = "${VERSION}" # release version\n\n[dependencies]\nexample = "1"\n`
  );
  writeFileSync(
    path.join(desktopTauri, "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "other-package"\nversion = "9.9.9"\n\n[[package]]\nname = "h-memo-desktop"\nversion = "${VERSION}"\ndependencies = []\n`
  );

  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    readJson(relativePath: string) {
      return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
    },
    read(relativePath: string) {
      return readFileSync(path.join(root, relativePath), "utf8");
    },
    writeJson(relativePath: string, value: unknown) {
      writeJson(path.join(root, relativePath), value);
    },
  };
}

describe("bump-version", () => {
  it("requires the patch mode and parses the root option", () => {
    expect(parseArgs(["--patch", "--root", "/tmp/h-memo"])).toEqual({
      patch: true,
      rootDir: "/tmp/h-memo",
    });
    expect(() => parseArgs([])).toThrow("Exactly one bump type is required");
    expect(() => parseArgs(["--patch", "--minor"])).toThrow("Unknown option");
  });

  it("increments only the patch component of an exact semver", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
    expect(bumpPatch("12.4.9")).toBe("12.4.10");
    expect(bumpPatch("1.0.9007199254740991")).toBe("1.0.9007199254740992");
    expect(bumpPatch("1.0.9007199254740992")).toBe("1.0.9007199254740993");
    expect(() => bumpPatch("v1.0.0")).toThrow("Invalid exact semver");
  });

  it("updates every managed version and exact internal dependency", () => {
    const fixture = createFixture();
    try {
      expect(bumpVersion({ rootDir: fixture.root })).toBe("1.0.1");

      for (const filePath of [
        "package.json",
        "apps/desktop/package.json",
        "apps/web/package.json",
        "packages/memo-core/package.json",
        "packages/memo-sync/package.json",
        "packages/memo-ui/package.json",
      ]) {
        expect(fixture.readJson(filePath).version).toBe("1.0.1");
      }

      const desktopPackage = fixture.readJson("apps/desktop/package.json");
      expect(desktopPackage.dependencies["@h-memo/memo-core"]).toBe("1.0.1");
      expect(desktopPackage.dependencies.react).toBe("^19.0.0");
      expect(fixture.readJson("packages/memo-sync/package.json").dependencies["@h-memo/memo-core"]).toBe(
        "file:../memo-core"
      );
      expect(fixture.readJson("packages/memo-ui/package.json").peerDependencies["@h-memo/memo-core"]).toBe(
        "1.0.1"
      );

      const lockfile = fixture.readJson("package-lock.json");
      expect(lockfile.version).toBe("1.0.1");
      expect(lockfile.packages[""].version).toBe("1.0.1");
      expect(lockfile.packages["apps/web"].dependencies["@h-memo/memo-ui"]).toBe("1.0.1");
      expect(lockfile.packages["packages/memo-ui"].dependencies["@h-memo/memo-core"]).toBe(
        "file:../memo-core"
      );
      expect(lockfile.packages["packages/memo-ui"].peerDependencies["@h-memo/memo-core"]).toBe(
        "1.0.1"
      );
      expect(fixture.readJson("apps/desktop/src-tauri/tauri.conf.json").version).toBe("1.0.1");
      expect(fixture.read("apps/desktop/src-tauri/Cargo.toml")).toContain('version = "1.0.1" # release version');
      expect(fixture.read("apps/desktop/src-tauri/Cargo.toml")).toContain('[dependencies]\nexample = "1"');
      expect(fixture.read("apps/desktop/src-tauri/Cargo.lock")).toContain(
        'name = "h-memo-desktop"\nversion = "1.0.1"'
      );
      expect(fixture.read("apps/desktop/src-tauri/Cargo.lock")).toContain(
        'name = "other-package"\nversion = "9.9.9"'
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("prints only the new version to stdout when invoked through the CLI", () => {
    const fixture = createFixture();
    try {
      const output = execFileSync(
        process.execPath,
        ["scripts/bump-version.mjs", "--patch", "--root", fixture.root],
        { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" }
      );

      expect(output).toBe("1.0.1\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed without writing when an exact internal dependency is inconsistent", () => {
    const fixture = createFixture();
    try {
      const webPackage = fixture.readJson("apps/web/package.json");
      webPackage.dependencies["@h-memo/memo-core"] = "1.0.2";
      fixture.writeJson("apps/web/package.json", webPackage);
      const rootBefore = fixture.read("package.json");
      const lockBefore = fixture.read("package-lock.json");

      expect(() => bumpVersion({ rootDir: fixture.root })).toThrow("Internal dependency mismatch");
      expect(fixture.read("package.json")).toBe(rootBefore);
      expect(fixture.read("package-lock.json")).toBe(lockBefore);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when the package-lock top-level version is inconsistent", () => {
    const fixture = createFixture();
    try {
      const lockfile = fixture.readJson("package-lock.json");
      lockfile.version = "1.0.2";
      fixture.writeJson("package-lock.json", lockfile);
      const rootBefore = fixture.read("package.json");

      expect(() => bumpVersion({ rootDir: fixture.root })).toThrow("top-level version");
      expect(fixture.read("package.json")).toBe(rootBefore);
      expect(fixture.readJson("package-lock.json").version).toBe("1.0.2");
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed for invalid semver and required-file omissions", () => {
    const invalidFixture = createFixture();
    const missingFixture = createFixture();
    try {
      const rootPackage = invalidFixture.readJson("package.json");
      rootPackage.version = "1.0";
      invalidFixture.writeJson("package.json", rootPackage);
      expect(() => bumpVersion({ rootDir: invalidFixture.root })).toThrow("Invalid exact semver");

      rmSync(path.join(missingFixture.root, "apps", "desktop", "src-tauri", "Cargo.lock"));
      expect(() => bumpVersion({ rootDir: missingFixture.root })).toThrow("Required file not found");
    } finally {
      invalidFixture.cleanup();
      missingFixture.cleanup();
    }
  });
});
