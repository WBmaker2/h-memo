import {
  validateBackupPayload,
  type BackupPayload,
  type Memo,
  type ValidationResult,
} from "@h-memo/memo-core";

const INVALID_MEMO_REASON = "잘못된 메모 데이터가 포함되어 있습니다.";
const SYNC_STATES: Memo["syncState"][] = [
  "local-only",
  "queued",
  "backed-up",
  "conflict",
];
const LEGACY_TIMESTAMP_FALLBACK = "1970-01-01T00:00:00.000Z";

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function isLegacyMemoShape(value: unknown): value is Memo {
  if (!isObject(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.plainText !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.syncState !== "string" ||
    !SYNC_STATES.includes(value.syncState as Memo["syncState"]) ||
    !Object.prototype.hasOwnProperty.call(value, "richContent")
  ) {
    return false;
  }

  if (!(value.deletedAt === null || typeof value.deletedAt === "string")) {
    return false;
  }

  if (!isObject(value.style)) {
    return false;
  }
  if (
    typeof value.style.backgroundColor !== "string" ||
    typeof value.style.textColor !== "string" ||
    typeof value.style.fontFamily !== "string" ||
    typeof value.style.fontSize !== "number"
  ) {
    return false;
  }

  if (!isObject(value.windowState)) {
    return false;
  }
  return (
    (value.windowState.x === null || typeof value.windowState.x === "number") &&
    (value.windowState.y === null || typeof value.windowState.y === "number") &&
    typeof value.windowState.width === "number" &&
    typeof value.windowState.height === "number" &&
    typeof value.windowState.visible === "boolean" &&
    typeof value.windowState.alwaysOnTop === "boolean"
  );
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function earliestTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null).sort()[0] ?? null;
}

function normalizeLegacyPayload(value: UnknownRecord): BackupPayload {
  const rawMemos = value.memos as Memo[];
  const payloadCreatedAt = normalizeTimestamp(value.createdAt);
  const validMemoTimestamp = earliestTimestamp(
    rawMemos.flatMap((memo) => [normalizeTimestamp(memo.createdAt), normalizeTimestamp(memo.updatedAt)])
  );
  const fallbackTimestamp = payloadCreatedAt ?? validMemoTimestamp ?? LEGACY_TIMESTAMP_FALLBACK;
  const memos = rawMemos.map((memo) => {
    const updatedAt = normalizeTimestamp(memo.updatedAt);
    const createdAt = normalizeTimestamp(memo.createdAt) ?? updatedAt ?? fallbackTimestamp;
    const normalizedUpdatedAt = updatedAt === null || updatedAt < createdAt ? createdAt : updatedAt;
    const deletedAt =
      memo.deletedAt === null || (typeof memo.deletedAt === "string" && memo.deletedAt.trim() === "")
        ? null
        : normalizeTimestamp(memo.deletedAt) ?? normalizedUpdatedAt;

    return {
      ...memo,
      createdAt,
      updatedAt: normalizedUpdatedAt,
      deletedAt,
    };
  });

  return {
    version: 1,
    userId: value.userId as string,
    createdAt: payloadCreatedAt ?? earliestTimestamp(memos.map((memo) => memo.createdAt)) ?? fallbackTimestamp,
    memos,
  };
}

/**
 * Reads the old inline Firestore shape and returns a strict-valid local
 * payload. Valid timestamps keep their instant; invalid legacy timestamp
 * fields use deterministic fallbacks before local restore can mutate state.
 */
export function validateLegacyFirestoreV1Payload(
  value: unknown,
  expectedUserId: string
): ValidationResult {
  if (!isObject(value)) {
    return { ok: false, reason: "백업 데이터가 객체가 아닙니다." };
  }

  if (
    value.version !== 1 ||
    typeof value.userId !== "string" ||
    value.userId.trim() === "" ||
    value.userId !== expectedUserId
  ) {
    return {
      ok: false,
      reason:
        value.version !== 1
          ? "지원하지 않는 백업 버전입니다."
          : value.userId !== expectedUserId
            ? "다른 사용자의 백업 데이터입니다."
            : INVALID_MEMO_REASON,
    };
  }

  if (typeof value.createdAt !== "string") {
    return { ok: false, reason: INVALID_MEMO_REASON };
  }
  if (!Array.isArray(value.memos)) {
    return { ok: false, reason: "메모 목록이 없습니다." };
  }
  if (value.memos.some((memo) => !isLegacyMemoShape(memo))) {
    return { ok: false, reason: INVALID_MEMO_REASON };
  }

  return validateBackupPayload(normalizeLegacyPayload(value), expectedUserId);
}

export const parseLegacyFirestoreV1Payload = validateLegacyFirestoreV1Payload;
