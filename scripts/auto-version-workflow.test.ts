import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Auto Version and Tag workflow", () => {
  it("only releases successful main push CI runs", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "auto-version.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Auto Version and Tag");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["CI"]');
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("serializes releases and prepares Node 22 with the complete main history", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "auto-version.yml"),
      "utf8"
    );

    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("group: auto-version-and-tag-main");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("ref: main");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("actions/setup-node@v6");
    expect(workflow).toContain('node-version: "22"');
  });

  it("stale successful CI must skip rather than release newer unverified main", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "auto-version.yml"),
      "utf8"
    );

    expect(workflow).toContain('if [ "$SOURCE_COMMIT" != "$current_main" ]; then');
    expect(workflow).toContain("Skipping stale successful CI");
    expect(workflow).not.toContain("merge-base --is-ancestor");
  });

  it("prevents duplicate source releases and atomically creates the annotated tag", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "auto-version.yml"),
      "utf8"
    );

    expect(workflow).toContain("Skipping automatic release commit");
    expect(workflow).toContain('"Source-Commit: $SOURCE_COMMIT"');
    expect(workflow).toContain("Skipping already processed source commit");
    expect(workflow).toContain("npm run --silent version:bump");
    expect(workflow).not.toContain("npm run version:bump)");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("npm run check:versions -- --release-tag");
    expect(workflow).toContain("chore(release): bump version to $release_tag");
    expect(workflow).toContain('git tag -a "$release_tag"');
    expect(workflow).toContain('git push --atomic origin HEAD:main "refs/tags/$release_tag"');
  });

  it("explicitly dispatches each tag workflow after the token-based push", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "auto-version.yml"),
      "utf8"
    );

    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain(
      'gh workflow run windows-tauri.yml --repo "$GITHUB_REPOSITORY" --ref "$RELEASE_TAG" -f "release_tag=$RELEASE_TAG"'
    );
    expect(workflow).toContain(
      'gh workflow run macos-tauri.yml --repo "$GITHUB_REPOSITORY" --ref "$RELEASE_TAG"'
    );
    expect(workflow).toContain(
      'gh workflow run web-pages.yml --repo "$GITHUB_REPOSITORY" --ref "$RELEASE_TAG"'
    );
  });
});
