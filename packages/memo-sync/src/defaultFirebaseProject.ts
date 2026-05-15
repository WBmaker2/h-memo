import type { FirebaseClientEnv } from "./firebaseEnvValidation";
import defaultFirebaseProject from "./defaultFirebaseProject.json";

export const H_MEMO_FIREBASE_PROJECT_ID = defaultFirebaseProject.projectId;

const DEFAULT_FIREBASE_CLIENT_ENV: Partial<FirebaseClientEnv> = defaultFirebaseProject;

export function getDefaultFirebaseClientEnv(): Partial<FirebaseClientEnv> {
  return { ...DEFAULT_FIREBASE_CLIENT_ENV };
}
