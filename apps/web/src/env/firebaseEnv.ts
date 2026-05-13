import type { FirebaseClientEnv } from "@h-memo/memo-sync/firebase-env-validation";

type RawViteEnv = Record<string, string | undefined>;

const viteEnv = (import.meta as unknown as { env: RawViteEnv }).env;

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function getFirebaseClientEnv(): Partial<FirebaseClientEnv> {
  return {
    apiKey: trim(viteEnv.VITE_FIREBASE_API_KEY),
    authDomain: trim(viteEnv.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: trim(viteEnv.VITE_FIREBASE_PROJECT_ID),
    appId: trim(viteEnv.VITE_FIREBASE_APP_ID),
    storageBucket: trim(viteEnv.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: trim(viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID),
    measurementId: trim(viteEnv.VITE_FIREBASE_MEASUREMENT_ID),
  };
}
