import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function resolveSwFilePath(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(testDir, "public/sw.js"),
    resolve(process.cwd(), "apps/web/public/sw.js"),
    resolve(process.cwd(), "public/sw.js"),
  ];

  const swPath = candidatePaths.find((path) => existsSync(path));
  if (!swPath) {
    throw new Error(`service worker file not found. tried: ${candidatePaths.join(", ")}`);
  }

  return swPath;
}

const swSource = readFileSync(resolveSwFilePath(), "utf8");

describe("service worker source policy", () => {
  it("uses network-first strategy for navigation requests", () => {
    expect(swSource).toMatch(/function isNavigationRequest/);
    expect(swSource).toMatch(/if \(isNavigationRequest\(request\)\)/);
    expect(swSource).toMatch(/networkFirstForNavigation/);
  });

  it("cache-first is limited to static assets path/destination and not all GET", () => {
    expect(swSource).toMatch(/assets\//);
    expect(swSource).toMatch(/function isStaticAssetRequest/);
    expect(swSource).toMatch(/function cacheFirst/);
    expect(swSource).toMatch(/if\s*\(\s*isStaticAssetRequest\(/);
    expect(swSource).toMatch(/event\.respondWith\(\s*fetch\(request\)\.catch/);
  });

  it("cleans old caches on activate", () => {
    expect(swSource).toMatch(/self\.addEventListener\("activate",/);
    expect(swSource).toMatch(/caches\.keys\(\)/);
    expect(swSource).toMatch(/caches\.delete\(/);
  });

  it("builds offline fallback for navigation and request failures", () => {
    expect(swSource).toMatch(/"오프라인 상태입니다\."/);
    expect(swSource).toMatch(/fetch\(request\)/);
    expect(swSource).toMatch(/indexFallbackUrl/);
  });
});
