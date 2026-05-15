import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  type NextOrObserver,
  type User,
} from "firebase/auth";
import { completeGoogleRedirectSignIn, signInWithGoogle, subscribeAuthUser, toHMemoUser } from "./auth";

function createFakeUser(overrides: Partial<User> = {}): User {
  return {
    uid: "user-1",
    providerId: "firebase",
    displayName: "사용자",
    email: "user@example.com",
    photoURL: "https://example.com/p.png",
    ...overrides,
  } as unknown as User;
}

vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getRedirectResult: vi.fn(),
    onAuthStateChanged: vi.fn((_, callback: NextOrObserver<User>) => {
      const emitUser = (nextUser: User | null) => {
        if (typeof callback === "function") {
          callback(nextUser);
        } else {
          callback.next?.(nextUser);
        }
      };
      const unsubscribe = vi.fn();
      setTimeout(() => emitUser(null), 0);
      return unsubscribe;
    }),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("subscribeAuthUser", () => {
  it("maps Firebase User to HMemoUser and handles null", () => {
    const callback = vi.fn();
    const mockOnAuthStateChanged = vi.mocked(onAuthStateChanged);

    const fakeUser = createFakeUser();

    mockOnAuthStateChanged.mockImplementation((_, cb: NextOrObserver<User>) => {
      if (typeof cb === "function") {
        cb(fakeUser);
      } else {
        cb.next?.(fakeUser);
      }
      return vi.fn();
    });

    const unsubscribe = subscribeAuthUser({} as any, callback);

    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(toHMemoUser(fakeUser));
    expect(unsubscribe).toBeTypeOf("function");
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: "user-1",
        displayName: "사용자",
        email: "user@example.com",
        photoURL: "https://example.com/p.png",
      })
    );
    unsubscribe();
  });

  it("전달된 사용자 없이 null을 전달하면 null을 콜백에 전달한다", () => {
    const callback = vi.fn();
    const mockOnAuthStateChanged = vi.mocked(onAuthStateChanged);
    const unsubscribe = vi.fn();

    mockOnAuthStateChanged.mockImplementation((_, cb: NextOrObserver<User>) => {
      if (typeof cb === "function") {
        cb(null);
      } else {
        cb.next?.(null);
      }
      return unsubscribe;
    });

    const returnedUnsubscribe = subscribeAuthUser({} as any, callback);

    expect(callback).toHaveBeenCalledWith(null);
    expect(returnedUnsubscribe).toBe(unsubscribe);
  });
});

describe("signInWithGoogle", () => {
  it("uses popup login and maps the signed-in user", async () => {
    const fakeUser = createFakeUser();
    vi.mocked(signInWithPopup).mockResolvedValue({ user: fakeUser } as never);

    await expect(signInWithGoogle({} as any)).resolves.toEqual(toHMemoUser(fakeUser));

    expect(signInWithPopup).toHaveBeenCalledTimes(1);
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it("falls back to redirect when Tauri blocks the popup", async () => {
    vi.mocked(signInWithPopup).mockRejectedValue({ code: "auth/popup-blocked" });
    vi.mocked(signInWithRedirect).mockImplementation(async () => undefined as never);

    await expect(
      signInWithGoogle({} as any, { fallbackToRedirect: true })
    ).resolves.toBeNull();

    expect(signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("falls back to redirect when popup auth is not supported in the environment", async () => {
    vi.mocked(signInWithPopup).mockRejectedValue({
      code: "auth/operation-not-supported-in-this-environment",
    });
    vi.mocked(signInWithRedirect).mockImplementation(async () => undefined as never);

    await expect(
      signInWithGoogle({} as any, { fallbackToRedirect: true })
    ).resolves.toBeNull();

    expect(signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("does not redirect for user-cancelled popup closes", async () => {
    vi.mocked(signInWithPopup).mockRejectedValue({ code: "auth/popup-closed-by-user" });

    await expect(
      signInWithGoogle({} as any, { fallbackToRedirect: true })
    ).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });

    expect(signInWithRedirect).not.toHaveBeenCalled();
  });
});

describe("completeGoogleRedirectSignIn", () => {
  it("returns null when there is no redirect result", async () => {
    vi.mocked(getRedirectResult).mockResolvedValue(null);

    await expect(completeGoogleRedirectSignIn({} as any)).resolves.toBeNull();
  });

  it("maps redirect result user", async () => {
    const fakeUser = createFakeUser({ uid: "redirect-user" });
    vi.mocked(getRedirectResult).mockResolvedValue({ user: fakeUser } as never);

    await expect(completeGoogleRedirectSignIn({} as any)).resolves.toEqual(
      toHMemoUser(fakeUser)
    );
  });
});
