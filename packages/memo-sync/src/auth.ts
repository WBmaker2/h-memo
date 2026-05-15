import type { FirebaseApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type Unsubscribe,
  type User,
} from "firebase/auth";

export type HMemoUser = {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
};

export function toHMemoUser(user: User): HMemoUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    photoURL: user.photoURL ?? "",
  };
}

export function getFirebaseAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}

function shouldFallbackToRedirect(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  return (
    code === "auth/popup-blocked" ||
    code === "auth/operation-not-supported-in-this-environment"
  );
}

export async function signInWithGoogle(
  auth: Auth,
  options: { fallbackToRedirect?: boolean } = {}
): Promise<HMemoUser | null> {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return toHMemoUser(result.user);
  } catch (error) {
    if (!options.fallbackToRedirect || !shouldFallbackToRedirect(error)) {
      throw error;
    }

    await signInWithRedirect(auth, provider);
    return null;
  }
}

export async function completeGoogleRedirectSignIn(
  auth: Auth
): Promise<HMemoUser | null> {
  const result = await getRedirectResult(auth);
  return result ? toHMemoUser(result.user) : null;
}

export async function waitForSignedInUser(
  auth: Auth,
  timeoutMs = 8000,
  intervalMs = 250
): Promise<HMemoUser | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (auth.currentUser) {
      return toHMemoUser(auth.currentUser);
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, intervalMs));
  }

  return null;
}

export async function signOutUser(auth: Auth): Promise<void> {
  await signOut(auth);
}

export function subscribeAuthUser(
  auth: Auth,
  callback: (user: HMemoUser | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    callback(user ? toHMemoUser(user) : null);
  });
}
