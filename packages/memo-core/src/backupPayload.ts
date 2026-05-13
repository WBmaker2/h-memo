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
    return { ok: false, reason: "Invalid payload" };
  }

  const candidate = payload as Partial<BackupPayload>;

  if (candidate.version !== 1) {
    return { ok: false, reason: "Unsupported version" };
  }

  if (candidate.userId !== expectedUserId) {
    return { ok: false, reason: "User ID mismatch" };
  }

  if (!Array.isArray(candidate.memos) || typeof candidate.createdAt !== "string") {
    return { ok: false, reason: "Invalid payload fields" };
  }

  return {
    ok: true,
    payload: candidate as BackupPayload,
  };
}
