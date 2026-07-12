import { describe, expect, it, vi } from "vitest";
import { createRestoreLockCoordinator } from "./restoreLock";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("restore lock coordinator", () => {
  it("acquires the native lease before enumerating windows and releases it with the token", async () => {
    const events: string[] = [];
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        events.push("lease-acquire");
        return { token, owner, expiresAtMs: Date.now() + ttlMs };
      }),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
      })),
      release: vi.fn(async () => {
        events.push("lease-release");
        return true;
      }),
    };
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => {
        events.push("list-live");
        return ["main"];
      },
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      nativeLease,
      lockLocal: () => {
        events.push("lock-local");
        return Promise.resolve();
      },
      unlockLocal: () => {},
    });

    await coordinator.start();
    const token = await coordinator.acquire();
    await coordinator.release(token);

    expect(events.slice(0, 3)).toEqual(["lock-local", "lease-acquire", "list-live"]);
    expect(nativeLease.release).toHaveBeenCalledWith(token, "main");
  });

  it("times out when a live window never acknowledges", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main", "memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        lockLocal: async () => {},
        unlockLocal: vi.fn(),
        timeoutMs: 100,
      });

      const acquirePromise = coordinator.acquire();
      const handledAcquire = acquirePromise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      const result = await handledAcquire;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty(
          "message",
          "복원 잠금 승인을 기다리는 시간이 초과되었습니다."
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung lock notification and releases the native lease", async () => {
    vi.useFakeTimers();
    try {
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        release: vi.fn(async () => true),
      };
      const unlockLocal = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: () => new Promise<void>(() => {}),
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        timeoutMs: 100,
      });

      const acquirePromise = coordinator.acquire();
      const outcome = Promise.race([
        acquirePromise.then(() => "resolved", () => "rejected"),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("still-pending"), 101);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(101);

      await expect(outcome).resolves.toBe("rejected");
      expect(nativeLease.release).toHaveBeenCalled();
      expect(unlockLocal).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks remote windows from native lease state when the release event is lost", async () => {
    vi.useFakeTimers();
    try {
      let lease: { token: string; owner: string; expiresAtMs: number } | null = null;
      let requestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
      let releaseHandler: ((payload: { token: string }) => void) | null = null;
      const unlocked = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        current: vi.fn(async () => lease),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        release: vi.fn(async () => true),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async (handler) => {
          requestHandler = handler;
          return () => {};
        },
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async (handler) => {
          releaseHandler = handler;
          return () => {};
        },
        nativeLease,
        lockLocal: async () => {},
        unlockLocal: unlocked,
        leasePollIntervalMs: 50,
        leaseTtlMs: 100,
      });

      await coordinator.start();
      lease = { token: "token-a", owner: "main", expiresAtMs: Date.now() + 100 };
      await requestHandler!({ token: "token-a" });
      expect(unlocked).not.toHaveBeenCalled();

      lease = null;
      await vi.advanceTimersByTimeAsync(50);
      expect(unlocked).toHaveBeenCalledWith("token-a");

      lease = { token: "token-b", owner: "main", expiresAtMs: Date.now() + 100 };
      await requestHandler!({ token: "token-b" });
      releaseHandler!({ token: "token-a" });
      expect(unlocked).toHaveBeenCalledTimes(1);
      releaseHandler!({ token: "token-b" });
      expect(unlocked).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sets the local barrier before listing windows and waits for queued writes and acknowledgements", async () => {
    const events: string[] = [];
    const drain = deferred();
    let ackListener: ((payload: { token: string; windowLabel: string; ok: boolean }) => void) | null = null;
    let requestedToken = "";
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => {
        events.push("list-live");
        return ["main", "memo-1"];
      },
      notifyLockRequested: async (token) => {
        events.push("broadcast-lock");
        requestedToken = token;
        queueMicrotask(() => ackListener?.({ token, windowLabel: "memo-1", ok: true }));
      },
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async (handler) => {
        ackListener = handler;
        return () => {};
      },
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      lockLocal: (token) => {
        expect(token).toBeTruthy();
        events.push("lock-local");
        return drain.promise;
      },
      unlockLocal: () => {
        events.push("unlock-local");
      },
    });

    await coordinator.start();
    const acquirePromise = coordinator.acquire();
    let acquired = false;
    void acquirePromise.then(() => {
      acquired = true;
    });
    await vi.waitFor(() => {
      expect(events.slice(0, 2)).toEqual(["lock-local", "list-live"]);
    });
    expect(acquired).toBe(false);

    drain.resolve();
    await expect(acquirePromise).resolves.toBe(requestedToken);
    await coordinator.release(requestedToken);

    expect(events).toContain("unlock-local");
  });

  it("unlocks locally when the mutation finishes with a failure", async () => {
    const unlocked = vi.fn();
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {
        throw new Error("release broadcast failed");
      },
      listenLockReleased: async () => () => {},
      lockLocal: async () => {},
      unlockLocal: unlocked,
    });

    await coordinator.start();
    const token = await coordinator.acquire();
    await expect(coordinator.release(token)).resolves.toBeUndefined();
    expect(unlocked).toHaveBeenCalledWith(token);
  });

  it("defers release and listener disposal until the active operation settles", async () => {
    const operation = deferred<void>();
    const cleanupRequested = vi.fn();
    const cleanupAcknowledged = vi.fn();
    const cleanupReleased = vi.fn();
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
      })),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
      })),
      release: vi.fn(async () => true),
    };
    const unlockLocal = vi.fn();
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: async () => {},
      listenLockRequested: async () => cleanupRequested,
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => cleanupAcknowledged,
      notifyLockReleased: async () => {},
      listenLockReleased: async () => cleanupReleased,
      nativeLease,
      lockLocal: async () => {},
      unlockLocal,
    });

    await coordinator.start();
    const runPromise = coordinator.run(() => operation.promise);
    await vi.waitFor(() => expect(nativeLease.acquire).toHaveBeenCalled());

    const stopPromise = coordinator.stop();
    await Promise.resolve();
    expect(nativeLease.release).not.toHaveBeenCalled();
    expect(unlockLocal).not.toHaveBeenCalled();
    expect(cleanupRequested).not.toHaveBeenCalled();

    operation.resolve();
    await expect(runPromise).resolves.toBeUndefined();
    await stopPromise;

    expect(nativeLease.release).toHaveBeenCalledTimes(1);
    expect(unlockLocal).toHaveBeenCalledTimes(1);
    expect(cleanupRequested).toHaveBeenCalledTimes(1);
    expect(cleanupAcknowledged).toHaveBeenCalledTimes(1);
    expect(cleanupReleased).toHaveBeenCalledTimes(1);
  });

  it("bounds hung native release and release broadcast cleanup", async () => {
    vi.useFakeTimers();
    try {
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        release: vi.fn(() => new Promise<boolean>(() => {})),
      };
      const unlockLocal = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        cleanupTimeoutMs: 25,
      });

      const token = await coordinator.acquire();
      const releasePromise = coordinator.release(token);
      const outcome = Promise.race([
        releasePromise.then(() => "settled" as const),
        new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 60)),
      ]);
      await vi.advanceTimersByTimeAsync(60);

      await expect(outcome).resolves.toBe("settled");
      expect(unlockLocal).toHaveBeenCalledWith(token);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an active operation on renewal failure but defers release until its callback settles", async () => {
    vi.useFakeTimers();
    try {
      const operation = deferred<void>();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async () => {
          throw new Error("renewal failed");
        }),
        release: vi.fn(async () => true),
      };
      const unlockLocal = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        leaseRenewIntervalMs: 10,
        cleanupTimeoutMs: 10,
      });

      const runPromise = coordinator.run(() => operation.promise);
      const handledRun = runPromise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(10);
      const runResult = await handledRun;
      expect(runResult.ok).toBe(false);
      if (!runResult.ok) {
        expect(runResult.error).toHaveProperty("message", "renewal failed");
      }
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();

      operation.resolve();
      await vi.waitFor(() => expect(nativeLease.release).toHaveBeenCalledTimes(1));
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
