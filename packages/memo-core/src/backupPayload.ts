import type { BackupPayload, Memo, ValidationResult } from "./types";

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
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "백업 데이터가 객체가 아닙니다." };
  }

  const candidate = payload as Partial<BackupPayload>;

  if (candidate.version !== 1) {
    return { ok: false, reason: "지원하지 않는 백업 버전입니다." };
  }

  if (candidate.userId !== expectedUserId) {
    return { ok: false, reason: "다른 사용자의 백업 데이터입니다." };
  }

  if (!Array.isArray(candidate.memos)) {
    return { ok: false, reason: "메모 목록이 없습니다." };
  }

  if (typeof candidate.createdAt !== "string") {
    return { ok: false, reason: "잘못된 메모 데이터가 포함되어 있습니다." };
  }

  const hasInvalidMemo = candidate.memos.some(
    (memo) =>
      !memo ||
      typeof memo !== "object" ||
      typeof (memo as { id?: unknown }).id !== "string" ||
      typeof (memo as { title?: unknown }).title !== "string"
  );

  if (hasInvalidMemo) {
    return { ok: false, reason: "잘못된 메모 데이터가 포함되어 있습니다." };
  }

  return {
    ok: true,
    payload: candidate as BackupPayload,
  };
}
