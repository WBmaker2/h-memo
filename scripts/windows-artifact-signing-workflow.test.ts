import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Windows Azure Artifact Signing workflow", () => {
  const workflow = () =>
    readFileSync(path.resolve(".github/workflows/windows-tauri.yml"), "utf8");

  it("grants OIDC permission and signs installers before artifact upload", () => {
    const yaml = workflow();

    expect(yaml).toContain("id-token: write");
    expect(yaml).toContain("uses: azure/login@v3");
    expect(yaml).toContain("uses: azure/artifact-signing-action@v1");
    expect(yaml).toContain("Sign MSI installer with Azure Artifact Signing");
    expect(yaml).toContain("Sign NSIS installer with Azure Artifact Signing");

    const signMsiIndex = yaml.indexOf("Sign MSI installer with Azure Artifact Signing");
    const signNsisIndex = yaml.indexOf("Sign NSIS installer with Azure Artifact Signing");
    const uploadMsiIndex = yaml.indexOf("Upload MSI artifact");
    const uploadNsisIndex = yaml.indexOf("Upload NSIS installer artifact");

    expect(signMsiIndex).toBeGreaterThan(-1);
    expect(signNsisIndex).toBeGreaterThan(signMsiIndex);
    expect(uploadMsiIndex).toBeGreaterThan(signNsisIndex);
    expect(uploadNsisIndex).toBeGreaterThan(uploadMsiIndex);
  });

  it("requires complete signing config for release builds while skipping pull requests", () => {
    const yaml = workflow();

    expect(yaml).toContain('if ($env:EVENT_NAME -eq "pull_request")');
    expect(yaml).toContain("Azure Artifact Signing is skipped for pull_request builds.");
    expect(yaml).toContain("Release signing requires a complete Azure Artifact Signing configuration.");
    expect(yaml).toContain("AZURE_ARTIFACT_SIGNING_ENDPOINT");
    expect(yaml).toContain("AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME");
    expect(yaml).toContain("AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME");
  });
});
