import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Public repo security guardrails", () => {
  it("includes Dependabot config for npm and documented Cargo dependencies", () => {
    const dependabotPath = path.resolve(".github", "dependabot.yml");
    expect(existsSync(dependabotPath)).toBe(true);

    const dependabot = readFileSync(dependabotPath, "utf8");
    expect(dependabot).toContain("version: 2");
    expect(dependabot).toContain("package-ecosystem: \"npm\"");
    expect(dependabot).toContain("directory: \"/\"");
    expect(dependabot).toContain("interval: \"weekly\"");
    expect(dependabot).toContain("open-pull-requests-limit:");
    expect(dependabot).toContain("package-ecosystem: \"cargo\"");
    expect(dependabot).toContain("directory: \"/apps/desktop/src-tauri\"");
    expect(dependabot).toContain("dependency-name: \"glib\"");
    expect(dependabot).toContain("Tauri 2 currently pulls glib 0.18.x");
  });

  it("documents public repository security and links it from README/release docs", () => {
    const docPath = path.resolve("docs", "public-repo-security.md");
    const readme = readFileSync(path.resolve("README.md"), "utf8");
    const release = readFileSync(path.resolve("docs", "release.md"), "utf8");
    const docContent = readFileSync(docPath, "utf8");

    expect(existsSync(docPath)).toBe(true);
    expect(docContent).toContain("# 공개 저장소 보안 가이드");
    expect(docContent).toContain("공개에 안전한 값 vs 실제 비밀");
    expect(docContent).toContain("데이터 보안 경계");
    expect(docContent).toContain("서비스 계정 키");
    expect(docContent).toContain("OAuth client secret");
    expect(docContent).toContain("Desktop OAuth client ID + PKCE/loopback");
    expect(docContent).toContain("Secret scanning");
    expect(docContent).toContain("Dependabot security updates");
    expect(docContent).toContain("Cargo/Tauri 예외");
    expect(docContent).toContain("RUSTSEC-2024-0429");
    expect(docContent).toContain("glib >=0.20.0");
    expect(docContent).toContain("릴리스 발행 전 점검");
    expect(
      readme.includes("public-repo-security.md") ||
        release.includes("public-repo-security.md")
    ).toBe(true);
  });

  it("keeps Google OAuth client secret out of workflow env wiring", () => {
    const workflowDir = path.resolve(".github", "workflows");
    const workflows = readdirSync(workflowDir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map((name) => path.join(workflowDir, name));

    workflows.forEach((workflowPath) => {
      const workflow = readFileSync(workflowPath, "utf8");
      expect(workflow).not.toMatch(/\bGOOGLE_OAUTH_CLIENT_SECRET\b/);
    });
  });
});
