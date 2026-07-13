import { formatDateTime } from "@h-memo/memo-ui";
import {
  loadBackupSnapshot,
  type BackupGateway,
  type BackupSnapshotSummary,
  type MemoBackupPayload,
} from "@h-memo/memo-sync";

export type DesktopBackupRestoreSelection =
  | { kind: "cancelled"; summary: BackupSnapshotSummary }
  | { kind: "unavailable"; summary: BackupSnapshotSummary }
  | {
      kind: "ready";
      summary: BackupSnapshotSummary;
      payload: MemoBackupPayload;
    };

export function getServerRestoreConfirmMessage(summary: BackupSnapshotSummary): string {
  const savedAt = summary.savedAt
    ? formatDateTime(summary.savedAt, "ko-KR", "Asia/Seoul")
    : "기존 백업";
  return `${savedAt} 백업의 ${summary.memoCount}개 메모로 현재 로컬 메모를 대체합니다. 계속할까요?`;
}

export async function loadDesktopBackupSelection({
  gateway,
  userId,
  snapshotId,
  summaries,
  confirm,
  loadSnapshot = loadBackupSnapshot,
}: {
  gateway: BackupGateway;
  userId: string;
  snapshotId: string;
  summaries: BackupSnapshotSummary[];
  confirm: (message: string) => boolean;
  loadSnapshot?: (
    gateway: BackupGateway,
    userId: string,
    snapshotId: string
  ) => Promise<MemoBackupPayload | null>;
}): Promise<DesktopBackupRestoreSelection | null> {
  const summary = summaries.find((item) => item.id === snapshotId);
  if (!summary) {
    return null;
  }

  if (!confirm(getServerRestoreConfirmMessage(summary))) {
    return { kind: "cancelled", summary };
  }

  const payload = await loadSnapshot(gateway, userId, summary.id);
  if (payload === null) {
    return { kind: "unavailable", summary };
  }
  return { kind: "ready", summary, payload };
}

export async function restoreDesktopBackupSelection({
  restore,
  ...selectionOptions
}: Parameters<typeof loadDesktopBackupSelection>[0] & {
  restore: (payload: MemoBackupPayload) => Promise<void>;
}): Promise<DesktopBackupRestoreSelection | null> {
  const selection = await loadDesktopBackupSelection(selectionOptions);
  if (selection?.kind === "ready") {
    await restore(selection.payload);
  }
  return selection;
}
