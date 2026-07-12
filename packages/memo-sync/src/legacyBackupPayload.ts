import type { BackupPayload, Memo, ValidationResult } from "@h-memo/memo-core";

const INVALID_MEMO_REASON = "잘못된 메모 데이터가 포함되어 있습니다.";
const SYNC_STATES: Memo["syncState"][] = [
  "local-only",
  "queued",
  "backed-up",
  "conflict",
];

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

/**
 * Reads only the old inline Firestore shape. Timestamp strings are metadata
 * here, so the pre-v2 reader intentionally preserves even empty/non-ISO values.
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

  return {
    ok: true,
    payload: value as BackupPayload,
  };
}

export const parseLegacyFirestoreV1Payload = validateLegacyFirestoreV1Payload;
