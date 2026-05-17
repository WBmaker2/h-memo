import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type TauriConfig = {
  productName?: string;
  bundle?: {
    targets?: unknown;
    icon?: unknown;
    macOS?: {
      signingIdentity?: unknown;
    };
  };
};

function readTauriConfig(): TauriConfig {
  return JSON.parse(
    readFileSync(
      path.resolve("apps", "desktop", "src-tauri", "tauri.conf.json"),
      "utf8"
    )
  ) as TauriConfig;
}

describe("Tauri macOS internal build config", () => {
  it("keeps the default bundle targets on Windows installers", () => {
    const config = readTauriConfig();

    expect(config.bundle?.targets).toEqual(["nsis", "msi"]);
  });

  it("includes the macOS icon and ad-hoc signing identity for internal testing", () => {
    const config = readTauriConfig();

    expect(config.bundle?.icon).toEqual(expect.arrayContaining(["icons/icon.icns"]));
    expect(config.bundle?.macOS?.signingIdentity).toBe("-");
  });

  it("exposes a productName for bundle and DMG naming", () => {
    const config = readTauriConfig();

    expect(config.productName).toBeTypeOf("string");
    expect(config.productName.length).toBeGreaterThan(0);
  });
});
