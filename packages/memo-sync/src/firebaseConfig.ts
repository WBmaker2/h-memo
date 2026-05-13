import type { FirebaseApp } from "firebase/app";
import { initializeApp, type FirebaseOptions } from "firebase/app";

export type FirebaseClientEnv = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
};

export function hasFirebaseConfig(
  env: Partial<FirebaseClientEnv>
): env is FirebaseClientEnv {
  return (
    typeof env.apiKey === "string" &&
    env.apiKey.trim() !== "" &&
    typeof env.authDomain === "string" &&
    env.authDomain.trim() !== "" &&
    typeof env.projectId === "string" &&
    env.projectId.trim() !== "" &&
    typeof env.appId === "string" &&
    env.appId.trim() !== ""
  );
}

export function createFirebaseApp(
  env: Partial<FirebaseClientEnv>,
  name?: string
): FirebaseApp {
  const requiredKeys: Array<keyof FirebaseClientEnv> = [
    "apiKey",
    "authDomain",
    "projectId",
    "appId",
  ];

  const missingKeys = requiredKeys.filter((key) => {
    const value = env[key];
    return !(typeof value === "string" && value.trim() !== "");
  });

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
