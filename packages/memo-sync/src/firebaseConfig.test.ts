import { deleteApp } from "firebase/app";
import { describe, expect, it } from "vitest";
import { createFirebaseApp } from "./firebaseConfig";

function createTestAppName() {
  return `firebase-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("createFirebaseApp", () => {
  it("passes trimmed Firebase options to initializeApp", async () => {
    const app = createFirebaseApp(
      {
        apiKey: " api-key ",
        authDomain: " project.firebaseapp.com ",
        projectId: " project-id ",
        appId: " app-id ",
        storageBucket: " ",
        messagingSenderId: " sender-id ",
        measurementId: " measurement-id ",
      },
      createTestAppName()
    );

    try {
      expect(app.options).toMatchObject({
        apiKey: "api-key",
        authDomain: "project.firebaseapp.com",
        projectId: "project-id",
        appId: "app-id",
        messagingSenderId: "sender-id",
        measurementId: "measurement-id",
      });
      expect(app.options.storageBucket).toBeUndefined();
    } finally {
      await deleteApp(app);
    }
  });

  it("throws when required Firebase options are blank", () => {
    expect(() =>
      createFirebaseApp({
        apiKey: "api-key",
        authDomain: "",
        projectId: "project-id",
        appId: "app-id",
      })
    ).toThrow("Firebase 설정에 누락된 값이 있습니다: authDomain");
  });
});
