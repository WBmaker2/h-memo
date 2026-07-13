import { createBackupPreviewText } from "./backupFingerprint";
import { toKstDateKey } from "./backupKstDate";
import { isRecord, normalizeFirestoreTimestamp } from "./firestoreBackupShared";
import type {
  BackupSchemaVersion,
  BackupSnapshotSummary,
  MemoBackupPayload,
} from "./backupTypes";

export type { BackupSchemaVersion, BackupSnapshotSummary } from "./backupTypes";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isMemoList(value: unknown): value is MemoBackupPayload["memos"] {
  return Array.isArray(value);
}

function normalizedSavedAt(value: unknown): string | null {
  return normalizeFirestoreTimestamp(value);
}

function summary(
  id: string,
  schemaVersion: BackupSchemaVersion,
  savedAt: string | null,
  memoCount: number,
  previewText: string,
  contentHash: string | null,
  legacyUndated: boolean
): BackupSnapshotSummary {
  return {
    id,
    savedAt,
    kstDate: savedAt === null ? null : toKstDateKey(savedAt),
    memoCount,
    previewText,
    contentHash,
    schemaVersion,
    state: "complete",
    legacyUndated,
  };
}

function parseV3(id: string, data: UnknownRecord): BackupSnapshotSummary | null {
  if (
    data.schemaVersion !== 3 ||
    data.state !== "complete" ||
    !isNonEmptyString(data.userId) ||
    typeof data.memoCount !== "number" ||
    !Number.isInteger(data.memoCount) ||
    data.memoCount < 0 ||
    typeof data.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(data.contentHash) ||
    typeof data.previewText !== "string" ||
    data.previewText.length > 240 ||
    !isNonEmptyString(data.clientCreatedAt)
  ) {
    return null;
  }

  const savedAt = normalizedSavedAt(data.savedAt);
  if (savedAt === null) return null;

  return summary(id, 3, savedAt, data.memoCount, data.previewText, data.contentHash, false);
}

function parseV2(id: string, data: UnknownRecord): BackupSnapshotSummary | null {
  if (
    data.schemaVersion !== 2 ||
    data.state !== "complete" ||
    !isNonEmptyString(data.userId) ||
    typeof data.memoCount !== "number" ||
    !Number.isInteger(data.memoCount) ||
    data.memoCount < 0
  ) {
    return null;
  }

  const savedAt = normalizedSavedAt(data.savedAt);
  return summary(id, 2, savedAt, data.memoCount, "", null, false);
}

function parseV1(id: string, data: UnknownRecord): BackupSnapshotSummary | null {
  if (
    data.version !== 1 ||
    !isNonEmptyString(data.userId) ||
    !isMemoList(data.memos)
  ) {
    return null;
  }

  const savedAt = normalizedSavedAt(data.savedAt) ?? normalizedSavedAt(data.createdAt);
  const previewText = createBackupPreviewText({
    version: 1,
    userId: data.userId,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    memos: data.memos,
  });

  return summary(
    id,
    1,
    savedAt,
    data.memos.length,
    previewText,
    null,
    savedAt === null
  );
}

function unwrapMetadata(
  idOrMetadata: string | unknown,
  metadata: unknown
): { id: string; data: UnknownRecord } | null {
  if (typeof idOrMetadata === "string") {
    const data = asRecord(metadata);
    return data === null ? null : { id: idOrMetadata, data };
  }

  const wrapper = asRecord(idOrMetadata);
  if (wrapper === null) return null;

  const id = typeof wrapper.id === "string" ? wrapper.id : "";
  if (typeof wrapper.data === "function") {
    const data = asRecord((wrapper.data as () => unknown)());
    return data === null ? null : { id, data };
  }
  if (isRecord(wrapper.data)) {
    return { id, data: wrapper.data };
  }
  if (isRecord(wrapper.payload) && wrapper.schemaVersion === undefined && wrapper.version === undefined) {
    return { id, data: { ...wrapper.payload, savedAt: wrapper.savedAt } };
  }
  return { id, data: wrapper };
}

export function parseBackupSnapshotSummary(
  id: string,
  metadata: unknown
): BackupSnapshotSummary | null;
export function parseBackupSnapshotSummary(metadata: unknown): BackupSnapshotSummary | null;
export function parseBackupSnapshotSummary(
  idOrMetadata: string | unknown,
  metadata?: unknown
): BackupSnapshotSummary | null {
  const unwrapped = unwrapMetadata(idOrMetadata, metadata);
  if (unwrapped === null || unwrapped.id === "") return null;

  const { id, data } = unwrapped;
  if (data.schemaVersion === 3) return parseV3(id, data);
  if (data.schemaVersion === 2) return parseV2(id, data);
  if (data.version === 1) return parseV1(id, data);
  return null;
}
