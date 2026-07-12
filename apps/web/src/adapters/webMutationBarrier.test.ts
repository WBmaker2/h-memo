import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  LocalStorageMemoRepository,
  WEB_MEMO_STORAGE_KEY,
} from "./localStorageMemoRepository";
import { WebMutationBarrier } from "./webMutationBarrier";

const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_STORAGE_KEY = "h-memo:web-restore-epoch-v1";
const FALLBACK_LOCK_PREFIX = "h-memo:web-fallback-lock-v1:";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fallbackKeys() {
  return Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index)
  ).filter((key): key is string => key?.startsWith(FALLBACK_LOCK_PREFIX) === true);
}

describe("WebMutationBarrier", () => {
  let originalLocksDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    Reflect.deleteProperty(navigator, "locks");
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, "locks", originalLocksDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  });

  it("uses a durable fallback lock to serialize simultaneous independent instances", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-12T20:00:00.000Z") });
    const first = new WebMutationBarrier({
      ownerId: "tab-a",
      fallbackLockTtlMs: 100,
      fallbackPollMs: 10,
    });
    const second = new WebMutationBarrier({
      ownerId: "tab-b",
      fallbackLockTtlMs: 100,
      fallbackPollMs: 10,
    });
    const releaseFirst = deferred();
    let activeCount = 0;
    let maxActiveCount = 0;

    const firstRun = first.runMutation(0, async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await releaseFirst.promise;
      activeCount -= 1;
      return "first";
    });
    await Promise.resolve();
    const secondRun = second.runMutation(0, async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      activeCount -= 1;
      return "second";
    });
    await Promise.resolve();

    expect(activeCount).toBe(1);
    expect(fallbackKeys().length).toBeGreaterThanOrEqual(2);

    releaseFirst.resolve();
    await vi.advanceTimersByTimeAsync(20);

    await expect(firstRun).resolves.toBe("first");
    await expect(secondRun).resolves.toBe("second");
    expect(maxActiveCount).toBe(1);
    expect(fallbackKeys()).toEqual([]);
  });

  it("does not let two independent fallback barriers enter restore together", async () => {
    const first = new WebMutationBarrier({ ownerId: "restore-tab-a" });
    const second = new WebMutationBarrier({ ownerId: "restore-tab-b" });
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let activeRestores = 0;
    let maxActiveRestores = 0;

    const firstRun = first.runRestore(async () => {
      activeRestores += 1;
      maxActiveRestores = Math.max(maxActiveRestores, activeRestores);
      firstEntered.resolve();
      await releaseFirst.promise;
      activeRestores -= 1;
      return "first";
    });
    await firstEntered.promise;

    const secondRun = second.runRestore(async () => {
      activeRestores += 1;
      maxActiveRestores = Math.max(maxActiveRestores, activeRestores);
      activeRestores -= 1;
      return "second";
    });
    await expect(secondRun).rejects.toThrow("다른 탭에서 복원");
    expect(activeRestores).toBe(1);

    releaseFirst.resolve();
    await expect(firstRun).resolves.toBe("first");
    expect(maxActiveRestores).toBe(1);
    expect(fallbackKeys()).toEqual([]);
  });

  it("recovers a deterministic fallback contender after its owner expires", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-12T20:01:00.000Z") });
    const lockName = "h-memo:web-mutation-v1";
    const abandonedKey = `${FALLBACK_LOCK_PREFIX}${encodeURIComponent(lockName)}:abandoned`;
    window.localStorage.setItem(
      abandonedKey,
      JSON.stringify({
        version: 1,
        owner: "closed-tab",
        requestId: "abandoned",
        choosing: false,
        ticket: 1,
        expiresAtMs: Date.now() - 1,
      })
    );
    const barrier = new WebMutationBarrier({
      ownerId: "surviving-tab",
      fallbackLockTtlMs: 100,
      fallbackPollMs: 10,
    });

    await expect(barrier.runMutation(0, async () => "recovered")).resolves.toBe(
      "recovered"
    );
    expect(window.localStorage.getItem(abandonedKey)).toBeNull();
    expect(fallbackKeys()).toEqual([]);
  });

  it("fences a delayed repository write after fallback ownership is lost", async () => {
    const barrier = new WebMutationBarrier({ ownerId: "suspended-tab" });
    const repository = new LocalStorageMemoRepository({
      beforeWrite: () => barrier.assertMutationWriteAllowed(),
    });
    const operationEntered = deferred();
    const resumeOperation = deferred();
    const memo = createMemo({
      id: "fenced-web-write",
      now: "2026-07-12T20:02:00.000Z",
      plainText: "저장되면 안 되는 메모",
    });

    const run = barrier.runMutation(0, async () => {
      operationEntered.resolve();
      await resumeOperation.promise;
      return repository.saveMemo(memo);
    });
    await operationEntered.promise;
    for (const key of fallbackKeys()) {
      if (key.includes(encodeURIComponent("h-memo:web-mutation-v1"))) {
        window.localStorage.removeItem(key);
      }
    }
    resumeOperation.resolve();

    await expect(run).rejects.toThrow("잠금");
    expect(window.localStorage.getItem(WEB_MEMO_STORAGE_KEY)).toBeNull();
  });

  it("rejects a stale mutation intent captured before a durable restore revision", async () => {
    const barrier = new WebMutationBarrier({ ownerId: "stale-tab" });
    barrier.markObservedEpoch(0);
    const intentEpoch = barrier.getObservedEpoch();
    const operation = vi.fn(async () => "stale write");

    window.localStorage.setItem(RESTORE_EPOCH_STORAGE_KEY, "1");

    await expect(barrier.runMutation(intentEpoch, operation)).rejects.toThrow(
      "오래된 메모 변경"
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("preserves the restore failure when lease cleanup also fails", async () => {
    const barrier = new WebMutationBarrier({ ownerId: "cleanup-tab" });
    const originalRemoveItem = Storage.prototype.removeItem;
    const removeSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(function (this: Storage, key: string) {
        if (key === RESTORE_LEASE_STORAGE_KEY) {
          throw new Error("lease cleanup failed");
        }
        originalRemoveItem.call(this, key);
      });

    try {
      await expect(
        barrier.runRestore(async () => {
          throw new Error("restore failed");
        })
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(AggregateError);
        expect(error).toHaveProperty(
          "message",
          expect.stringContaining("restore failed")
        );
        expect(error).toHaveProperty(
          "message",
          expect.stringContaining("lease cleanup failed")
        );
        return true;
      });
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("recovers an abandoned remote restore lease after its bounded ttl", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-12T20:00:00.000Z") });
    window.localStorage.setItem(
      RESTORE_LEASE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        token: "abandoned-restore",
        owner: "closed-tab",
        expiresAtMs: Date.now() + 100,
      })
    );
    const barrier = new WebMutationBarrier({
      leaseTtlMs: 100,
      heartbeatMs: 25,
      stalePollMs: 20,
    });
    const observedTokens: Array<string | null> = [];
    const unsubscribe = barrier.subscribe((lease) => {
      observedTokens.push(lease?.token ?? null);
    });

    try {
      await Promise.resolve();
      expect(observedTokens.at(-1)).toBe("abandoned-restore");

      await vi.advanceTimersByTimeAsync(120);

      expect(observedTokens.at(-1)).toBeNull();
      expect(window.localStorage.getItem(RESTORE_LEASE_STORAGE_KEY)).toBeNull();
      await expect(
        barrier.runMutation(barrier.getEpoch(), async () => "recovered")
      ).resolves.toBe("recovered");
    } finally {
      unsubscribe();
    }
  });
});
