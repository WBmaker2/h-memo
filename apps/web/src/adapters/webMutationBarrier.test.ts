import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMutationBarrier } from "./webMutationBarrier";

const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";

describe("WebMutationBarrier", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
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
