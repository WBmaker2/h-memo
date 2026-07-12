import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  LocalStorageMemoRepository,
  WEB_MEMO_STORAGE_KEY,
} from "./localStorageMemoRepository";
import { WebMutationBarrier } from "./webMutationBarrier";

const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_STORAGE_KEY = "h-memo:web-restore-epoch-v1";

function installExclusiveWebLocks() {
  const queues = new Map<string, Promise<void>>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: <T,>(
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<T> | T
      ) => {
        const previous = queues.get(name) ?? Promise.resolve();
        const result = previous
          .catch(() => {})
          .then(() => callback({ name, mode: "exclusive" } as Lock));
        queues.set(
          name,
          result.then(
            () => undefined,
            () => undefined
          )
        );
        return result;
      },
    },
  });
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

  it("fails two independent unsupported restore instances before either callback starts", async () => {
    const first = new WebMutationBarrier({ ownerId: "unsupported-a" });
    const second = new WebMutationBarrier({ ownerId: "unsupported-b" });
    const firstCallback = vi.fn(async () => "first");
    const secondCallback = vi.fn(async () => "second");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    try {
      const outcomes = await Promise.allSettled([
        first.runRestore(firstCallback),
        second.runRestore(secondCallback),
      ]);
      expect(outcomes).toEqual([
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ message: expect.stringContaining("Web Locks") }),
        }),
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ message: expect.stringContaining("Web Locks") }),
        }),
      ]);
      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("fails an unsupported mutation before callback or repository write", async () => {
    const barrier = new WebMutationBarrier({ ownerId: "unsupported-write" });
    const repository = new LocalStorageMemoRepository({
      beforeWrite: () => barrier.assertMutationWriteAllowed(),
    });
    const memo = createMemo({
      id: "unsupported-web-write",
      now: "2026-07-12T20:02:00.000Z",
      plainText: "저장되면 안 되는 메모",
    });
    const operation = vi.fn(async () => repository.saveMemo(memo));

    await expect(barrier.runMutation(0, operation)).rejects.toThrow("Web Locks");
    expect(operation).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(WEB_MEMO_STORAGE_KEY)).toBeNull();
    await expect(repository.saveMemo(memo)).rejects.toThrow("Web Locks");
    expect(window.localStorage.getItem(WEB_MEMO_STORAGE_KEY)).toBeNull();
  });

  it("rejects a stale mutation intent captured before a durable restore revision", async () => {
    installExclusiveWebLocks();
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
    installExclusiveWebLocks();
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
    installExclusiveWebLocks();
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
