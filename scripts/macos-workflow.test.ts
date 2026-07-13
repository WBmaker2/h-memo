import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("macOS Tauri workflow", () => {
  it("validates pull requests and version tags without release publishing", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "macos-tauri.yml"),
      "utf8"
    );

    expect(workflow).toMatch(/push:\s*\n\s*tags:\s*\n\s*- "v\*"/);
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/);
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("npm run tauri:build:macos");
    expect(workflow).toContain('APPLE_SIGNING_IDENTITY: "-"');
    expect(workflow).toContain("VITE_GOOGLE_OAUTH_CLIENT_ID:");
    expect(workflow).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET:");
    expect(workflow).toContain("bundle/macos/*.app");
    expect(workflow).toContain("bundle/dmg/*_internal.dmg");
    expect(workflow).not.toContain("gh release");
  });
});
