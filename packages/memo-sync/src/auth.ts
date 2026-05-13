import type { FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
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

export async function signInWithGoogle(auth: Auth): Promise<HMemoUser> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return toHMemoUser(result.user);
}

export async function signOutUser(auth: Auth): Promise<void> {
  await signOut(auth);
}
