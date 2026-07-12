import { describe, expect, it } from "vitest";
import { formatDateTime } from "./formatDateTime";

describe("formatDateTime", () => {
  it("formats an ISO timestamp using the Korean locale", () => {
    expect(formatDateTime("2026-05-17T09:05:00.000Z")).toBe(
      "2026. 5. 17. 오후 6:05:00"
    );
  });

  it.each(["", "   ", "not-a-date"])(
    "returns a Korean empty-state label for invalid input %j",
    (value) => {
      expect(formatDateTime(value)).toBe("날짜 정보 없음");
    }
  );
});
