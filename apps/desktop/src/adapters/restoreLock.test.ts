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

  it("retains the inactive native lease through release notification and revalidates after removal", async () => {
    const releaseNotification = deferred<void>();
    const events: string[] = [];
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = null;
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        lease = {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
        return lease;
      }),
      current: vi.fn(async () => lease),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: lease?.operationActive ?? false,
      })),
      activate: vi.fn(async () => {
        if (!lease) {
          throw new Error("lease missing");
        }
        lease.operationActive = true;
        return lease;
      }),
      finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
        if (!lease) {
          throw new Error("lease missing");
        }
        events.push("finish");
        lease.operationActive = false;
        lease.expiresAtMs = Date.now() + cleanupTtlMs;
        return lease;
      }),
      release: vi.fn(async () => {
        events.push("native-release");
        lease = null;
        return true;
      }),
    };
    const unlockLocal = vi.fn(() => {
      events.push("local-unlock");
    });
    const notifyLockReleased = vi.fn(async () => {
      events.push("notify-start");
      await releaseNotification.promise;
      events.push("notify-end");
    });
    let ownerApplyCount = 0;
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased,
      listenLockReleased: async () => () => {},
      applyStore: async () => {
        ownerApplyCount += 1;
        events.push(ownerApplyCount === 1 ? "owner-apply" : "owner-post-removal-apply");
      },
      nativeLease,
      lockLocal: async () => {},
      unlockLocal,
      bridgeTimeoutMs: 100,
      cleanupTimeoutMs: 100,
    });

    const run = coordinator.run(async () => "restored");
    await vi.waitFor(() => expect(notifyLockReleased).toHaveBeenCalledTimes(1));

    expect(lease).toEqual(expect.objectContaining({ operationActive: false }));
    expect(nativeLease.release).not.toHaveBeenCalled();
    expect(unlockLocal).not.toHaveBeenCalled();
    expect(events).toEqual(["finish", "owner-apply", "notify-start"]);

    releaseNotification.resolve();
    await expect(run).resolves.toBe("restored");
    expect(events).toEqual([
      "finish",
      "owner-apply",
      "notify-start",
      "notify-end",
      "native-release",
      "owner-post-removal-apply",
      "local-unlock",
    ]);
  });

  it("revalidates owner state when the inactive native lease disappears unexpectedly", async () => {
    let durableState = "restored-state";
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = null;
    const appliedStates: string[] = [];
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        lease = {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
        return lease;
      }),
      current: vi.fn(async () => lease),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: lease?.operationActive ?? false,
      })),
      activate: vi.fn(async () => {
        if (!lease) {
          throw new Error("lease missing");
        }
        lease.operationActive = true;
        return lease;
      }),
      finish: vi.fn(async () => {
        if (!lease) {
          throw new Error("lease missing");
        }
        lease.operationActive = false;
        return lease;
      }),
      release: vi.fn(async () => {
        lease = null;
        durableState = "newer-state-after-expiry";
        return false;
      }),
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
      applyStore: async () => {
        appliedStates.push(durableState);
      },
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });

    await expect(coordinator.run(async () => "restored")).resolves.toBe("restored");

    expect(appliedStates).toEqual([
      "restored-state",
      "newer-state-after-expiry",
    ]);
  });

  it("keeps a remote window locked on release until the native lease disappears", async () => {
    vi.useFakeTimers();
    try {
      const token = "retained-release-token";
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = {
        token,
        owner: "main",
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
      };
      let released:
        | ((payload: {
            token: string;
            finalApplyGeneration?: number;
          }) => void | Promise<void>)
        | null = null;
      const applyStore = vi.fn(async () => {});
      const unlockLocal = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async (handler) => {
          released = handler;
          return () => {};
        },
        applyStore,
        nativeLease: {
          acquire: vi.fn(),
          current: vi.fn(async () => lease),
          renew: vi.fn(),
          activate: vi.fn(),
          release: vi.fn(),
        },
        lockLocal: async () => {},
        unlockLocal,
        leasePollIntervalMs: 250,
      });

      await coordinator.start();
      lease.operationActive = false;
      await released!({ token, finalApplyGeneration: 5 });

      expect(applyStore).toHaveBeenCalledWith({ token, generation: 5 });
      expect(unlockLocal).not.toHaveBeenCalled();

      lease = null;
      await vi.advanceTimersByTimeAsync(250);

      expect(applyStore).toHaveBeenLastCalledWith({ token, generation: 6 });
      expect(unlockLocal).toHaveBeenCalledWith(token);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop cancels renewal for a never-settling callback and fences late writes", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-13T09:30:00.000Z") });
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => {
          if (lease && lease.expiresAtMs <= Date.now()) {
            lease = null;
          }
          return lease;
        }),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.expiresAtMs = Date.now() + ttlMs;
          return { ...lease, token, owner };
        }),
        activate: vi.fn(async () => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        finish: vi.fn(),
        release: vi.fn(),
      };
      const neverSettles = deferred<void>();
      let assertActive: (() => void) | null = null;
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
        unlockLocal: vi.fn(),
        leaseTtlMs: 40,
        leaseRenewIntervalMs: 10,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 30,
      });

      const run = coordinator.run(async (_token, guard) => {
        assertActive = guard;
        await neverSettles.promise;
      });
      void run.catch(() => {});
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(10);
      expect(nativeLease.renew).toHaveBeenCalledTimes(1);

      const stop = coordinator.stop();
      const renewCountAtStop = nativeLease.renew.mock.calls.length;
      await vi.advanceTimersByTimeAsync(31);
      await stop;
      await vi.advanceTimersByTimeAsync(100);

      expect(nativeLease.renew).toHaveBeenCalledTimes(renewCountAtStop);
      await expect(nativeLease.current()).resolves.toBeNull();
      expect(() => assertActive?.()).toThrow("종료");
    } finally {
      vi.useRealTimers();
    }
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
      let releaseHandler:
        | ((payload: { token: string }) => void | Promise<void>)
        | null = null;
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
      await flushMicrotasks(50);
      await releaseHandler!({ token: "token-a" });
      expect(unlocked).toHaveBeenCalledTimes(1);
      await releaseHandler!({ token: "token-b" });
      expect(unlocked).toHaveBeenCalledTimes(1);
      lease = null;
      await vi.advanceTimersByTimeAsync(50);
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
      await flushMicrotasks(50);

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
      let releaseHandler:
        | ((payload: { token: string }) => void | Promise<void>)
        | null = null;
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

      const release = releaseHandler!({ token: "request-b" });
      await flushMicrotasks();
      expect(currentCalls).toHaveLength(4);
      currentCalls[3]!.resolve(null);
      await release;
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
      await flushMicrotasks(100);
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

  it.each([
    "requested",
    "acknowledged",
    "released",
    "store-apply-requested",
    "store-apply-acknowledged",
  ])("bounds %s listener registration and cleans a late completion", async (target) => {
    vi.useFakeTimers();
    try {
      const lateRegistration = deferred<() => void>();
      const lateCleanup = vi.fn();
      const registration = (name: string) =>
        name === target
          ? lateRegistration.promise
          : Promise.resolve(() => {});
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => registration("requested"),
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => registration("acknowledged"),
        notifyLockReleased: async () => {},
        listenLockReleased: async () => registration("released"),
        notifyStoreApplyRequested: async () => {},
        listenStoreApplyRequested: async () => registration("store-apply-requested"),
        notifyStoreApplyAcknowledged: async () => {},
        listenStoreApplyAcknowledged: async () =>
          registration("store-apply-acknowledged"),
        lockLocal: async () => {},
        unlockLocal: vi.fn(),
        bridgeTimeoutMs: 20,
        cleanupTimeoutMs: 20,
      });

      const startResult = coordinator.start().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(20);

      const result = await startResult;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty(
          "message",
          expect.stringContaining("listener 등록")
        );
      }

      lateRegistration.resolve(lateCleanup);
      await flushMicrotasks();
      expect(lateCleanup).toHaveBeenCalledTimes(1);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stop while queued run waits for listener registration and cleans it late", async () => {
    vi.useFakeTimers();
    try {
      const lateRegistration = deferred<() => void>();
      const lateCleanup = vi.fn();
      const operation = vi.fn(async () => "should-not-run");
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => lateRegistration.promise,
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        lockLocal: async () => {},
        unlockLocal: vi.fn(),
        bridgeTimeoutMs: 100,
        cleanupTimeoutMs: 20,
      });

      const runResult = coordinator.run(operation).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await flushMicrotasks();
      const stopResult = coordinator.stop();
      await vi.advanceTimersByTimeAsync(20);
      await expect(stopResult).resolves.toBeUndefined();

      lateRegistration.resolve(lateCleanup);
      await flushMicrotasks();
      const result = await runResult;
      expect(result.ok).toBe(false);
      expect(operation).not.toHaveBeenCalled();
      expect(lateCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a queued run when listener registration never settles", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn(async () => "should-not-run");
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: () => new Promise<() => void>(() => {}),
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        lockLocal: async () => {},
        unlockLocal: vi.fn(),
        bridgeTimeoutMs: 20,
      });

      const runResult = coordinator.run(operation).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(20);

      const result = await runResult;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty(
          "message",
          expect.stringContaining("listener 등록이 시간 초과")
        );
      }
      expect(operation).not.toHaveBeenCalled();
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

  it("keeps the local lock until a failed release notification recovers", async () => {
    vi.useFakeTimers();
    try {
      let notificationAvailable = false;
      const unlocked = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {
          if (!notificationAvailable) {
            throw new Error("release broadcast failed");
          }
        },
        listenLockReleased: async () => () => {},
        lockLocal: async () => {},
        unlockLocal: unlocked,
        cleanupRetryIntervalMs: 10,
      });

      await coordinator.start();
      const token = await coordinator.acquire();
      await expect(coordinator.release(token)).rejects.toThrow(
        "release broadcast failed"
      );
      expect(unlocked).not.toHaveBeenCalled();

      notificationAvailable = true;
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks();
      expect(unlocked).toHaveBeenCalledWith(token);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers the owner after a permanent release notification failure and inactive lease expiry", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-13T12:00:00.000Z") });
    try {
      let durableState = "restored-state";
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const appliedStates: string[] = [];
      const protocolErrors: unknown[] = [];
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
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
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: lease?.operationActive ?? false,
        })),
        activate: vi.fn(async () => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = false;
          lease.expiresAtMs = Date.now() + cleanupTtlMs;
          return lease;
        }),
        release: vi.fn(async () => {
          throw new Error("native release must wait for notification");
        }),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {
          throw new Error("release notification permanently unavailable");
        },
        listenLockReleased: async () => () => {},
        applyStore: async () => {
          appliedStates.push(durableState);
        },
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        onProtocolError: (error) => protocolErrors.push(error),
        bridgeTimeoutMs: 5,
        timeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 1,
      });

      const run = coordinator.run(async () => "restored");
      await expect(run).rejects.toThrow("release notification permanently unavailable");
      expect(unlockLocal).not.toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();

      durableState = "newer-state-after-expiry";
      await vi.advanceTimersByTimeAsync(40);
      await flushMicrotasks();

      expect(nativeLease.current).toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(appliedStates).toEqual([
        "restored-state",
        "newer-state-after-expiry",
      ]);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      expect(
        protocolErrors.some((error) =>
          String(error).includes("release notification permanently unavailable")
        )
      ).toBe(true);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves primary failures with final apply or release event failures", async () => {
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
    const finalApplyCoordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      applyStore: async () => {
        throw new Error("final apply failed");
      },
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });

    await expect(
      finalApplyCoordinator.run(async () => {
        throw new AggregateError(
          [new Error("restore write failed"), new Error("rollback failed")],
          "restore and rollback failed: restore write failed / rollback failed"
        );
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("restore write failed")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("rollback failed")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("final apply failed")
      );
      return true;
    });
    await finalApplyCoordinator.stop();

    const releaseEventCoordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main"],
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {
        throw new Error("release event failed");
      },
      listenLockReleased: async () => () => {},
      applyStore: async () => {},
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });
    await expect(
      releaseEventCoordinator.run(async () => {
        throw new AggregateError(
          [new Error("restore write failed"), new Error("rollback failed")],
          "restore and rollback failed: restore write failed / rollback failed"
        );
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("restore write failed")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("rollback failed")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("release event failed")
      );
      return true;
    });
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
    await expect(runPromise).rejects.toThrow("종료");
    await stopPromise;

    expect(nativeLease.release).toHaveBeenCalledTimes(1);
    expect(unlockLocal).toHaveBeenCalledTimes(1);
    expect(cleanupRequested).toHaveBeenCalledTimes(1);
    expect(cleanupAcknowledged).toHaveBeenCalledTimes(1);
    expect(cleanupReleased).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung native acquire and restores the local barrier", async () => {
    vi.useFakeTimers();
    try {
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(() => new Promise<never>(() => {})),
        cancelAcquire: vi.fn(async () => {}),
        current: vi.fn(async () => null),
        renew: vi.fn(),
        activate: vi.fn(),
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
        unlockLocal,
        bridgeTimeoutMs: 20,
        cleanupTimeoutMs: 20,
      });

      const acquireResult = coordinator.acquire().then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );
      const outcome = Promise.race([
        acquireResult,
        new Promise<{ status: "still-pending" }>((resolve) => {
          setTimeout(() => resolve({ status: "still-pending" }), 25);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(25);

      const result = await outcome;
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.error).toHaveProperty(
          "message",
          "복원 잠금 lease 획득이 시간 초과되었습니다."
        );
      }
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a timed-out acquire and ignores its late resolution after authoritative unlock", async () => {
    vi.useFakeTimers();
    try {
      const acquireResponse = deferred<void>();
      const cancelledTokens = new Set<string>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let locallyLocked = false;
      const notifyLockRequested = vi.fn(async () => {});
      const applyStore = vi.fn(async () => {});
      const unlockLocal = vi.fn(() => {
        locallyLocked = false;
      });
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          const record = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          await acquireResponse.promise;
          if (!cancelledTokens.has(token)) {
            lease = record;
          }
          return record;
        }),
        cancelAcquire: vi.fn(async (token: string) => {
          cancelledTokens.add(token);
          if (lease?.token === token) {
            lease = null;
          }
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(async () => {
          lease = null;
          return true;
        }),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: vi.fn(async () => ["main"]),
        notifyLockRequested,
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        applyStore,
        nativeLease,
        lockLocal: async () => {
          locallyLocked = true;
        },
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      await coordinator.start();
      nativeLease.current.mockClear();
      const acquireResult = coordinator.acquire().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(50);
      const outcome = await acquireResult;

      expect(outcome.ok).toBe(false);
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(1);
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      expect(locallyLocked).toBe(false);
      expect(notifyLockRequested).not.toHaveBeenCalled();
      expect(nativeLease.renew).not.toHaveBeenCalled();

      acquireResponse.resolve();
      await flushMicrotasks(50);
      await expect(nativeLease.current()).resolves.toBeNull();
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(2);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(nativeLease.renew).not.toHaveBeenCalled();
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the local lock closed until timed-out acquire cancellation is confirmed", async () => {
    vi.useFakeTimers();
    try {
      const nativeAcquire = deferred<{
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      }>();
      const firstCancellation = deferred<void>();
      let locallyLocked = false;
      const applyStore = vi.fn(async () => {});
      const unlockLocal = vi.fn(() => {
        locallyLocked = false;
      });
      const nativeLease = {
        acquire: vi.fn(() => nativeAcquire.promise),
        cancelAcquire: vi
          .fn<(token: string) => Promise<void>>()
          .mockImplementationOnce(() => firstCancellation.promise)
          .mockImplementationOnce(async () => {}),
        current: vi.fn(async () => null),
        renew: vi.fn(),
        activate: vi.fn(),
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
        applyStore,
        nativeLease,
        lockLocal: async () => {
          locallyLocked = true;
        },
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      await coordinator.start();
      nativeLease.current.mockClear();
      const acquireResult = coordinator.acquire().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(50);
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(50);
      const outcome = await acquireResult;

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toHaveProperty(
          "message",
          expect.stringContaining("acquire 취소 확인이 시간 초과")
        );
      }
      expect(locallyLocked).toBe(true);
      expect(unlockLocal).not.toHaveBeenCalled();
      expect(applyStore).not.toHaveBeenCalled();
      expect(nativeLease.current).not.toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();

      firstCancellation.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks(50);

      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(2);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      expect(locallyLocked).toBe(false);
      expect(nativeLease.current).not.toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops bounded after uncertain cancellation and lets the native request deadline fence a late acquire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    try {
      const reachesNativeMutex = deferred<void>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let capturedDeadlineMs: number | undefined;
      let capturedToken = "";
      const notifyLockRequested = vi.fn(async () => {});
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(
          async (
            token: string,
            owner: string,
            ttlMs: number,
            requestDeadlineMs?: number
          ) => {
            capturedToken = token;
            capturedDeadlineMs = requestDeadlineMs;
            await reachesNativeMutex.promise;
            if (
              requestDeadlineMs === undefined ||
              Date.now() >= requestDeadlineMs
            ) {
              throw new Error("native acquire request deadline passed");
            }
            lease = {
              token,
              owner,
              expiresAtMs: Date.now() + ttlMs,
              operationActive: false,
            };
            return lease;
          }
        ),
        cancelAcquire: vi.fn(async () => {
          throw new Error("cancel bridge unavailable");
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(async () => true),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested,
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      await coordinator.start();
      nativeLease.current.mockClear();
      const acquireResult = coordinator.acquire().catch((error: unknown) => error);
      const requestStartedAt = Date.now();
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(50);
      await acquireResult;

      expect(capturedDeadlineMs).toBe(requestStartedAt + 5);
      expect(capturedToken).toMatch(
        /^restore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(1);

      const stopOutcome = Promise.race([
        coordinator.stop().then(() => "stopped" as const),
        new Promise<"still-pending">((resolve) => {
          setTimeout(() => resolve("still-pending"), 5);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(5);
      await expect(stopOutcome).resolves.toBe("stopped");
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(70_000);
      reachesNativeMutex.resolve();
      await flushMicrotasks(50);

      await expect(nativeLease.current()).resolves.toBeNull();
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(3);
      expect(nativeLease.renew).not.toHaveBeenCalled();
      expect(notifyLockRequested).not.toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses cancel-first cleanup when stop starts before native acquire settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    try {
      const reachesNativeMutex = deferred<void>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(
          async (
            token: string,
            owner: string,
            ttlMs: number,
            requestDeadlineMs?: number
          ) => {
            await reachesNativeMutex.promise;
            if (
              requestDeadlineMs === undefined ||
              Date.now() >= requestDeadlineMs
            ) {
              throw new Error("native acquire request deadline passed");
            }
            lease = {
              token,
              owner,
              expiresAtMs: Date.now() + ttlMs,
              operationActive: false,
            };
            return lease;
          }
        ),
        cancelAcquire: vi.fn(async () => {
          throw new Error("cancel bridge unavailable");
        }),
        current: vi.fn(async () => null),
        renew: vi.fn(),
        activate: vi.fn(),
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
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
      });

      await coordinator.start();
      const acquireResult = coordinator.acquire().catch((error: unknown) => error);
      await flushMicrotasks(20);
      await coordinator.stop();

      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(1);
      expect(nativeLease.current).toHaveBeenCalledTimes(1);
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10);
      reachesNativeMutex.resolve();
      await flushMicrotasks(50);
      await acquireResult;
      expect(lease).toBeNull();
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(2);
      expect(nativeLease.renew).not.toHaveBeenCalled();
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an unconfirmed acquire created before its deadline expire by native TTL after stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    try {
      const acquireResponse = deferred<void>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(
          async (
            token: string,
            owner: string,
            ttlMs: number,
            _requestDeadlineMs?: number
          ) => {
            const acquired = {
              token,
              owner,
              expiresAtMs: Date.now() + ttlMs,
              operationActive: false,
            };
            lease = acquired;
            await acquireResponse.promise;
            return acquired;
          }
        ),
        cancelAcquire: vi.fn(async () => {
          throw new Error("cancel bridge unavailable");
        }),
        current: vi.fn(async () => {
          if (lease && lease.expiresAtMs <= Date.now()) {
            lease = null;
          }
          return lease;
        }),
        renew: vi.fn(),
        activate: vi.fn(),
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
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
        leaseTtlMs: 20,
        leaseRenewIntervalMs: 2,
      });

      await coordinator.start();
      const acquireResult = coordinator.acquire().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(50);
      await acquireResult;
      expect(lease).not.toBeNull();

      await coordinator.stop();
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(2);
      expect(nativeLease.renew).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(14);
      await expect(nativeLease.current()).resolves.not.toBeNull();
      await vi.advanceTimersByTimeAsync(2);
      await expect(nativeLease.current()).resolves.toBeNull();

      acquireResponse.resolve();
      await flushMicrotasks(50);
      expect(nativeLease.cancelAcquire).toHaveBeenCalledTimes(3);
      expect(nativeLease.renew).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung native window lookup after acquiring the local barrier", async () => {
    vi.useFakeTimers();
    try {
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(async () => true),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: () => new Promise<string[]>(() => {}),
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal,
        bridgeTimeoutMs: 20,
        cleanupTimeoutMs: 20,
      });

      const result = coordinator.acquire().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(25);

      await expect(result).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({
          message: "활성 메모 창 조회가 시간 초과되었습니다.",
        }),
      });
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies authoritative owner state after native cleanup when acquire setup fails without an event", async () => {
    const events: string[] = [];
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = null;
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        events.push("native-acquire");
        lease = {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
        return lease;
      }),
      current: vi.fn(async () => lease),
      renew: vi.fn(),
      activate: vi.fn(),
      finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
        if (!lease) {
          throw new Error("lease missing");
        }
        events.push("native-finish");
        lease.expiresAtMs = Date.now() + cleanupTtlMs;
        return lease;
      }),
      release: vi.fn(async () => {
        events.push("native-release");
        lease = null;
        return true;
      }),
    };
    const applyStore = vi.fn(async () => {
      events.push("owner-apply");
    });
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => {
        events.push("list-live");
        throw new Error("window lookup failed");
      },
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {
        events.push("notify-release");
      },
      listenLockReleased: async () => () => {},
      applyStore,
      nativeLease,
      lockLocal: async () => {
        events.push("local-lock");
      },
      unlockLocal: () => {
        events.push("local-unlock");
      },
    });

    await expect(coordinator.acquire()).rejects.toThrow("window lookup failed");

    expect(applyStore).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "local-lock",
      "native-acquire",
      "list-live",
      "native-finish",
      "notify-release",
      "native-release",
      "owner-apply",
      "local-unlock",
    ]);
    await coordinator.stop();
  });

  it("keeps an acquire-failure lock closed until a timed-out owner apply recovers", async () => {
    vi.useFakeTimers();
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let locallyLocked = false;
      const firstApply = deferred<void>();
      const applyStore = vi.fn(async (_payload: { generation: number }) => {
        if (applyStore.mock.calls.length === 1) {
          await firstApply.promise;
        }
      });
      const unlockLocal = vi.fn(() => {
        locallyLocked = false;
      });
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.expiresAtMs = Date.now() + cleanupTtlMs;
          return lease;
        }),
        release: vi.fn(async () => {
          lease = null;
          return true;
        }),
      };
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => {
          throw new Error("window lookup failed");
        },
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        applyStore,
        nativeLease,
        lockLocal: async () => {
          locallyLocked = true;
        },
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      const acquireResult = coordinator.acquire().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await flushMicrotasks(50);
      await vi.advanceTimersByTimeAsync(5);
      const outcome = await acquireResult;

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toHaveProperty(
          "message",
          expect.stringContaining("window lookup failed")
        );
        expect(outcome.error).toHaveProperty(
          "message",
          expect.stringContaining("native lease 제거 후 최종 메모 상태 적용")
        );
      }
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(locallyLocked).toBe(true);
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks(50);

      expect(applyStore).toHaveBeenCalledTimes(2);
      expect(applyStore.mock.calls[0]?.[0].generation).not.toBe(
        applyStore.mock.calls[1]?.[0].generation
      );
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      expect(locallyLocked).toBe(false);
      firstApply.resolve();
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregates acquire failure with release notification failure after native absence", async () => {
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: false,
      })),
      current: vi.fn(async () => null),
      renew: vi.fn(),
      activate: vi.fn(),
      release: vi.fn(async () => {
        throw new Error("inactive lease release failed");
      }),
    };
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => {
        throw new Error("window lookup failed");
      },
      notifyLockRequested: async () => {},
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {
        throw new Error("acquire release event failed");
      },
      listenLockReleased: async () => () => {},
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });

    await expect(coordinator.acquire()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("window lookup failed")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("acquire release event failed")
      );
      return true;
    });
    expect(nativeLease.current).toHaveBeenCalled();
    expect(nativeLease.release).not.toHaveBeenCalled();
  });

  it("bounds a hung native activation before the restore callback starts", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn(async () => "restored");
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(),
        activate: vi.fn(() => new Promise<never>(() => {})),
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
        unlockLocal,
        bridgeTimeoutMs: 20,
        cleanupTimeoutMs: 20,
      });

      const runResult = coordinator.run(operation).then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );
      const outcome = Promise.race([
        runResult,
        new Promise<{ status: "still-pending" }>((resolve) => {
          setTimeout(() => resolve({ status: "still-pending" }), 45);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(45);

      const result = await outcome;
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.error).toHaveProperty(
          "message",
          "복원 잠금 operation lease 활성화가 시간 초과되었습니다."
        );
      }
      expect(operation).not.toHaveBeenCalled();
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stop while an active callback remains unsettled", async () => {
    vi.useFakeTimers();
    try {
      const operation = deferred<void>();
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        })),
        current: vi.fn(async () => null),
        renew: vi.fn(),
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
        unlockLocal,
        cleanupTimeoutMs: 20,
      });

      void coordinator.run(() => operation.promise).catch(() => {});
      await flushMicrotasks(50);
      expect(nativeLease.activate).toHaveBeenCalledTimes(1);

      const stopOutcome = Promise.race([
        coordinator.stop().then(() => "stopped" as const),
        new Promise<"still-pending">((resolve) => {
          setTimeout(() => resolve("still-pending"), 25);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(25);

      await expect(stopOutcome).resolves.toBe("stopped");
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();

      operation.resolve();
      await flushMicrotasks(50);
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds hung native release without unlocking an uncertain active lease", async () => {
    vi.useFakeTimers();
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
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
        finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = false;
          lease.expiresAtMs = Date.now() + cleanupTtlMs;
          return lease;
        }),
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
        bridgeTimeoutMs: 25,
        cleanupTimeoutMs: 25,
        cleanupRetryIntervalMs: 1000,
      });

      const token = await coordinator.acquire();
      const releasePromise = coordinator.release(token);
      const outcome = Promise.race([
        releasePromise.then(() => "resolved" as const, () => "rejected" as const),
        new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 60)),
      ]);
      await vi.advanceTimersByTimeAsync(60);

      await expect(outcome).resolves.toBe("rejected");
      expect(nativeLease.finish).toHaveBeenCalledWith(token, "main", expect.any(Number));
      expect(unlockLocal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports renewal failure only after the deferred callback settles", async () => {
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
      let publicRunSettled = false;
      void handledRun.then(() => {
        publicRunSettled = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks();
      expect(publicRunSettled).toBe(false);
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(unlockLocal).not.toHaveBeenCalled();

      operation.resolve();
      const runResult = await handledRun;
      expect(runResult.ok).toBe(false);
      if (!runResult.ok) {
        expect(runResult.error).toHaveProperty(
          "message",
          expect.stringContaining("복원 잠금 lease 소유권을 잃었습니다: renewal failed")
        );
      }
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the local barrier until failed native cleanup recovers", async () => {
    vi.useFakeTimers();
    try {
      type Lease = {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      };
      let lease: Lease | null = null;
      let releaseAvailable = false;
      const unlockLocal = vi.fn();
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: true,
        })),
        activate: vi.fn(async () => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = false;
          lease.expiresAtMs = Date.now() + cleanupTtlMs;
          return lease;
        }),
        release: vi.fn(async () => {
          if (!releaseAvailable) {
            throw new Error("bridge unavailable");
          }
          lease = null;
          return true;
        }),
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
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      const result = coordinator.run(async () => "restored").then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(5);

      const failedCleanup = await result;
      expect(failedCleanup.ok).toBe(false);
      if (!failedCleanup.ok) {
        expect(failedCleanup.error).toHaveProperty(
          "message",
          expect.stringContaining(
            "복원 작업은 완료되었지만 native lease 정리가 보류되었습니다."
          )
        );
        expect(failedCleanup.error).toHaveProperty(
          "message",
          expect.stringContaining("bridge unavailable")
        );
      }
      expect(nativeLease.finish).toHaveBeenCalledTimes(1);
      expect(lease).toEqual(expect.objectContaining({ operationActive: false }));
      expect(unlockLocal).not.toHaveBeenCalled();

      releaseAvailable = true;
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks(50);

      expect(nativeLease.release).toHaveBeenCalledTimes(2);
      expect(lease).toBeNull();
      expect(unlockLocal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the local barrier closed until a failed final apply recovers", async () => {
    vi.useFakeTimers();
    try {
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let applyAvailable = false;
      let locallyLocked = false;
      const hungFinalApply = deferred<void>();
      const applyStore = vi.fn(async (payload: { generation: number }) => {
        if (payload.generation === 1) {
          await hungFinalApply.promise;
          return;
        }
        if (!applyAvailable) {
          throw new Error("final reload bridge unavailable");
        }
      });
      const unlockLocal = vi.fn(() => {
        locallyLocked = false;
      });
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: true,
        })),
        activate: vi.fn(async () => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = false;
          lease.expiresAtMs = Date.now() + cleanupTtlMs;
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
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        applyStore,
        nativeLease,
        lockLocal: async () => {
          locallyLocked = true;
        },
        unlockLocal,
        bridgeTimeoutMs: 5,
        cleanupTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });

      const handledRun = coordinator.run(async () => "restored").then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(5);
      const outcome = await handledRun;

      expect(outcome.ok).toBe(false);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(nativeLease.release).not.toHaveBeenCalled();
      expect(lease).toEqual(expect.objectContaining({ operationActive: false }));
      expect(locallyLocked).toBe(true);
      expect(unlockLocal).not.toHaveBeenCalled();

      applyAvailable = true;
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks(50);

      expect(applyStore).toHaveBeenCalledTimes(3);
      expect(applyStore.mock.calls[0]?.[0].generation).not.toBe(
        applyStore.mock.calls[1]?.[0].generation
      );
      expect(applyStore.mock.calls[1]?.[0].generation).not.toBe(
        applyStore.mock.calls[2]?.[0].generation
      );
      expect(nativeLease.release).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      expect(locallyLocked).toBe(false);
      hungFinalApply.resolve();
      await flushMicrotasks();
      expect(unlockLocal).toHaveBeenCalledTimes(1);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient renewal and completes while the callback stays active", async () => {
    vi.useFakeTimers();
    try {
      const operation = deferred<string>();
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      let renewalCount = 0;
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          renewalCount += 1;
          if (renewalCount === 1) {
            throw new Error("transient renewal timeout");
          }
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.expiresAtMs = Date.now() + ttlMs;
          return { ...lease, token, owner };
        }),
        activate: vi.fn(async () => {
          if (!lease) {
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
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal: async () => {},
        unlockLocal: vi.fn(),
        leaseTtlMs: 40,
        leaseRenewIntervalMs: 10,
        bridgeTimeoutMs: 25,
      });

      const run = coordinator.run(() => operation.promise);
      await flushMicrotasks(50);
      expect(nativeLease.acquire).toHaveBeenCalledWith(
        expect.any(String),
        "main",
        70,
        expect.any(Number)
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(nativeLease.renew).toHaveBeenCalledTimes(1);
      expect(lease).toEqual(expect.objectContaining({ operationActive: true }));

      await vi.advanceTimersByTimeAsync(10);
      expect(nativeLease.renew).toHaveBeenCalledTimes(2);
      expect(
        (lease as { expiresAtMs: number } | null)?.expiresAtMs
      ).toBeGreaterThan(Date.now());

      operation.resolve("restored");
      await expect(run).resolves.toBe("restored");
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences a later callback mutation after native ownership is confirmed lost", async () => {
    vi.useFakeTimers();
    try {
      const continueCallback = deferred<void>();
      const laterMutation = vi.fn();
      let locallyLocked = false;
      let applyAvailable = false;
      let renewalCount = 0;
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = null;
      const nativeLease = {
        acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
          lease = {
            token,
            owner,
            expiresAtMs: Date.now() + ttlMs,
            operationActive: false,
          };
          return lease;
        }),
        current: vi.fn(async () => lease),
        renew: vi.fn(async () => {
          renewalCount += 1;
          if (renewalCount === 1) {
            throw new Error("transient renewal timeout");
          }
          lease = null;
          throw new Error("restore token no longer exists");
        }),
        activate: vi.fn(async () => {
          if (!lease) {
            throw new Error("lease missing");
          }
          lease.operationActive = true;
          return lease;
        }),
        release: vi.fn(async () => false),
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
        applyStore: async () => {
          if (!applyAvailable) {
            throw new Error("authoritative reload unavailable");
          }
        },
        nativeLease,
        lockLocal: async () => {
          locallyLocked = true;
        },
        unlockLocal: () => {
          locallyLocked = false;
        },
        leaseRenewIntervalMs: 10,
        bridgeTimeoutMs: 5,
        cleanupRetryIntervalMs: 10,
      });
      const run = coordinator.run(async (_token, assertActive) => {
        await continueCallback.promise;
        assertActive();
        laterMutation();
        return "mutated";
      });
      const handled = run.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(nativeLease.renew).toHaveBeenCalledTimes(2);
      continueCallback.resolve();
      const result = await handled;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toHaveProperty(
          "message",
          expect.stringContaining("소유권을 잃었습니다")
        );
      }
      expect(laterMutation).not.toHaveBeenCalled();
      expect(locallyLocked).toBe(true);

      applyAvailable = true;
      await vi.advanceTimersByTimeAsync(10);
      await flushMicrotasks(50);
      expect(locallyLocked).toBe(false);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the caller pending after renewal failure while stale native lease recovery unlocks remote", async () => {
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
          if (lease && lease.expiresAtMs <= Date.now()) {
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
        bridgeTimeoutMs: 5,
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
      await flushMicrotasks(100);
      expect(mainNativeLease.activate).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      let publicRunSettled = false;
      void handledRun.then(() => {
        publicRunSettled = true;
      });
      await flushMicrotasks();
      expect(publicRunSettled).toBe(false);
      expect(lease).toEqual(expect.objectContaining({ operationActive: true }));

      await vi.advanceTimersByTimeAsync(100);
      expect(lease).toBeNull();
      expect(remoteUnlock).toHaveBeenCalledWith(expect.any(String));
      expect(publicRunSettled).toBe(false);

      operation.resolve();
      const runResult = await handledRun;
      expect(runResult.ok).toBe(false);
      await vi.waitFor(() => expect(mainNativeLease.release).toHaveBeenCalledTimes(1));
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

  it("keeps a renewed startup active lease locked and recovers after owner heartbeat expiry", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-12T21:00:00.000Z") });
    try {
      type Lease = {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      };
      let lease: Lease | null = {
        token: "ownerless-active-token",
        owner: "closed-window",
        expiresAtMs: Date.now() + 100,
        operationActive: true,
      };
      const nativeLease = {
        acquire: vi.fn(),
        current: vi.fn(async () => {
          if (lease && lease.expiresAtMs <= Date.now()) {
            lease = null;
          }
          return lease;
        }),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(),
      };
      const lockLocal = vi.fn(async () => {});
      const unlockLocal = vi.fn();
      const notifyLockAcknowledged = vi.fn(async () => {});
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "main",
        listLiveWindowLabels: async () => ["main"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged,
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        nativeLease,
        lockLocal,
        unlockLocal,
        leasePollIntervalMs: 20,
      });

      await coordinator.start();
      expect(lockLocal).toHaveBeenCalledWith("ownerless-active-token");
      expect(notifyLockAcknowledged).toHaveBeenCalledWith(
        expect.objectContaining({ token: "ownerless-active-token", ok: true })
      );

      await vi.advanceTimersByTimeAsync(80);
      lease = {
        token: "ownerless-active-token",
        owner: "closed-window",
        expiresAtMs: Date.now() + 100,
        operationActive: true,
      };
      await vi.advanceTimersByTimeAsync(90);
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(40);
      expect(unlockLocal).toHaveBeenCalledWith("ownerless-active-token");
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

      renewals[1]!.pending.resolve({
        token: renewals[1]!.token,
        owner: renewals[1]!.owner,
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
      });
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(10);
      expect(renewals).toHaveLength(3);
      renewals[2]!.pending.resolve({
        token: renewals[2]!.token,
        owner: renewals[2]!.owner,
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

  it("waits for remote memo-store application acknowledgement before release", async () => {
    type Lease = {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    };
    type Acknowledgement = {
      token: string;
      windowLabel: string;
      ok: boolean;
      error?: string;
    };
    type StoreAcknowledgement = Acknowledgement & {
      generation: number;
    };
    let lease: Lease | null = null;
    let mainLockAcknowledged: ((payload: Acknowledgement) => void) | null = null;
    let mainStoreApplied: ((payload: StoreAcknowledgement) => void) | null = null;
    let remoteLockRequested: ((payload: { token: string }) => void | Promise<void>) | null = null;
    let remoteStoreApplyRequested:
      | ((payload: { token: string; generation: number }) => void | Promise<void>)
      | null = null;
    let remoteReleased:
      | ((payload: { token: string; finalApplyGeneration?: number }) => void | Promise<void>)
      | null = null;
    const remoteApply = deferred<void>();
    const applyRemoteStore = vi.fn(() => remoteApply.promise);
    const remoteUnlock = vi.fn();
    const nativeLease = {
      acquire: vi.fn(async (token: string, owner: string, ttlMs: number) => {
        lease = {
          token,
          owner,
          expiresAtMs: Date.now() + ttlMs,
          operationActive: false,
        };
        return lease;
      }),
      current: vi.fn(async () => lease),
      renew: vi.fn(async (token: string, owner: string, ttlMs: number) => ({
        token,
        owner,
        expiresAtMs: Date.now() + ttlMs,
        operationActive: lease?.operationActive ?? false,
      })),
      activate: vi.fn(async () => {
        if (!lease) {
          throw new Error("lease missing");
        }
        lease.operationActive = true;
        return lease;
      }),
      finish: vi.fn(async (_token: string, _owner: string, cleanupTtlMs: number) => {
        if (!lease) {
          throw new Error("lease missing");
        }
        lease.operationActive = false;
        lease.expiresAtMs = Date.now() + cleanupTtlMs;
        return lease;
      }),
      release: vi.fn(async () => {
        lease = null;
        return true;
      }),
    };

    const main = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "main",
      listLiveWindowLabels: async () => ["main", "memo-1"],
      notifyLockRequested: async (token) => {
        await remoteLockRequested?.({ token });
      },
      listenLockRequested: async () => () => {},
      notifyLockAcknowledged: async (payload) => {
        mainLockAcknowledged?.(payload);
      },
      listenLockAcknowledged: async (handler) => {
        mainLockAcknowledged = handler;
        return () => {};
      },
      notifyLockReleased: async (token, finalApplyGeneration) => {
        await remoteReleased?.({ token, finalApplyGeneration });
      },
      listenLockReleased: async () => () => {},
      notifyStoreApplyRequested: async (payload) => {
        await remoteStoreApplyRequested?.(payload);
      },
      listenStoreApplyRequested: async () => () => {},
      notifyStoreApplyAcknowledged: async (payload) => {
        mainStoreApplied?.(payload);
      },
      listenStoreApplyAcknowledged: async (handler) => {
        mainStoreApplied = handler;
        return () => {};
      },
      applyStore: async () => {},
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
      timeoutMs: 100,
    });
    const remote = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "memo-1",
      listLiveWindowLabels: async () => ["memo-1"],
      notifyLockRequested: async () => {},
      listenLockRequested: async (handler) => {
        remoteLockRequested = handler;
        return () => {};
      },
      notifyLockAcknowledged: async (payload) => {
        mainLockAcknowledged?.(payload);
      },
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async (handler) => {
        remoteReleased = handler;
        return () => {};
      },
      notifyStoreApplyRequested: async () => {},
      listenStoreApplyRequested: async (handler) => {
        remoteStoreApplyRequested = handler;
        return () => {};
      },
      notifyStoreApplyAcknowledged: async (payload) => {
        mainStoreApplied?.(payload);
      },
      listenStoreApplyAcknowledged: async () => () => {},
      applyStore: applyRemoteStore,
      nativeLease,
      lockLocal: async () => {},
      unlockLocal: remoteUnlock,
      timeoutMs: 100,
    });

    await remote.start();
    await main.start();
    let runSettled = false;
    let restoreToken = "";
    const runPromise = main.run(async (token) => {
      restoreToken = token;
      await main.synchronize(token);
      return "restored";
    });
    void runPromise.finally(() => {
      runSettled = true;
    });

    await vi.waitFor(() => expect(applyRemoteStore).toHaveBeenCalledTimes(1));
    expect(runSettled).toBe(false);
    expect(nativeLease.release).not.toHaveBeenCalled();
    expect(remoteUnlock).not.toHaveBeenCalled();

    remoteApply.resolve();
    await expect(runPromise).resolves.toBe("restored");
    expect(nativeLease.release).toHaveBeenCalledTimes(1);
    expect(remoteUnlock).not.toHaveBeenCalled();
    await remoteReleased!({ token: restoreToken });
    expect(remoteUnlock).toHaveBeenCalledTimes(1);

    await main.stop();
    await remote.stop();
  });

  it("reapplies the store when rollback uses the same restore token", async () => {
    const token = "restore-with-rollback";
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = {
      token,
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: true,
    };
    let lockRequested:
      | ((payload: { token: string }) => void | Promise<void>)
      | null = null;
    let storeApplyRequested:
      | ((payload: { token: string; generation: number }) => void | Promise<void>)
      | null = null;
    const applyStore = vi.fn(async () => {});
    const notifyStoreApplyAcknowledged = vi.fn(async () => {});
    const remote = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "memo-1",
      listLiveWindowLabels: async () => ["memo-1"],
      notifyLockRequested: async () => {},
      listenLockRequested: async (handler) => {
        lockRequested = handler;
        return () => {};
      },
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      notifyStoreApplyRequested: async () => {},
      listenStoreApplyRequested: async (handler) => {
        storeApplyRequested = handler;
        return () => {};
      },
      notifyStoreApplyAcknowledged,
      listenStoreApplyAcknowledged: async () => () => {},
      applyStore,
      nativeLease: {
        acquire: vi.fn(),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(),
      },
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });

    await remote.start();
    lockRequested!({ token });
    await flushMicrotasks();
    await storeApplyRequested!({ token, generation: 1 });
    await storeApplyRequested!({ token, generation: 2 });

    expect(applyStore).toHaveBeenCalledTimes(2);
    expect(notifyStoreApplyAcknowledged).toHaveBeenCalledTimes(2);
    await remote.stop();
  });

  it("ignores late completion and ACK from an older store generation", async () => {
    const token = "generation-race-token";
    const lease = {
      token,
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: true,
    };
    const firstApply = deferred<void>();
    let lockRequested:
      | ((payload: { token: string }) => void | Promise<void>)
      | null = null;
    let storeApplyRequested:
      | ((payload: { token: string; generation: number }) => void | Promise<void>)
      | null = null;
    const acknowledgements: Array<{ generation: number; ok: boolean }> = [];
    const applyStore = vi.fn(async (payload: { generation: number }) => {
      if (payload.generation === 1) {
        await firstApply.promise;
      }
    });
    const remote = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "memo-1",
      listLiveWindowLabels: async () => ["memo-1"],
      notifyLockRequested: async () => {},
      listenLockRequested: async (handler) => {
        lockRequested = handler;
        return () => {};
      },
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async () => () => {},
      notifyStoreApplyRequested: async () => {},
      listenStoreApplyRequested: async (handler) => {
        storeApplyRequested = handler;
        return () => {};
      },
      notifyStoreApplyAcknowledged: async (payload) => {
        acknowledgements.push({ generation: payload.generation, ok: payload.ok });
      },
      listenStoreApplyAcknowledged: async () => () => {},
      applyStore,
      nativeLease: {
        acquire: vi.fn(),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(),
      },
      lockLocal: async () => {},
      unlockLocal: vi.fn(),
    });

    await remote.start();
    lockRequested!({ token });
    await flushMicrotasks();
    const oldApply = storeApplyRequested!({ token, generation: 1 });
    await flushMicrotasks();
    await storeApplyRequested!({ token, generation: 2 });
    firstApply.resolve();
    await oldApply;

    expect(applyStore).toHaveBeenCalledWith({ token, generation: 2 });
    expect(acknowledgements).toEqual([{ generation: 2, ok: true }]);
    await remote.stop();
  });

  it("performs a final authoritative reload before unlock when rollback request is lost", async () => {
    const token = "lost-rollback-request";
    let lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null = {
      token,
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: true,
    };
    const finalApply = deferred<void>();
    let lockRequested:
      | ((payload: { token: string }) => void | Promise<void>)
      | null = null;
    let storeApplyRequested:
      | ((payload: { token: string; generation: number }) => void | Promise<void>)
      | null = null;
    let released:
      | ((payload: { token: string; finalApplyGeneration?: number }) => void | Promise<void>)
      | null = null;
    const unlockLocal = vi.fn();
    const applyStore = vi.fn(async (payload: { generation: number }) => {
      if (payload.generation === 3) {
        await finalApply.promise;
      }
    });
    const remote = createRestoreLockCoordinator({
      getCurrentWindowLabel: () => "memo-1",
      listLiveWindowLabels: async () => ["memo-1"],
      notifyLockRequested: async () => {},
      listenLockRequested: async (handler) => {
        lockRequested = handler;
        return () => {};
      },
      notifyLockAcknowledged: async () => {},
      listenLockAcknowledged: async () => () => {},
      notifyLockReleased: async () => {},
      listenLockReleased: async (handler) => {
        released = handler;
        return () => {};
      },
      notifyStoreApplyRequested: async () => {},
      listenStoreApplyRequested: async (handler) => {
        storeApplyRequested = handler;
        return () => {};
      },
      notifyStoreApplyAcknowledged: async () => {
        // Simulate ACK loss. The owner will roll back, but its second request is also lost.
      },
      listenStoreApplyAcknowledged: async () => () => {},
      applyStore,
      nativeLease: {
        acquire: vi.fn(),
        current: vi.fn(async () => lease),
        renew: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(),
      },
      lockLocal: async () => {},
      unlockLocal,
    });

    await remote.start();
    lockRequested!({ token });
    await flushMicrotasks();
    await storeApplyRequested!({ token, generation: 1 });
    const releasePromise = released!({ token, finalApplyGeneration: 3 });
    await flushMicrotasks();

    expect(applyStore).not.toHaveBeenCalledWith({ token, generation: 2 });
    expect(applyStore).toHaveBeenCalledWith({ token, generation: 3 });
    expect(unlockLocal).not.toHaveBeenCalled();

    finalApply.resolve();
    await releasePromise;
    expect(unlockLocal).not.toHaveBeenCalled();
    lease = null;
    await released!({ token, finalApplyGeneration: 3 });
    expect(applyStore).toHaveBeenCalledWith({ token, generation: 4 });
    expect(unlockLocal).toHaveBeenCalledWith(token);
    await remote.stop();
  });

  it("coalesces final apply while a slower reload spans multiple lease polls", async () => {
    vi.useFakeTimers();
    try {
      const token = "coalesced-final-poll";
      let lease: {
        token: string;
        owner: string;
        expiresAtMs: number;
        operationActive: boolean;
      } | null = {
        token,
        owner: "closed-owner",
        expiresAtMs: Date.now() + 10_000,
        operationActive: true,
      };
      const applyStore = vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 300))
      );
      const unlockLocal = vi.fn();
      const coordinator = createRestoreLockCoordinator({
        getCurrentWindowLabel: () => "memo-1",
        listLiveWindowLabels: async () => ["memo-1"],
        notifyLockRequested: async () => {},
        listenLockRequested: async () => () => {},
        notifyLockAcknowledged: async () => {},
        listenLockAcknowledged: async () => () => {},
        notifyLockReleased: async () => {},
        listenLockReleased: async () => () => {},
        applyStore,
        nativeLease: {
          acquire: vi.fn(),
          current: vi.fn(async () => lease),
          renew: vi.fn(),
          activate: vi.fn(),
          release: vi.fn(),
        },
        lockLocal: async () => {},
        unlockLocal,
        leasePollIntervalMs: 250,
        bridgeTimeoutMs: 1000,
      });

      await coordinator.start();
      lease = null;
      await vi.advanceTimersByTimeAsync(250);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks(50);
      expect(applyStore).toHaveBeenCalledTimes(1);
      expect(unlockLocal).toHaveBeenCalledWith(token);
      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
