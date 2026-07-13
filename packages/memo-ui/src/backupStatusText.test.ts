import { describe, expect, it } from "vitest";

import { formatBackupSaveStatus } from "./backupStatusText";

describe("formatBackupSaveStatus", () => {
  it.each([
    ["created", false, "새 백업을 저장했습니다."],
    ["replaced", false, "오늘 백업을 최신 내용으로 교체했습니다."],
    ["unchanged", false, "변경된 내용이 없어 백업을 생략했습니다."],
    [
      "created",
      true,
      "새 백업을 저장했습니다. 이전 기록 정리는 다음 백업에서 다시 시도합니다.",
    ],
    [
      "replaced",
      true,
      "오늘 백업을 최신 내용으로 교체했습니다. 이전 기록 정리는 다음 백업에서 다시 시도합니다.",
    ],
  ] as const)("formats %s with cleanupPending=%s", (outcome, cleanupPending, expected) => {
    expect(formatBackupSaveStatus({ outcome, cleanupPending })).toBe(expected);
  });

  it("does not add cleanup text to an unchanged result", () => {
    expect(formatBackupSaveStatus({ outcome: "unchanged", cleanupPending: true })).toBe(
      "변경된 내용이 없어 백업을 생략했습니다."
    );
  });
});
