import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Windows Tauri workflow", () => {
  it("validates pull requests and version tags without building on main pushes", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "windows-tauri.yml"),
      "utf8"
    );

    expect(workflow).toMatch(/push:\s*\n\s*tags:\s*\n\s*- "v\*"/);
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/);
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("VITE_GOOGLE_OAUTH_CLIENT_ID:");
    expect(workflow).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET:");
    expect(workflow).toContain("Ensure Windows Tauri CLI native binding");
    expect(workflow).toContain("@tauri-apps/cli-win32-x64-msvc@$tauriCliVersion");
    expect(workflow).toContain("--generate-notes");
  });

  it("dereferences annotated tags to their commit before validating a release target", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "windows-tauri.yml"),
      "utf8"
    );

    expect(workflow).toContain(
      'gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_TAG}" --jq \'.sha\''
    );
    expect(workflow).toContain('existing_tag_commit="$tag_commit"');
    expect(workflow).toContain(
      '[ "$existing_tag_commit" != "$RELEASE_TARGET" ]'
    );
    expect(workflow).not.toContain("/git/ref/${tag_ref}");
    expect(workflow).not.toContain(".object.sha");
  });
});
