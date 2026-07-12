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

async function flushMicrotasks(count = 20) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("restore lock coordinator", () => {
  it("acquires the native lease before enumerating windows and releases it with the token", async () => {
    const events: string[] = [];
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        events.push("lease-acquire");
        return {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
      }),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: false,
      })),
      activate: vi.fn(async (token: string, owner: string) => ({
        token,
        owner,
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
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
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        activate: vi.fn(async (token: string, owner: string) => ({
          token,
          owner,
          expiresAtMs: Date.now() + 10_000,
          operationActive: true,
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
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let requestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
      let releaseHandler: ((payload: { token: string }) => void) | null = null;
      const unlocked = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        current: vi.fn(async () => lease),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        activate: vi.fn(async (token: string, owner: string) => ({
          token,
          owner,
          expiresAtMs: Date.now() + 10_000,
          operationActive: true,
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
      lease = {
        token: "token-a",
        owner: "main",
        expiresAtMs: Date.now() + 100,
        operationActive: false,
      };
      await requestHandler!({ token: "token-a" });
      expect(unlocked).not.toHaveBeenCalled();

      lease = null;
      await vi.advanceTimersByTimeAsync(50);
      expect(unlocked).toHaveBeenCalledWith("token-a");

      lease = {
        token: "token-b",
        owner: "main",
        expiresAtMs: Date.now() + 100,
        operationActive: false,
      };
      await requestHandler!({ token: "token-b" });
      releaseHandler!({ token: "token-a" });
      expect(unlocked).toHaveBeenCalledTimes(1);
      releaseHandler!({ token: "token-b" });
      expect(unlocked).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands off a stale remote token to a newer native lease before polling", async () => {
    vi.useFakeTimers();
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let requestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
      const notifyLockAcknowledged = vi.fn(async () => {});
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
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
        notifyLockAcknowledged,
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        leasePollIntervalMs: 1000,
      });

      await coordinator.start();
      lease = {
        token: "token-a",
        owner: "main",
        expiresAtMs: Date.now() + 10_000,
        operationActive: false,
      };
      await requestHandler!({ token: "token-a" });
      await vi.waitFor(() =>
        expect(notifyLockAcknowledged).toHaveBeenLastCalledWith({
          token: "token-a",
          windowLabel: "memo-1",
          ok: true,
        })
      );

      lease = {
        token: "token-b",
        owner: "main",
        expiresAtMs: Date.now() + 10_000,
        operationActive: false,
      };
      notifyLockAcknowledged.mockClear();
      await requestHandler!({ token: "token-b" });

      expect(unlockLocal).toHaveBeenCalledWith("token-a");
      await vi.waitFor(() =>
        expect(notifyLockAcknowledged).toHaveBeenCalledWith({
          token: "token-b",
          windowLabel: "memo-1",
          ok: true,
        })
      );
      expect(notifyLockAcknowledged).not.toHaveBeenCalledWith(
        expect.objectContaining({ token: "token-b", ok: false })
      );

      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an older remote request when a newer request owns the lease", async () => {
    vi.useFakeTimers();
    try {
      type Lease = {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      };
      const currentCalls: Array<ReturnType<typeof deferred<Lease | null>>> = [];
      let startupCurrent = true;
      let requestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
      let releaseHandler: ((payload: { token: string }) => void) | null = null;
      const notifyLockAcknowledged = vi.fn(async () => {});
      const lockLocal = vi.fn(async () => {});
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(),
        current: vi.fn(() => {
          if (startupCurrent) {
            startupCurrent = false;
            return Promise.resolve(null);
          }
          const pending = deferred<Lease | null>();
          currentCalls.push(pending);
          return pending.promise;
        }),
        renew: vi.fn(),
        activate: vi.fn(),
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
        notifyLockAcknowledged,
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async (token) => {
          releaseHandler?.({ token });
        },
        listenLockReleased: async (handler) => {
          releaseHandler = handler;
          return () => {};
        },
        nativeLease,
        lockLocal,
        unlockLocal,
        leasePollIntervalMs: 1000,
      });
      const leaseB: Lease = {
        token: "request-b",
        owner: "main",
        expiresAtMs: Date.now() + 10_000,
        operationActive: false,
      };

      await coordinator.start();
      requestHandler!({ token: "request-a" });
      expect(currentCalls).toHaveLength(1);
      requestHandler!({ token: "request-b" });
      expect(currentCalls).toHaveLength(2);

      currentCalls[1]!.resolve(leaseB);
      await flushMicrotasks(50);
      expect(currentCalls).toHaveLength(3);
      currentCalls[2]!.resolve(leaseB);
      await vi.waitFor(() =>
        expect(notifyLockAcknowledged).toHaveBeenCalledWith({
          token: "request-b",
          windowLabel: "memo-1",
          ok: true,
        })
      );

      currentCalls[0]!.resolve({
        ...leaseB,
        token: "request-a",
      });
      await flushMicrotasks(50);

      expect(lockLocal).toHaveBeenCalledTimes(1);
      expect(lockLocal).toHaveBeenCalledWith("request-b");
      expect(lockLocal).not.toHaveBeenCalledWith("request-a");
      expect(unlockLocal).not.toHaveBeenCalled();
      expect(notifyLockAcknowledged).toHaveBeenCalledTimes(1);
      expect(notifyLockAcknowledged).not.toHaveBeenCalledWith(
        expect.objectContaining({ token: "request-a" })
      );

      releaseHandler!({ token: "request-b" });
      expect(unlockLocal).toHaveBeenCalledWith("request-b");
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurrect startup after stop while native lease lookup is deferred", async () => {
    vi.useFakeTimers();
    try {
      type Lease = {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      };
      const currentLease = deferred<Lease | null>();
      const lockLocal = vi.fn(async () => {});
      const notifyLockAcknowledged = vi.fn(async () => {});
      const cleanups = [vi.fn(), vi.fn(), vi.fn()];
      const nativeLease = {
        acquire: vi.fn(),
        current: vi.fn(() => currentLease.promise),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(async () => true),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => cleanups[0]!,
        notifyLockAcknowledged,
        listenLockAcknowledged: async () => cleanups[1]!,
        notifyLockReleased: async () => {},
        listenLockReleased: async () => cleanups[2]!,
        nativeLease,
        lockLocal,
        unlockLocal: vi.fn(),
        cleanupTimeoutMs: 100,
      });

      const startPromise = coordinator.start();
      await flushMicrotasks();
      expect(nativeLease.current).toHaveBeenCalledTimes(1);

      const stopPromise = coordinator.stop();
      currentLease.resolve({
        token: "stale-startup-token",
        owner: "main",
        expiresAtMs: Date.now() + 10_000,
        operationActive: false,
      });

      await expect(startPromise).resolves.toBeUndefined();
      await stopPromise;
      await vi.advanceTimersByTimeAsync(1000);

      expect(lockLocal).not.toHaveBeenCalled();
      expect(notifyLockAcknowledged).not.toHaveBeenCalled();
      expect(nativeLease.current).toHaveBeenCalledTimes(1);
      expect(cleanups[0]).toHaveBeenCalledTimes(1);
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
      expect(cleanups[2]).toHaveBeenCalledTimes(1);
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
        operationActive: false,
      })),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: false,
      })),
      activate: vi.fn(async (token: string, owner: string) => ({
        token,
        owner,
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
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
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        activate: vi.fn(async (token: string, owner: string) => ({
          token,
          owner,
          expiresAtMs: Date.now() + 10_000,
          operationActive: true,
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
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async () => {
          throw new Error("renewal failed");
        }),
        activate: vi.fn(async (token: string, owner: string) => ({
          token,
          owner,
          expiresAtMs: Date.now() + 10_000,
          operationActive: true,
        })),
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

  it("keeps remote windows locked after renewal failure and ttl expiry until callback release", async () => {
    vi.useFakeTimers();
    try {
      const operation = deferred<void>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let mainAcknowledgementHandler:
        | ((payload: { token: string; windowLabel: string; ok: boolean; error?: string }) => void)
        | null = null;
      let remoteRequestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
      let remoteReleaseHandler: ((payload: { token: string }) => void) | null = null;
      const remoteUnlock = vi.fn();
      const createNativeLease = (canAcquire: boolean) => ({
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          if (!canAcquire) {
            throw new Error("remote coordinator cannot acquire");
          }
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => {
          if (lease && !lease.operationActive && lease.expiresAtMs <= Date.now()) {
            lease = null;
          }
          return lease;
        }),
        renew: vi.fn(async () => {
          throw new Error("renewal failed");
        }),
        activate: vi.fn(async (token: string, owner: string) => {
          if (!lease || lease.token !== token || lease.owner !== owner) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        release: vi.fn(async (token: string, owner: string) => {
          if (lease?.token !== token || lease.owner !== owner) {
            return false;
          }
          lease = null;
          return true;
        }),
      });

      const mainNativeLease = createNativeLease(true);
      const remoteNativeLease = createNativeLease(false);
      const main = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main", "memo-1"],
        notifyLockRequested: async (token) => {
          await remoteRequestHandler?.({ token });
        },
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async (payload) => {
          mainAcknowledgementHandler?.(payload);
        },
        listenLockAcknowledged: async (handler) => {
          mainAcknowledgementHandler = handler;
          return () => {};
        },
        notifyLockReleased: async (token) => {
          remoteReleaseHandler?.({ token });
        },
        listenLockReleased: async () => () => {},
        nativeLease: mainNativeLease,
        lockLocal: async () => {},
        unlockLocal: () => {},
        leaseTtlMs: 20,
        leaseRenewIntervalMs: 10,
        leasePollIntervalMs: 5,
      });
      const remote = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async (handler) => {
          remoteRequestHandler = handler;
          return () => {};
        },
        notifyLockAcknowledged: async (payload) => {
          mainAcknowledgementHandler?.(payload);
        },
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async (handler) => {
          remoteReleaseHandler = handler;
          return () => {};
        },
        nativeLease: remoteNativeLease,
        lockLocal: async () => {},
        unlockLocal: remoteUnlock,
        leasePollIntervalMs: 5,
        leaseTtlMs: 20,
      });

      await remote.start();
      await main.start();
      const runPromise = main.run(() => operation.promise);
      const handledRun = runPromise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await flushMicrotasks();
      expect(mainNativeLease.activate).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      const runResult = await handledRun;
      expect(runResult.ok).toBe(false);
      expect(lease).toEqual(expect.objectContaining({ operationActive: true }));

      await vi.advanceTimersByTimeAsync(100);
      expect(lease).toEqual(expect.objectContaining({ operationActive: true }));
      expect(remoteUnlock).not.toHaveBeenCalled();

      operation.resolve();
      await vi.waitFor(() => expect(mainNativeLease.release).toHaveBeenCalledTimes(1));
      expect(remoteUnlock).toHaveBeenCalledWith(expect.any(String));
      await main.stop();
      await remote.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes concurrent run calls before the first acquire completes", async () => {
    const acquireGate = deferred<void>();
    const firstOperation = deferred<void>();
    let secondStarted = false;
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        await acquireGate.promise;
        return {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
      }),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: true,
      })),
      activate: vi.fn(async (token: string, owner: string) => ({
        token,
        owner,
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
      })),
      release: vi.fn(async () => true),
    };
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
      unlockLocal: () => {},
    });

    const firstRun = coordinator.run(() => firstOperation.promise);
    const secondRun = coordinator.run(async () => {
      secondStarted = true;
      return "second";
    });
    const handledSecondRun = secondRun.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    await vi.waitFor(() => expect(nativeLease.acquire).toHaveBeenCalled());
    const acquireCountBeforeRelease = nativeLease.acquire.mock.calls.length;
    acquireGate.resolve();
    expect(acquireCountBeforeRelease).toBe(1);
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    firstOperation.resolve();
    await expect(firstRun).resolves.toBeUndefined();
    const secondResult = await handledSecondRun;
    expect(secondResult).toEqual({ ok: true, value: "second" });
    expect(nativeLease.acquire).toHaveBeenCalledTimes(2);
  });

  it("releases a startup remote lock when native state disappears before queue drain", async () => {
    vi.useFakeTimers();
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = {
        token: "startup-token",
        owner: "main",
        expiresAtMs: Date.now() + 100,
        operationActive: false,
      };
      const unlockLocal = vi.fn();
      const notifyLockAcknowledged = vi.fn(async () => {});
      const nativeLease = {
        acquire: vi.fn(),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(async () => true),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged,
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: () => new Promise<void>(() => {}),
        unlockLocal,
        leasePollIntervalMs: 10,
        leaseTtlMs: 100,
      });

      const startPromise = coordinator.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeLease.current).toHaveBeenCalled();
      lease = null;
      const outcome = Promise.race([
        startPromise.then(() => "ready" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ]);
      await vi.advanceTimersByTimeAsync(50);

      await expect(outcome).resolves.toBe("ready");
      expect(unlockLocal).toHaveBeenCalledWith("startup-token");
      expect(notifyLockAcknowledged).not.toHaveBeenCalled();
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a late renewal failure from an earlier serialized operation", async () => {
    vi.useFakeTimers();
    try {
      type Lease = {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      };
      const renewals: Array<{
        pending: ReturnType<typeof deferred<Lease>>;
        token: string;
        owner: string;
      }> = [];
      const firstOperation = deferred<string>();
      const secondOperation = deferred<string>();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          const renewal = deferred<Lease>();
          renewals.push({ pending: renewal, token, owner });
          return renewal.promise;
        }),
        activate: vi.fn(async (token: string, owner: string) => ({
          token,
          owner,
          expiresAtMs: Date.now() + 10_000,
          operationActive: true,
        })),
        release: vi.fn(async () => true),
      };
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
        unlockLocal: () => {},
        leaseRenewIntervalMs: 10,
      });

      const firstRun = coordinator.run(() => firstOperation.promise);
      await flushMicrotasks(100);
      expect(nativeLease.activate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(renewals).toHaveLength(1);
      firstOperation.resolve("first");
      await expect(firstRun).resolves.toBe("first");

      const secondRun = coordinator.run(() => secondOperation.promise);
      const handledSecondRun = secondRun.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await flushMicrotasks();
      expect(nativeLease.activate).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10);
      expect(renewals).toHaveLength(2);

      let secondSettled = false;
      void handledSecondRun.then(() => {
        secondSettled = true;
      });
      renewals[0]!.pending.reject(new Error("late renewal failure"));
      await Promise.resolve();
      await Promise.resolve();
      expect(secondSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(10);
      expect(renewals).toHaveLength(3);

      renewals[1]!.pending.resolve({
        token: renewals[1]!.token,
        owner: renewals[1]!.owner,
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
      });
      secondOperation.resolve("second");
      await expect(handledSecondRun).resolves.toEqual({ ok: true, value: "second" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains an ordinary queued save before activating the restore operation", async () => {
    type Lease = {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    };
    let lease: Lease | null = null;
    let queuedSaveCount = 0;
    const ordinarySave = async () => {
      if (lease?.operationActive) {
        throw new Error("ordinary save blocked by active restore");
      }
      queuedSaveCount += 1;
    };
    const operation = deferred<void>();
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        lease = {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
        await ordinarySave();
        return lease;
      }),
      current: vi.fn(async () => null),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: true,
      })),
      activate: vi.fn(async (token: string, owner: string) => {
        if (!lease || lease.token !== token || lease.owner !== owner) {
          throw new Error("lease missing");
        }
        lease.operationActive = true;
        return lease;
      }),
      release: vi.fn(async () => {
        lease = null;
        return true;
      }),
    };
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: vi.fn(async () => {}),
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: () => {},
    });

    const runPromise = coordinator.run(() => operation.promise);
    await vi.waitFor(() => expect(nativeLease.activate).toHaveBeenCalledTimes(1));
    expect(queuedSaveCount).toBe(1);
    await expect(ordinarySave()).rejects.toThrow("ordinary save blocked");

    operation.resolve();
    await expect(runPromise).resolves.toBeUndefined();
  });

  it("suppresses a success ACK when native lease disappears after remote drain", async () => {
    const drain = deferred<void>();
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = null;
    let requestHandler: ((payload: { token: string }) => void | Promise<void>) | null = null;
    const notifyLockAcknowledged = vi.fn(async () => {});
    const nativeLease = {
      acquire: vi.fn(),
      current: vi.fn(async () => lease),
      renew: vi.fn(),
      activate: vi.fn(),
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
      notifyLockAcknowledged,
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      nativeLease,
      lockLocal: () => drain.promise,
      unlockLocal: () => {},
    });

    await coordinator.start();
    lease = {
      token: "remote-race-token",
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: false,
    };
    const requestPromise = requestHandler!({ token: "remote-race-token" });
    await vi.waitFor(() => expect(nativeLease.current).toHaveBeenCalledTimes(2));
    lease = null;
    drain.resolve();

    await requestPromise;
    expect(notifyLockAcknowledged).not.toHaveBeenCalled();
    await coordinator.stop();
  });
});
