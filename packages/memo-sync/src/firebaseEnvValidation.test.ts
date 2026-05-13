import { describe, expect, it } from "vitest";
import {
  FIREBASE_OPTIONAL_CLIENT_ENV_KEYS,
  FIREBASE_REQUIRED_CLIENT_ENV_KEYS,
  hasFirebaseConfig,
  validateFirebaseClientEnv,
} from "./firebaseEnvValidation";

describe("validateFirebaseClientEnv", () => {
  it("returns valid result when all required keys are present", () => {
    const validation = validateFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
      storageBucket: "",
      messagingSenderId: "  ",
      measurementId: "measurement-id",
    });

    expect(validation.isValid).toBe(true);
    expect(validation.missingRequiredKeys).toEqual([]);
    expect(validation.presentRequiredKeys).toEqual([...FIREBASE_REQUIRED_CLIENT_ENV_KEYS]);
    expect(validation.presentOptionalKeys).toEqual(["measurementId"]);
    expect(validation.missingOptionalKeys).toEqual([
      "storageBucket",
      "messagingSenderId",
    ]);
  });

  it("returns invalid result and lists missing required keys", () => {
    const validation = validateFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "",
      projectId: "  ",
      appId: "",
      measurementId: "measurement-id",
    });

    expect(validation.isValid).toBe(false);
    expect(validation.missingRequiredKeys).toEqual([
      "authDomain",
      "projectId",
      "appId",
    ]);
    expect(validation.presentRequiredKeys).toEqual(["apiKey"]);
  });

  it("treats missing optional keys as optional", () => {
    const validation = validateFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    expect(validation.isValid).toBe(true);
    expect(validation.presentOptionalKeys).toEqual([]);
    expect(validation.missingOptionalKeys).toEqual([
      ...FIREBASE_OPTIONAL_CLIENT_ENV_KEYS,
    ]);
  });

  it("hasFirebaseConfig is true only when required keys are present", () => {
    expect(
      hasFirebaseConfig({
        apiKey: "api-key",
        authDomain: "project.firebaseapp.com",
        projectId: "project-id",
        appId: "app-id",
      })
    ).toBe(true);
    expect(hasFirebaseConfig({ apiKey: "api-key", authDomain: "", projectId: "project-id", appId: "app-id" })).toBe(false);
  });
});
