import { initializeApp, type FirebaseOptions } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import { type FirebaseClientEnv, validateFirebaseClientEnv } from "./firebaseEnvValidation";

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

  const options: FirebaseOptions = {
    apiKey: env.apiKey,
    authDomain: env.authDomain,
    projectId: env.projectId,
    appId: env.appId,
    ...(env.storageBucket ? { storageBucket: env.storageBucket } : {}),
    ...(env.messagingSenderId ? { messagingSenderId: env.messagingSenderId } : {}),
    ...(env.measurementId ? { measurementId: env.measurementId } : {}),
  };

  return initializeApp(options, name);
}
