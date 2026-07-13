import { validateBackupPayload } from "@h-memo/memo-core";
import {
  loadBackupSnapshot,
  type BackupGateway,
  type BackupSnapshotSummary,
  type MemoBackupPayload,
} from "@h-memo/memo-sync";
import { formatDateTime } from "@h-memo/memo-ui";

export type WebBackupRestoreSelection =
  | { kind: "cancelled"; summary: BackupSnapshotSummary }
  | { kind: "unavailable"; summary: BackupSnapshotSummary }
  | {
      kind: "ready";
      summary: BackupSnapshotSummary;
      payload: MemoBackupPayload;
    };

export function getWebServerRestoreConfirmMessage(summary: BackupSnapshotSummary): string {
  const savedAt = summary.savedAt
    ? formatDateTime(summary.savedAt, "ko-KR", "Asia/Seoul")
    : "기존 백업";
  return `${savedAt} 백업의 ${summary.memoCount}개 메모로 현재 로컬 메모를 대체합니다. 계속할까요?`;
}

export async function loadWebBackupSelection({
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
}): Promise<WebBackupRestoreSelection | null> {
  const summary = summaries.find((item) => item.id === snapshotId);
  if (!summary) {
    return null;
  }

  if (!confirm(getWebServerRestoreConfirmMessage(summary))) {
    return { kind: "cancelled", summary };
  }

  const payload = await loadSnapshot(gateway, userId, summary.id);
  if (payload === null) {
    return { kind: "unavailable", summary };
  }

  const validated = validateBackupPayload(payload, userId);
  if (!validated.ok) {
    return { kind: "unavailable", summary };
  }

  return { kind: "ready", summary, payload: validated.payload };
}

export async function restoreWebBackupSelection({
  restore,
  ...selectionOptions
}: Parameters<typeof loadWebBackupSelection>[0] & {
  restore: (payload: MemoBackupPayload) => Promise<void>;
}): Promise<WebBackupRestoreSelection | null> {
  const selection = await loadWebBackupSelection(selectionOptions);
  if (selection?.kind === "ready") {
    await restore(selection.payload);
  }
  return selection;
}
