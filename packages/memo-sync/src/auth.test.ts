import { describe, expect, it, vi } from "vitest";
import { onAuthStateChanged, type NextOrObserver, type User } from "firebase/auth";
import { subscribeAuthUser, toHMemoUser } from "./auth";

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
  };
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
