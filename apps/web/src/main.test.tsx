import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function getMainSourcePath(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return resolve(testDir, "main.tsx");
}

function getIndexHtmlPath(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return resolve(testDir, "../index.html");
}

describe("main entry", () => {
  it("registers service worker only in production with BASE_URL-aware path", () => {
    const mainSource = readFileSync(getMainSourcePath(), "utf8");

    expect(mainSource).toMatch(/if\s*\(\s*import\.meta\.env\.PROD\s*\)/);
    expect(mainSource).toMatch(/registerServiceWorker\(resolveServiceWorkerUrl\(import\.meta\.env\.BASE_URL\)\)/);
  });

  it("keeps script entry path in index.html as Vite-rooted module entry", () => {
    const indexHtml = readFileSync(getIndexHtmlPath(), "utf8");

    expect(indexHtml).toMatch(/<script\b[^>]*src="\/src\/main\.tsx"[^>]*>/);
    expect(indexHtml).not.toMatch(/%BASE_URL%src\/main\.tsx/);
  });

  it("keeps mobile viewport zoom available", () => {
    const indexHtml = readFileSync(getIndexHtmlPath(), "utf8");
    const viewportContent = indexHtml.match(
      /<meta\s+name="viewport"\s+content="([^"]+)"\s*\/>/
    )?.[1];

    expect(viewportContent).toContain("width=device-width");
    expect(viewportContent).not.toMatch(/maximum-scale\s*=\s*1/i);
    expect(viewportContent).not.toMatch(/user-scalable\s*=\s*no/i);
  });
});
