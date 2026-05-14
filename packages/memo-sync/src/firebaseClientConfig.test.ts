import { beforeEach, describe, expect, it } from "vitest";
import {
  FIREBASE_CLIENT_CONFIG_STORAGE_KEY,
  clearStoredFirebaseClientConfig,
  mergeFirebaseClientConfig,
  normalizeFirebaseClientConfig,
  readStoredFirebaseClientConfig,
  saveStoredFirebaseClientConfig,
  toFirebaseClientConfigInput,
} from "./firebaseClientConfig";

describe("firebaseClientConfig", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes saved Firebase client config values", () => {
    expect(
      normalizeFirebaseClientConfig({
        apiKey: " api-key ",
        authDomain: " project.firebaseapp.com ",
        projectId: "",
        appId: " app-id ",
      })
    ).toEqual({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      appId: "app-id",
    });
  });

  it("merges build and stored config with stored values taking priority", () => {
    expect(
      mergeFirebaseClientConfig(
        {
          apiKey: "build-api-key",
          authDomain: "build.firebaseapp.com",
          projectId: "project-id",
          appId: "app-id",
        },
        {
          apiKey: "stored-api-key",
        }
      )
    ).toEqual({
      apiKey: "stored-api-key",
      authDomain: "build.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
  });

  it("reads, saves, and clears config from local storage", () => {
    const saved = saveStoredFirebaseClientConfig({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
      storageBucket: "",
    });

    expect(saved).toEqual({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    expect(readStoredFirebaseClientConfig()).toEqual(saved);

    clearStoredFirebaseClientConfig();
    expect(window.localStorage.getItem(FIREBASE_CLIENT_CONFIG_STORAGE_KEY)).toBeNull();
    expect(readStoredFirebaseClientConfig()).toEqual({});
  });

  it("converts partial config to a complete form value", () => {
    expect(
      toFirebaseClientConfigInput({
        apiKey: "api-key",
        appId: "app-id",
      })
    ).toEqual({
      apiKey: "api-key",
      authDomain: "",
      projectId: "",
      appId: "app-id",
      storageBucket: "",
      messagingSenderId: "",
      measurementId: "",
    });
  });
});
