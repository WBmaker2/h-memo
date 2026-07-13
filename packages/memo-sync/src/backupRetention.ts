import {
  getKstRetentionStartKey,
  isKstDateInRetention,
  toKstDateKey,
} from "./backupKstDate";
import type {
  BackupCleanupCandidate,
  BackupSnapshotSummary,
} from "./backupTypes";

export type BackupCleanupOptions = {
  activeSnapshotId: string | null;
  pendingSnapshotId: string | null;
  now: string | Date;
};

export type { BackupCleanupCandidate } from "./backupTypes";

function compareUtf16CodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareDescending(left: string, right: string): number {
  return compareUtf16CodeUnits(right, left);
}

export function selectDailyBackupSummaries(
  summaries: BackupSnapshotSummary[],
  now: string | Date
): BackupSnapshotSummary[] {
  const latestByDate = new Map<string, BackupSnapshotSummary>();
  const undated: BackupSnapshotSummary[] = [];

  for (const snapshot of summaries) {
    if (snapshot.kstDate === null) {
      if (snapshot.legacyUndated) undated.push(snapshot);
      continue;
    }
    if (!isKstDateInRetention(snapshot.kstDate, now)) continue;

    const previous = latestByDate.get(snapshot.kstDate);
    if (
      previous === undefined ||
      compareUtf16CodeUnits(snapshot.savedAt ?? "", previous.savedAt ?? "") > 0 ||
      (snapshot.savedAt === previous.savedAt &&
        compareUtf16CodeUnits(snapshot.id, previous.id) < 0)
    ) {
      latestByDate.set(snapshot.kstDate, snapshot);
    }
  }

  return [...latestByDate.values()]
    .sort(
      (left, right) =>
        compareDescending(left.savedAt ?? "", right.savedAt ?? "") ||
        compareUtf16CodeUnits(left.id, right.id)
    )
    .concat(
      undated.sort((left, right) => compareUtf16CodeUnits(left.id, right.id))
    );
}

function candidateFor(
  snapshot: BackupSnapshotSummary,
  reason: BackupCleanupCandidate["reason"]
): BackupCleanupCandidate | null {
  if (snapshot.savedAt === null || snapshot.kstDate === null) return null;
  return {
    id: snapshot.id,
    schemaVersion: snapshot.schemaVersion,
    savedAt: snapshot.savedAt,
    kstDate: snapshot.kstDate,
    reason,
  };
}

export function planBackupCleanupCandidates(
  summaries: BackupSnapshotSummary[],
  options: BackupCleanupOptions
): BackupCleanupCandidate[] {
  const retentionStart = getKstRetentionStartKey(options.now);
  const keepIds = new Set(
    selectDailyBackupSummaries(summaries, options.now).map((snapshot) => snapshot.id)
  );
  const candidates: BackupCleanupCandidate[] = [];

  for (const snapshot of summaries) {
    if (
      snapshot.id === options.activeSnapshotId ||
      snapshot.id === options.pendingSnapshotId ||
      snapshot.kstDate === null ||
      snapshot.kstDate > toKstDateKey(options.now)! ||
      !isValidDateKey(snapshot.kstDate)
    ) {
      continue;
    }

    if (snapshot.kstDate < retentionStart) {
      const candidate = candidateFor(snapshot, "expired");
      if (candidate) candidates.push(candidate);
      continue;
    }

    if (!keepIds.has(snapshot.id) && isKstDateInRetention(snapshot.kstDate, options.now)) {
      const candidate = candidateFor(snapshot, "same-day-duplicate");
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates.sort(
    (left, right) =>
      reasonOrder(left.reason) - reasonOrder(right.reason) ||
      compareUtf16CodeUnits(left.savedAt, right.savedAt) ||
      compareUtf16CodeUnits(left.id, right.id)
  );
}

function reasonOrder(reason: BackupCleanupCandidate["reason"]): number {
  return reason === "same-day-duplicate" ? 0 : 1;
}

function isValidDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}
