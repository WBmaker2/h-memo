import { describe, expect, it, vi } from "vitest";

import {
  readUpdateSnoozeUntil,
  saveUpdateSnooze,
  UPDATE_SNOOZE_STORAGE_KEY,
} from "./updateSnooze";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe("update snooze persistence", () => {
  it("stores seven-day and thirty-day re-prompt deadlines", () => {
    const storage = createStorage();
    const now = Date.parse("2026-08-30T00:00:00.000Z");

    expect(saveUpdateSnooze("week", storage, now)).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(readUpdateSnoozeUntil(storage, now + 1)).toBe(now + 7 * 24 * 60 * 60 * 1000);

    expect(saveUpdateSnooze("month", storage, now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
    expect(readUpdateSnoozeUntil(storage, now + 1)).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });

  it("removes expired or invalid values before checking for an update", () => {
    const storage = createStorage();
    const now = Date.parse("2026-08-30T00:00:00.000Z");
    storage.setItem(UPDATE_SNOOZE_STORAGE_KEY, String(now));

    expect(readUpdateSnoozeUntil(storage, now)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(UPDATE_SNOOZE_STORAGE_KEY);

    storage.setItem(UPDATE_SNOOZE_STORAGE_KEY, "not-a-timestamp");
    expect(readUpdateSnoozeUntil(storage, now)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });

  it("fails open when local storage cannot be read or written", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("read blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("write blocked");
      }),
      removeItem: vi.fn(),
    };

    expect(readUpdateSnoozeUntil(storage, Date.now())).toBeNull();
    expect(saveUpdateSnooze("week", storage, Date.now())).toBeNull();
  });
});
