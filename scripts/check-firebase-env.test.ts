import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkFirebaseEnv,
  getDotEnvFileOrder,
  loadFirebaseEnv,
  parseArgs,
} from "./check-firebase-env.mjs";

function createTempEnvDir() {
  const root = mkdtempSync(path.join(os.tmpdir(), "h-memo-firebase-env-"));
  return {
    root,
    write(name, contents) {
      writeFileSync(path.join(root, name), contents);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("check-firebase-env", () => {
  it("loads .env, .env.local, mode files, and process env with expected precedence", () => {
    const fixture = createTempEnvDir();
    try {
      fixture.write(
        ".env",
        [
          "VITE_FIREBASE_API_KEY=from-env",
          "VITE_FIREBASE_AUTH_DOMAIN=from-env",
          "VITE_FIREBASE_PROJECT_ID=from-env",
          "VITE_FIREBASE_APP_ID=from-env",
        ].join("\n")
      );
      fixture.write(".env.local", "VITE_FIREBASE_APP_ID=from-env-local\n");
      fixture.write(".env.production", "VITE_FIREBASE_PROJECT_ID=from-mode\n");
      fixture.write(
        ".env.production.local",
        [
          "VITE_FIREBASE_API_KEY=from-mode-local",
          "VITE_FIREBASE_STORAGE_BUCKET=from-mode-local",
        ].join("\n")
      );

      const env = loadFirebaseEnv({
        cwd: fixture.root,
        mode: "production",
        processEnv: {
          VITE_FIREBASE_AUTH_DOMAIN: "from-process",
        },
      });

      expect(env).toMatchObject({
        VITE_FIREBASE_API_KEY: "from-mode-local",
        VITE_FIREBASE_AUTH_DOMAIN: "from-process",
        VITE_FIREBASE_PROJECT_ID: "from-mode",
        VITE_FIREBASE_APP_ID: "from-env-local",
        VITE_FIREBASE_STORAGE_BUCKET: "from-mode-local",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("reports missing required keys without requiring optional keys", () => {
    const result = checkFirebaseEnv({
      VITE_FIREBASE_API_KEY: "api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "project.firebaseapp.com",
    });

    expect(result.required.present).toEqual([
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
    ]);
    expect(result.required.missing).toEqual([
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_APP_ID",
    ]);
    expect(result.optional.present).toEqual([]);
  });

  it("parses --mode and resolves Vite-like env file order", () => {
    expect(parseArgs(["--mode", "staging"])).toMatchObject({
      mode: "staging",
    });
    expect(getDotEnvFileOrder("staging")).toEqual([
      ".env",
      ".env.local",
      ".env.staging",
      ".env.staging.local",
    ]);
  });
});
