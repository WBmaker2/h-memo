import { initializeApp, type FirebaseOptions } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import { type FirebaseClientEnv, validateFirebaseClientEnv } from "./firebaseEnvValidation";

function normalize(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function createFirebaseApp(
  env: Partial<FirebaseClientEnv>,
  name?: string
): FirebaseApp {
  const validation = validateFirebaseClientEnv(env);
  const missingKeys = validation.missingRequiredKeys;

  if (missingKeys.length > 0) {
    throw new Error(
      `Firebase 설정에 누락된 값이 있습니다: ${missingKeys.join(", ")}`
    );
  }

  const apiKey = normalize(env.apiKey);
  const authDomain = normalize(env.authDomain);
  const projectId = normalize(env.projectId);
  const appId = normalize(env.appId);
  const storageBucket = normalize(env.storageBucket);
  const messagingSenderId = normalize(env.messagingSenderId);
  const measurementId = normalize(env.measurementId);

  const options: FirebaseOptions = {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
    ...(measurementId ? { measurementId } : {}),
  };

  return initializeApp(options, name);
}
