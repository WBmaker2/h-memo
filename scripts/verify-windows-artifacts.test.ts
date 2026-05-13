import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseArgs,
  verifyWindowsArtifacts,
} from "./lib/verify-windows-artifacts.js";

function createTempBundleFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "h-memo-windows-artifacts-"));
  const bundleDir = path.join(root, "bundle");
  const nsisDir = path.join(bundleDir, "nsis");
  const msiDir = path.join(bundleDir, "msi");
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(nsisDir, { recursive: true });
  mkdirSync(msiDir, { recursive: true });

  return {
    root,
    bundleDir,
    nsisDir,
    msiDir,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("parseArgs", () => {
  it("parses --bundle-dir path", () => {
    expect(parseArgs(["--bundle-dir", "/tmp/bundle"])).toMatchObject({
      bundleDir: "/tmp/bundle",
    });
  });

  it("throws when --bundle-dir is missing a value", () => {
    expect(() => parseArgs(["--bundle-dir"])).toThrow("--bundle-dir requires a value.");
  });
});

describe("verifyWindowsArtifacts", () => {
  it("passes when at least an NSIS installer exists", () => {
    const fixture = createTempBundleFixture();
    try {
      writeFileSync(path.join(fixture.nsisDir, "h-memo-setup.exe"), "fake exe");

      const result = verifyWindowsArtifacts({ bundleDir: fixture.bundleDir });

      expect(result.nsisFiles.length).toBe(1);
      expect(result.msiFiles.length).toBe(0);
      expect(result.nsisFiles[0]).toBe(
        path.resolve(path.join(fixture.nsisDir, "h-memo-setup.exe"))
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("passes when at least an MSI installer exists", () => {
    const fixture = createTempBundleFixture();
    try {
      writeFileSync(path.join(fixture.msiDir, "h-memo-installer.msi"), "fake msi");

      const result = verifyWindowsArtifacts({ bundleDir: fixture.bundleDir });

      expect(result.nsisFiles.length).toBe(0);
      expect(result.msiFiles.length).toBe(1);
      expect(result.msiFiles[0]).toBe(
        path.resolve(path.join(fixture.msiDir, "h-memo-installer.msi"))
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("fails when neither NSIS nor MSI artifacts exist", () => {
    const fixture = createTempBundleFixture();
    try {
      expect(() => verifyWindowsArtifacts({ bundleDir: fixture.bundleDir })).toThrow(
        /No Windows installer artifacts found/
      );
    } finally {
      fixture.cleanup();
    }
  });
});
