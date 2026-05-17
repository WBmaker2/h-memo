import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("GitHub Pages web workflow", () => {
  it("builds, uploads apps/web/dist, and deploys with GitHub Pages actions", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "web-pages.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Web Pages Deploy");
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
