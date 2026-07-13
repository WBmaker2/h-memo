import { describe, expect, it } from "vitest";
import {
  getKstRetentionStartKey,
  isKstDateInRetention,
  shiftKstDateKey,
  toKstDateKey,
} from "./backupKstDate";

describe("KST backup dates", () => {
  it("changes date exactly at KST midnight", () => {
    expect(toKstDateKey("2026-07-12T14:59:59.999Z")).toBe("2026-07-12");
    expect(toKstDateKey("2026-07-12T15:00:00.000Z")).toBe("2026-07-13");
  });

  it("keeps today and the prior 364 calendar dates", () => {
    expect(getKstRetentionStartKey("2026-07-13T03:00:00.000Z")).toBe("2025-07-14");
    expect(isKstDateInRetention("2025-07-14", "2026-07-13T03:00:00.000Z")).toBe(true);
    expect(isKstDateInRetention("2025-07-13", "2026-07-13T03:00:00.000Z")).toBe(false);
  });

  it("handles leap-year February by calendar date", () => {
    expect(getKstRetentionStartKey("2024-03-01T03:00:00.000Z", 2)).toBe("2024-02-29");
  });

  it("rejects impossible calendar date keys", () => {
    expect(() => shiftKstDateKey("2026-02-31", 0)).toThrow("Invalid KST date key");
    expect(() => shiftKstDateKey("2026-02-31", -1)).toThrow("Invalid KST date key");
    expect(isKstDateInRetention("2026-02-31", "2026-07-13T03:00:00.000Z")).toBe(false);
  });
});
