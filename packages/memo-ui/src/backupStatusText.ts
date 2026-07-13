export type BackupSaveOutcome = "created" | "replaced" | "unchanged";

export type BackupSaveStatusInput = {
  outcome: BackupSaveOutcome;
  cleanupPending: boolean;
};

export function formatBackupSaveStatus(result: BackupSaveStatusInput): string {
  if (result.outcome === "unchanged") {
    return "변경된 내용이 없어 백업을 생략했습니다.";
  }

  const base =
    result.outcome === "replaced"
      ? "오늘 백업을 최신 내용으로 교체했습니다."
      : "새 백업을 저장했습니다.";

  return result.cleanupPending
    ? `${base} 이전 기록 정리는 다음 백업에서 다시 시도합니다.`
    : base;
}
