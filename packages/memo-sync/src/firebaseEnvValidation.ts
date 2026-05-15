export type FirebaseClientEnv = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  googleOAuthClientId?: string;
};

export const FIREBASE_REQUIRED_CLIENT_ENV_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
] as const;

export const FIREBASE_OPTIONAL_CLIENT_ENV_KEYS = [
  "storageBucket",
  "messagingSenderId",
  "measurementId",
  "googleOAuthClientId",
] as const;

export type FirebaseValidationReport = {
  isValid: boolean;
  missingRequiredKeys: string[];
  missingOptionalKeys: string[];
  presentRequiredKeys: string[];
  presentOptionalKeys: string[];
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissing(value: unknown): boolean {
  return normalize(value) === "";
}

export function validateFirebaseClientEnv(
  env: Partial<FirebaseClientEnv>
): FirebaseValidationReport {
  const missingRequiredKeys = FIREBASE_REQUIRED_CLIENT_ENV_KEYS.filter((key) =>
    isMissing(env[key])
  );
  const presentRequiredKeys = FIREBASE_REQUIRED_CLIENT_ENV_KEYS.filter(
    (key) => !isMissing(env[key])
  );

  const missingOptionalKeys = FIREBASE_OPTIONAL_CLIENT_ENV_KEYS.filter((key) =>
    isMissing(env[key])
  );
  const presentOptionalKeys = FIREBASE_OPTIONAL_CLIENT_ENV_KEYS.filter(
    (key) => !isMissing(env[key])
  );

  return {
    isValid: missingRequiredKeys.length === 0,
    missingRequiredKeys,
    missingOptionalKeys,
    presentRequiredKeys,
    presentOptionalKeys,
  };
}

export function hasFirebaseConfig(
  env: Partial<FirebaseClientEnv>
): env is FirebaseClientEnv {
  return validateFirebaseClientEnv(env).isValid;
}
