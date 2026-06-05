import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkFirebaseEnv,
  getDotEnvFileOrder,
  loadFirebaseEnv,
  parseArgs,
  readBuiltInFirebaseEnv,
} from "./lib/check-firebase-env.js";

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

  it("requires desktop OAuth keys when requested", () => {
    const result = checkFirebaseEnv(
      {
        VITE_FIREBASE_API_KEY: "api-key",
        VITE_FIREBASE_AUTH_DOMAIN: "project.firebaseapp.com",
        VITE_FIREBASE_PROJECT_ID: "project-id",
        VITE_FIREBASE_APP_ID: "app-id",
        VITE_GOOGLE_OAUTH_CLIENT_ID: "desktop-client-id",
      },
      { requireDesktopOAuth: true }
    );

    expect(result.required.missing).toEqual([]);
    expect(result.desktopOAuth.present).toEqual(["VITE_GOOGLE_OAUTH_CLIENT_ID"]);
    expect(result.desktopOAuth.missing).toEqual(["GOOGLE_OAUTH_CLIENT_SECRET"]);
  });

  it("loads built-in Firebase defaults before env files and process env", () => {
    const fixture = createTempEnvDir();
    try {
      const configPath = path.join(
        fixture.root,
        "packages",
        "memo-sync",
        "src",
        "defaultFirebaseProject.json"
      );
      mkdirSync(path.dirname(configPath), { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify({
          apiKey: "built-in-api-key",
          authDomain: "built-in.firebaseapp.com",
          projectId: "built-in-project",
          appId: "built-in-app-id",
          storageBucket: "built-in-bucket",
        })
      );
      fixture.write(".env", "VITE_FIREBASE_PROJECT_ID=env-project\n");

      expect(readBuiltInFirebaseEnv({ cwd: fixture.root })).toMatchObject({
        VITE_FIREBASE_API_KEY: "built-in-api-key",
        VITE_FIREBASE_AUTH_DOMAIN: "built-in.firebaseapp.com",
        VITE_FIREBASE_PROJECT_ID: "built-in-project",
        VITE_FIREBASE_APP_ID: "built-in-app-id",
        VITE_FIREBASE_STORAGE_BUCKET: "built-in-bucket",
      });
      expect(
        loadFirebaseEnv({
          cwd: fixture.root,
          processEnv: { VITE_FIREBASE_APP_ID: "process-app-id" },
        })
      ).toMatchObject({
        VITE_FIREBASE_API_KEY: "built-in-api-key",
        VITE_FIREBASE_AUTH_DOMAIN: "built-in.firebaseapp.com",
        VITE_FIREBASE_PROJECT_ID: "env-project",
        VITE_FIREBASE_APP_ID: "process-app-id",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("parses --mode and resolves Vite-like env file order", () => {
    expect(parseArgs(["--mode", "staging", "--require-desktop-oauth"])).toMatchObject({
      mode: "staging",
      requireDesktopOAuth: true,
    });
    expect(getDotEnvFileOrder("staging")).toEqual([
      ".env",
      ".env.local",
      ".env.staging",
      ".env.staging.local",
    ]);
  });
});
