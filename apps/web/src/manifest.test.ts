import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Manifest = {
  start_url?: string;
  scope?: string;
  icons?: Array<{
    src?: string;
    sizes?: string;
    purpose?: string;
  }>;
};

function getManifestPath(): string {
  const testFileDir = dirname(fileURLToPath(import.meta.url));
  return resolve(testFileDir, "../public/manifest.webmanifest");
}

function getPublicDir(manifestPath: string): string {
  return resolve(manifestPath, "..");
}

function toPublicPath(filePath: string): string {
  return filePath.startsWith("/") ? filePath.slice(1) : filePath;
}

function parseManifest(): Manifest {
  const raw = readFileSync(getManifestPath(), "utf8");
  return JSON.parse(raw) as Manifest;
}

describe("manifest.webmanifest", () => {
  it("contains install icons with required 192x192 and 512x512 sizes", () => {
    const manifest = parseManifest();
    expect(manifest.start_url).not.toBe("/");
    expect(manifest.scope).not.toBe("/");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons?.some((icon) => icon.sizes === "192x192" && icon.src)).toBe(true);
    expect(manifest.icons?.some((icon) => icon.sizes === "512x512" && icon.src)).toBe(true);
  });

  it("supports maskable icons and referenced files exist", () => {
    const manifest = parseManifest();
    const iconEntries = manifest.icons ?? [];
    const hasMaskable = iconEntries.some((icon) => {
      const purpose = icon.purpose;
      return typeof purpose === "string" && purpose.split(/\s+/).includes("maskable");
    });

    expect(hasMaskable).toBe(true);

    const invalidEntries = iconEntries.filter((icon) => {
      const manifestPath = getManifestPath();
      const publicDir = getPublicDir(manifestPath);
      return !icon.src || !existsSync(resolve(publicDir, toPublicPath(icon.src)));
    });
    expect(invalidEntries).toHaveLength(0);
  });

  it("uses relative URLs for GitHub Pages base path safety", () => {
    const manifest = parseManifest();
    const publicDir = getPublicDir(getManifestPath());

    expect(typeof manifest.start_url).toBe("string");
    expect(typeof manifest.scope).toBe("string");
    expect(manifest.start_url?.startsWith(".")).toBe(true);
    expect(manifest.scope?.startsWith(".")).toBe(true);

    const invalidIcons = (manifest.icons ?? []).filter((icon) => {
      if (!icon?.src) {
        return true;
      }
      if (!icon.src.startsWith(".")) {
        return true;
      }
      return !existsSync(resolve(publicDir, toPublicPath(icon.src)));
    });
    expect(invalidIcons).toHaveLength(0);
  });
});
