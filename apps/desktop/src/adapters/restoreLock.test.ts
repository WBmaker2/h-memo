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
});
