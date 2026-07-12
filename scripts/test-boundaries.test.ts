import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  VITEST_EXCLUDE_PATTERNS,
  VITEST_INCLUDE_PATTERNS,
  isVitestExcludedPath,
} from "./lib/vitest-boundaries.js";

describe("Vitest discovery boundaries", () => {
  it("includes only repository test file patterns", () => {
    const configSource = readFileSync(path.resolve("vitest.config.ts"), "utf8");
    const webConfigSource = readFileSync(path.resolve("apps/web/vite.config.ts"), "utf8");

    expect(VITEST_INCLUDE_PATTERNS).toEqual([
      "**/*.{test,spec}.{js,mjs,cjs,ts,tsx}",
    ]);
    expect(configSource).toContain("include: VITEST_INCLUDE_PATTERNS");
    expect(configSource).toContain("exclude: VITEST_EXCLUDE_PATTERNS");
    expect(webConfigSource).toContain("include: VITEST_INCLUDE_PATTERNS");
    expect(webConfigSource).toContain("exclude: VITEST_EXCLUDE_PATTERNS");
  });

  it("excludes generated and nested repository paths", () => {
    expect(VITEST_EXCLUDE_PATTERNS).toEqual([
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-ssr/**",
      "**/coverage/**",
      "**/.worktrees/**",
      "**/target/**",
    ]);
    expect(
      isVitestExcludedPath(
        "apps/desktop/src-tauri/target/release/bundle/dmg/internal-staging/Applications/Foo.test.js"
      )
    ).toBe(true);
    expect(isVitestExcludedPath("packages/memo-core/src/memoFactory.test.ts")).toBe(false);
    expect(isVitestExcludedPath("node_modules/example/Foo.test.ts")).toBe(true);
    expect(isVitestExcludedPath("apps/web/dist/Foo.test.ts")).toBe(true);
    expect(isVitestExcludedPath(".worktrees/h-memo/Bar.test.ts")).toBe(true);
    expect(isVitestExcludedPath("apps\\desktop\\target\\Foo.test.ts")).toBe(true);
  });
});
