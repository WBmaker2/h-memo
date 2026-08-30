import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createUpdaterManifest,
  createUpdaterManifestFromDirectory,
} from "./lib/create-updater-manifest.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createUpdaterManifest", () => {
  it("creates a Windows manifest with the detached signature content", () => {
    const manifest = createUpdaterManifest({
      version: "v1.0.7",
      releaseTag: "v1.0.7",
      repository: "WBmaker2/h-memo",
      assetName: "H.Memo_1.0.7_x64_en-US.msi",
      signature: "signature-content",
      notes: "Windows updater 개선",
      publishedAt: "2026-08-30T00:00:00.000Z",
    });

    expect(manifest).toEqual({
      version: "1.0.7",
      notes: "Windows updater 개선",
      pub_date: "2026-08-30T00:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          url: "https://github.com/WBmaker2/h-memo/releases/download/v1.0.7/H.Memo_1.0.7_x64_en-US.msi",
          signature: "signature-content",
        },
      },
    });
  });

  it("reads exactly one MSI and its matching .sig file from a release artifact directory", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "h-memo-updater-"));
    temporaryDirectories.push(directory);
    writeFileSync(path.join(directory, "H Memo_1.0.7.msi"), "installer", "utf8");
    writeFileSync(path.join(directory, "H Memo_1.0.7.msi.sig"), "  signed  \n", "utf8");

    const manifest = createUpdaterManifestFromDirectory({
      version: "1.0.7",
      releaseTag: "v1.0.7",
      repository: "WBmaker2/h-memo",
      assetDir: directory,
      publishedAt: "2026-08-30T00:00:00.000Z",
    });

    expect(manifest.platforms["windows-x86_64"].signature).toBe("signed");
    expect(manifest.platforms["windows-x86_64"].url).toContain("H%20Memo_1.0.7.msi");
  });

  it("fails closed for a missing signature, invalid version, or ambiguous MSI directory", () => {
    expect(() =>
      createUpdaterManifest({
        version: "1.0.7",
        releaseTag: "v1.0.7",
        repository: "WBmaker2/h-memo",
        assetName: "H.Memo.msi",
        signature: "",
      })
    ).toThrow("signature");

    expect(() =>
      createUpdaterManifest({
        version: "1.0",
        releaseTag: "v1.0.7",
        repository: "WBmaker2/h-memo",
        assetName: "H.Memo.msi",
        signature: "signed",
      })
    ).toThrow("version");

    const directory = mkdtempSync(path.join(os.tmpdir(), "h-memo-updater-"));
    temporaryDirectories.push(directory);
    mkdirSync(path.join(directory, "nested"));
    writeFileSync(path.join(directory, "one.msi"), "installer", "utf8");
    writeFileSync(path.join(directory, "two.msi"), "installer", "utf8");

    expect(() =>
      createUpdaterManifestFromDirectory({
        version: "1.0.7",
        releaseTag: "v1.0.7",
        repository: "WBmaker2/h-memo",
        assetDir: directory,
      })
    ).toThrow("exactly one MSI");
  });
});
