import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("GitHub Pages web workflow", () => {
  it("validates pull requests and deploys version tags without main push builds", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "web-pages.yml"),
      "utf8"
    ).replace(/\r\n?/g, "\n");

    expect(workflow).toContain("name: Web Pages Deploy");
    expect(workflow).toMatch(/push:\s*\n\s*tags:\s*\n\s*- "v\*"/);
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/);
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("node-version: \"22\"");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run build -w apps/web");
    expect(workflow).toContain("GITHUB_PAGES: \"true\"");
    expect(workflow).toContain("actions/configure-pages@v6");
    expect(workflow).toContain("actions/upload-pages-artifact@v4");
    expect(workflow).toContain("actions/deploy-pages@v5");
    expect(workflow).toContain("if: ${{ github.event_name != 'pull_request' }}");

    const [topLevel, jobs] = workflow.split("jobs:\n");
    expect(topLevel).toContain("permissions:\n  contents: read");
    expect(topLevel).not.toContain("pages: write");
    expect(topLevel).not.toContain("id-token: write");

    const buildJob = jobs.slice(0, jobs.indexOf("  deploy:\n"));
    expect(buildJob).not.toContain("pages: write");
    expect(buildJob).not.toContain("id-token: write");

    const deployJob = jobs.slice(jobs.indexOf("  deploy:\n"));
    expect(deployJob).toContain(
      "permissions:\n      contents: read\n      pages: write\n      id-token: write"
    );

    const workflowHasFirebaseEnvVariables =
      workflow.includes("VITE_FIREBASE_API_KEY") &&
      workflow.includes("VITE_FIREBASE_AUTH_DOMAIN") &&
      workflow.includes("VITE_FIREBASE_PROJECT_ID") &&
      workflow.includes("VITE_FIREBASE_APP_ID") &&
      workflow.includes("VITE_FIREBASE_STORAGE_BUCKET") &&
      workflow.includes("VITE_FIREBASE_MESSAGING_SENDER_ID") &&
      workflow.includes("VITE_FIREBASE_MEASUREMENT_ID");
    expect(workflowHasFirebaseEnvVariables).toBe(true);
    expect(workflow).toContain("path: apps/web/dist");
  });
});
