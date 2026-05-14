import type { FirebaseClientEnv } from "./firebaseEnvValidation";

export const FIREBASE_CLIENT_CONFIG_STORAGE_KEY = "h-memo.firebaseClientConfig.v1";

export type FirebaseClientConfigInput = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
};

const FIREBASE_CLIENT_CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
  "storageBucket",
  "messagingSenderId",
  "measurementId",
] as const;

type FirebaseClientConfigKey = (typeof FIREBASE_CLIENT_CONFIG_KEYS)[number];

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeFirebaseClientConfig(
  config: Partial<Record<FirebaseClientConfigKey, unknown>>
): Partial<FirebaseClientEnv> {
  return FIREBASE_CLIENT_CONFIG_KEYS.reduce<Partial<FirebaseClientEnv>>((result, key) => {
    const value = trim(config[key]);
    if (value) {
      result[key] = value;
    }
    return result;
  }, {});
}

export function mergeFirebaseClientConfig(
  baseConfig: Partial<FirebaseClientEnv>,
  overrideConfig: Partial<FirebaseClientEnv>
): Partial<FirebaseClientEnv> {
  return normalizeFirebaseClientConfig({
    ...normalizeFirebaseClientConfig(baseConfig),
    ...normalizeFirebaseClientConfig(overrideConfig),
  });
}

export function toFirebaseClientConfigInput(
  config: Partial<FirebaseClientEnv>
): Required<FirebaseClientConfigInput> {
  const normalized = normalizeFirebaseClientConfig(config);
  return FIREBASE_CLIENT_CONFIG_KEYS.reduce<Required<FirebaseClientConfigInput>>(
    (result, key) => {
      result[key] = normalized[key] ?? "";
      return result;
    },
    {
      apiKey: "",
      authDomain: "",
      projectId: "",
      appId: "",
      storageBucket: "",
      messagingSenderId: "",
      measurementId: "",
    }
  );
}

export function readStoredFirebaseClientConfig(
  storage: Storage | null = getBrowserStorage()
): Partial<FirebaseClientEnv> {
  if (!storage) {
    return {};
  }

  const rawValue = storage.getItem(FIREBASE_CLIENT_CONFIG_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<Record<FirebaseClientConfigKey, unknown>>;
    return normalizeFirebaseClientConfig(parsed);
  } catch {
    return {};
  }
}

export function saveStoredFirebaseClientConfig(
  config: Partial<FirebaseClientConfigInput>,
  storage: Storage | null = getBrowserStorage()
): Partial<FirebaseClientEnv> {
  const normalized = normalizeFirebaseClientConfig(config);

  if (storage) {
    storage.setItem(FIREBASE_CLIENT_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function clearStoredFirebaseClientConfig(
  storage: Storage | null = getBrowserStorage()
): void {
  storage?.removeItem(FIREBASE_CLIENT_CONFIG_STORAGE_KEY);
}
