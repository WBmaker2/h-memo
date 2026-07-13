import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));

const styleFiles = [
  ["web", resolve(testDirectory, "styles.css")],
  ["desktop", resolve(testDirectory, "../../desktop/src/styles.css")],
] as const;

describe.each(styleFiles)("%s settings styles", (_, stylePath) => {
  const css = readFileSync(stylePath, "utf8");

  it("keeps disclosure content in a vertical grid and scopes action rows", () => {
    expect(css).not.toMatch(/\.settings-panel\s+div\s*,/);
    expect(css).toMatch(
      /\.settings-panel__section-content\s*\{[^}]*display:\s*grid;[^}]*\}/s
    );
    expect(css).toMatch(
      /\.settings-panel__section-content\s*>\s*div[^{}]*\{[^}]*display:\s*flex;[^}]*\}/s
    );
  });

  it("uses the full startup switch row as a 40px target while keeping the checkbox compact", () => {
    expect(css).toMatch(
      /\.settings-panel label\.settings-panel__switch-row\s*\{[^}]*min-height:\s*40px;[^}]*justify-content:\s*space-between;[^}]*\}/s
    );
    expect(css).toMatch(
      /\.settings-panel__switch-row input\[type="checkbox"\]\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*flex:\s*0 0 auto;[^}]*\}/s
    );
  });
});
