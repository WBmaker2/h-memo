import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("web TypeScript boundary", () => {
  it("keeps the production web typecheck separate from Node-backed tests", () => {
    const webTsconfig = JSON.parse(
      readFileSync(path.resolve("apps", "web", "tsconfig.json"), "utf8")
    );
    const webTestTsconfig = JSON.parse(
      readFileSync(path.resolve("apps", "web", "tsconfig.test.json"), "utf8")
    );

    expect(webTsconfig.exclude).toContain("src/**/*.test.ts");
    expect(webTsconfig.exclude).toContain("src/**/*.test.tsx");
    expect(webTsconfig.compilerOptions.types).not.toContain("node");
    expect(webTsconfig.compilerOptions.types).not.toContain("vitest/globals");
    expect(webTestTsconfig.compilerOptions.types).toContain("vitest/globals");
    expect(webTestTsconfig.compilerOptions.types).toContain("node");
  });

  it("does not load Node types or test files in the production web typecheck", () => {
    const tscPath = path.resolve("node_modules", "typescript", "bin", "tsc");
    const output = execFileSync(
      process.execPath,
      [tscPath, "-p", path.resolve("apps", "web", "tsconfig.json"), "--noEmit", "--listFiles"],
      { encoding: "utf8" }
    );

    expect(output).not.toContain(`${path.sep}@types${path.sep}node${path.sep}`);
    expect(output).not.toContain(`${path.sep}vitest${path.sep}globals.d.ts`);
    expect(output).not.toMatch(/\.test\.tsx?$/m);
  });
});
