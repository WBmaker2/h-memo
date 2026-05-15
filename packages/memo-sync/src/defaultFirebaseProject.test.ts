import { describe, expect, it } from "vitest";
import {
  H_MEMO_FIREBASE_PROJECT_ID,
  getDefaultFirebaseClientEnv,
} from "./defaultFirebaseProject";
import { hasFirebaseConfig } from "./firebaseEnvValidation";

describe("defaultFirebaseProject", () => {
  it("provides the built-in H Memo Firebase client config", () => {
    const config = getDefaultFirebaseClientEnv();

    expect(config.projectId).toBe(H_MEMO_FIREBASE_PROJECT_ID);
    expect(config.projectId).toBe("h-memo-60c6b");
    expect(config.authDomain).toBe("h-memo-60c6b.firebaseapp.com");
    expect(hasFirebaseConfig(config)).toBe(true);
  });
});
