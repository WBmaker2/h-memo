import type { BackupPayload, Memo, ValidationResult } from "./types";

const INVALID_MEMO_REASON = "잘못된 메모 데이터가 포함되어 있습니다.";
const SYNC_STATES = ["local-only", "queued", "backed-up", "conflict"];

type JsonUnknown = { [key: string]: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isValidMemoShape(memo: unknown): memo is Memo {
  if (!isObject(memo)) {
    return false;
  }

  const candidate = memo as JsonUnknown;

  if (typeof candidate.id !== "string") {
    return false;
  }
  if (typeof candidate.title !== "string") {
    return false;
  }
  if (typeof candidate.plainText !== "string") {
    return false;
  }
  if (typeof candidate.createdAt !== "string") {
    return false;
  }
  if (typeof candidate.updatedAt !== "string") {
    return false;
  }
  if (typeof candidate.syncState !== "string" || !SYNC_STATES.includes(candidate.syncState)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, "richContent")) {
    return false;
  }

  if (!(candidate.deletedAt === null || typeof candidate.deletedAt === "string")) {
    return false;
  }

  const style = candidate.style;
  if (!isObject(style)) {
    return false;
  }
  const styleCandidate = style as JsonUnknown;
  if (typeof styleCandidate.backgroundColor !== "string") {
    return false;
  }
  if (typeof styleCandidate.textColor !== "string") {
    return false;
  }
  if (typeof styleCandidate.fontFamily !== "string") {
    return false;
  }
  if (typeof styleCandidate.fontSize !== "number") {
    return false;
  }

  const windowState = candidate.windowState;
  if (!isObject(windowState)) {
    return false;
  }
  const windowStateCandidate = windowState as JsonUnknown;
  if (!((windowStateCandidate.x === null || typeof windowStateCandidate.x === "number"))) {
    return false;
  }
  if (!((windowStateCandidate.y === null || typeof windowStateCandidate.y === "number"))) {
    return false;
  }
  if (typeof windowStateCandidate.width !== "number") {
    return false;
  }
  if (typeof windowStateCandidate.height !== "number") {
    return false;
  }
  if (typeof windowStateCandidate.visible !== "boolean") {
    return false;
  }
  if (typeof windowStateCandidate.alwaysOnTop !== "boolean") {
    return false;
  }

  return true;
}

export function createBackupPayload(payload: {
  userId: string;
  memos: Memo[];
  createdAt: string;
}): BackupPayload {
  return {
    version: 1,
    userId: payload.userId,
    createdAt: payload.createdAt,
    memos: payload.memos,
  };
}

export function validateBackupPayload(
  payload: unknown,
  expectedUserId: string
): ValidationResult {
  return validateBackupPayloadShape(payload, expectedUserId);
}

export function validateLocalBackupPayload(payload: unknown): ValidationResult {
  return validateBackupPayloadShape(payload);
}

function validateBackupPayloadShape(
  payload: unknown,
  expectedUserId?: string
): ValidationResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "백업 데이터가 객체가 아닙니다." };
  }

  const candidate = payload as Partial<BackupPayload>;

  if (candidate.version !== 1) {
    return { ok: false, reason: "지원하지 않는 백업 버전입니다." };
  }

  if (typeof candidate.userId !== "string" || candidate.userId.trim() === "") {
    return { ok: false, reason: INVALID_MEMO_REASON };
  }

  if (expectedUserId !== undefined && candidate.userId !== expectedUserId) {
    return { ok: false, reason: "다른 사용자의 백업 데이터입니다." };
  }

  if (!Array.isArray(candidate.memos)) {
    return { ok: false, reason: "메모 목록이 없습니다." };
  }

  if (typeof candidate.createdAt !== "string") {
    return { ok: false, reason: INVALID_MEMO_REASON };
  }

  const hasInvalidMemo = candidate.memos.some((memo) => !isValidMemoShape(memo));
  if (hasInvalidMemo) {
    return { ok: false, reason: INVALID_MEMO_REASON };
  }

  return {
    ok: true,
    payload: candidate as BackupPayload,
  };
}
