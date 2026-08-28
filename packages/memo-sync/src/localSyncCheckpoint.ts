export const LOCAL_SYNC_CHECKPOINT_VERSION = 1 as const;
const LOCAL_SYNC_CHECKPOINT_KEY_PREFIX = "h-memo:local-sync-checkpoint:";

export type LocalSyncCheckpoint = {
  version: typeof LOCAL_SYNC_CHECKPOINT_VERSION;
  userId: string;
  snapshotId: string;
  contentHash: string;
  serverSavedAt: string | null;
  recordedAt: string;
};

function checkpointKey(userId: string): string {
  return `${LOCAL_SYNC_CHECKPOINT_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseCheckpoint(value: unknown, userId: string): LocalSyncCheckpoint | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== LOCAL_SYNC_CHECKPOINT_VERSION ||
    value.userId !== userId ||
    typeof value.snapshotId !== "string" ||
    value.snapshotId.trim() === "" ||
    typeof value.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.contentHash) ||
    !(value.serverSavedAt === null || isTimestamp(value.serverSavedAt)) ||
    !isTimestamp(value.recordedAt)
  ) {
    return null;
  }

  return {
    version: LOCAL_SYNC_CHECKPOINT_VERSION,
    userId,
    snapshotId: value.snapshotId,
    contentHash: value.contentHash,
    serverSavedAt: value.serverSavedAt,
    recordedAt: value.recordedAt,
  };
}

export function readLocalSyncCheckpoint(
  storage: Storage | null,
  userId: string
): LocalSyncCheckpoint | null {
  if (!storage || userId.trim() === "") return null;
  try {
    const raw = storage.getItem(checkpointKey(userId));
    if (!raw) return null;
    return parseCheckpoint(JSON.parse(raw), userId);
  } catch {
    return null;
  }
}

export function writeLocalSyncCheckpoint(
  storage: Storage | null,
  checkpoint: LocalSyncCheckpoint
): boolean {
  if (!storage || checkpoint.userId.trim() === "") return false;
  try {
    storage.setItem(checkpointKey(checkpoint.userId), JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

export function createLocalSyncCheckpoint(input: {
  userId: string;
  snapshotId: string;
  contentHash: string;
  serverSavedAt: string | null;
  recordedAt?: string;
}): LocalSyncCheckpoint {
  return {
    version: LOCAL_SYNC_CHECKPOINT_VERSION,
    userId: input.userId,
    snapshotId: input.snapshotId,
    contentHash: input.contentHash,
    serverSavedAt: input.serverSavedAt,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

export function clearLocalSyncCheckpoint(storage: Storage | null, userId: string): void {
  if (!storage || userId.trim() === "") return;
  try {
    storage.removeItem(checkpointKey(userId));
  } catch {
    // A blocked storage implementation should not prevent local editing.
  }
}
