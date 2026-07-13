import { describe, expect, it } from "vitest";
import { formatDateTime } from "./formatDateTime";

describe("formatDateTime", () => {
  it("normalizes Korean AM/PM labels while preserving locale punctuation", () => {
    expect(formatDateTime("2026-05-17T09:05:00.000Z")).toBe(
      "2026. 5. 17. 오후 6:05:00"
    );
    expect(formatDateTime("2026-05-17T00:05:00.000Z")).toBe(
      "2026. 5. 17. 오전 9:05:00"
    );
  });

  it("does not translate non-Korean locale output", () => {
    const formatted = formatDateTime("2026-05-17T09:05:00.000Z", "en-US");

    expect(formatted).toContain("5/17/2026");
    expect(formatted).toContain("PM");
    expect(formatted).not.toContain("오후");
  });

  it("formats an optional timezone without changing the default signature", () => {
    expect(
      formatDateTime("2026-07-12T15:30:00.000Z", "ko-KR", "Asia/Seoul")
    ).toBe("2026. 7. 13. 오전 12:30:00");
  });

  it.each(["", "   ", "not-a-date"])(
    "returns a Korean empty-state label for invalid input %j",
    (value) => {
      expect(formatDateTime(value)).toBe("날짜 정보 없음");
    }
  );
});
