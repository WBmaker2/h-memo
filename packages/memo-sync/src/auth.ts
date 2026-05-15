import type { FirebaseApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
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

export type GoogleOAuthTokens = {
  idToken: string;
  accessToken?: string;
};

export type SignInWithGoogleOptions = {
  fallbackToRedirect?: boolean;
  desktopOAuth?: () => Promise<GoogleOAuthTokens>;
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
  options: SignInWithGoogleOptions = {}
): Promise<HMemoUser | null> {
  const provider = new GoogleAuthProvider();

  if (options.desktopOAuth) {
    const tokens = await options.desktopOAuth();
    const credential = GoogleAuthProvider.credential(
      tokens.idToken,
      tokens.accessToken || undefined
    );
    const result = await signInWithCredential(auth, credential);
    return toHMemoUser(result.user);
  }

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
  _intervalMs = 250
): Promise<HMemoUser | null> {
  if (auth.currentUser) {
    return toHMemoUser(auth.currentUser);
  }

  return new Promise((resolve) => {
    let isSettled = false;
    let unsubscribe: Unsubscribe = () => {};
    const timeout = globalThis.setTimeout(() => {
      finish(null);
    }, timeoutMs);

    const finish = (user: HMemoUser | null) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    };

    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        finish(toHMemoUser(user));
      }
    });

    if (isSettled) {
      unsubscribe();
    }
  });
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
