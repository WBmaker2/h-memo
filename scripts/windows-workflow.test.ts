import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readWorkflow() {
  return readFileSync(path.resolve(".github", "workflows", "windows-tauri.yml"), "utf8");
}

describe("Windows Tauri workflow", () => {
  it("validates pull requests and version tags without building on main pushes", () => {
    const workflow = readWorkflow();

    expect(workflow).toMatch(/push:\s*\n\s*tags:\s*\n\s*- "v\*"/);
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/);
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("rebuild_existing_tag:");
    expect(workflow).toContain("VITE_GOOGLE_OAUTH_CLIENT_ID:");
    expect(workflow).toContain(
      "GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET || '' }}"
    );
    expect(workflow).toContain("check:firebase-env -- --require-desktop-oauth");
    expect(workflow).toContain("Ensure Windows Tauri CLI native binding");
    expect(workflow).toContain("@tauri-apps/cli-win32-x64-msvc@$tauriCliVersion");
    expect(workflow).toContain("--generate-notes");
  });

  it("dereferences annotated tags to their commit before validating a release target", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain(
      'gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_TAG}" --jq \'.sha\''
    );
    expect(workflow).toContain('existing_tag_commit="$tag_commit"');
    expect(workflow).toContain(
      '[ "$existing_tag_commit" != "$RELEASE_TARGET" ]'
    );
    expect(workflow).toContain("RELEASE_EVENT:");
    expect(workflow).toContain("REBUILD_EXISTING_TAG:");
    expect(workflow).toContain("Controlled existing-tag rebuild");
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("git diff --name-only");
    expect(workflow).not.toContain("/git/ref/${tag_ref}");
    expect(workflow).not.toContain(".object.sha");
  });

  it("uses Tauri updater signatures without paid Authenticode signing", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY:");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD:");
    expect(workflow).toContain("TAURI_UPDATER_PUBLIC_KEY:");
    expect(workflow).toContain("Validate Tauri updater signing configuration");
    expect(workflow).toContain('createUpdaterArtifacts":true');
    expect(workflow).toContain(
      '"pubkey":"${{ vars.TAURI_UPDATER_PUBLIC_KEY }}"'
    );
    expect(workflow).toContain("node scripts/create-updater-manifest.mjs");
    expect(workflow).toContain("node scripts/create-updater-manifest.mjs");
    expect(workflow).toContain("latest.json");
    expect(workflow).toContain("*.msi.sig");
    expect(workflow).toContain("*.exe.sig");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).not.toContain("azure/login");
    expect(workflow).not.toContain("azure/artifact-signing-action");
    expect(workflow).not.toContain("WINDOWS_ARTIFACT_SIGNING_");
    expect(workflow).not.toContain("Get-AuthenticodeSignature");
    expect(workflow).not.toContain("verify-windows-signatures.ps1");
    expect(workflow).not.toContain("windows-release");
  });

  it("keeps non-release builds keyless and separates them from the release path", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("Build unsigned Windows installer for non-release validation");
    expect(workflow).toContain(
      "if: ${{ steps.release_tag.outputs.release_tag == '' }}"
    );
    expect(workflow).toContain(
      "if: ${{ steps.release_tag.outputs.release_tag != '' }}"
    );
    expect(workflow).toContain("path: apps/desktop/src-tauri/target/release/bundle/msi/*");
    expect(workflow).toContain("path: apps/desktop/src-tauri/target/release/bundle/nsis/*");
  });

  it("publishes both installer signatures and latest.json only after a successful build", () => {
    const workflow = readWorkflow();
    const buildJob = workflow.indexOf("  windows-tauri:");
    const releaseJob = workflow.indexOf("  release:");
    const releaseNeeds = workflow.indexOf("needs: windows-tauri", releaseJob);
    const publishStep = workflow.indexOf(
      "- name: Upload installers and updater manifest to GitHub Release"
    );

    expect(buildJob).toBeGreaterThan(-1);
    expect(releaseJob).toBeGreaterThan(buildJob);
    expect(releaseNeeds).toBeGreaterThan(releaseJob);
    expect(publishStep).toBeGreaterThan(releaseJob);
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" "${installer_artifacts[@]}"');
    expect(workflow).toContain('gh release create "$RELEASE_TAG" "${installer_artifacts[@]}"');
    expect(workflow).toContain("published_msi_assets");
    expect(workflow).toContain("--asset-name \"$published_msi_asset\"");
    expect(workflow).toContain("endswith(\".msi\")");
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" latest.json');
  });

  it("keeps a reproducible manifest command in the root scripts", () => {
    const rootPackage = JSON.parse(
      readFileSync(path.resolve("package.json"), "utf8")
    );

    expect(rootPackage.scripts["create:updater-manifest"]).toBe(
      "node scripts/create-updater-manifest.mjs"
    );
  });
});
