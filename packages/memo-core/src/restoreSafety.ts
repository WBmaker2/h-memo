import { validateLocalBackupPayload } from "./backupPayload";
import type { BackupPayload } from "./types";

export const RESTORE_SAFETY_STORAGE_KEY = "h-memo:restore-safety-v1";

export type RestoreSafetyPoint = {
  version: 1;
  source: "server" | "json";
  createdAt: string;
  payload: BackupPayload;
};

const INVALID_RESTORE_SAFETY_POINT_MESSAGE = "복원 안전 지점 데이터가 올바르지 않습니다.";
const RESTORE_SAFETY_SAVE_FAILED_MESSAGE =
  "복원 안전 지점을 저장하지 못했습니다. 저장 공간을 확인해 주세요.";
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStrictTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRestoreSafetyPoint(value: unknown): value is RestoreSafetyPoint {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== 1 || (value.source !== "server" && value.source !== "json")) {
    return false;
  }
  if (
    !isStrictTimestamp(value.createdAt)
  ) {
    return false;
  }

  return validateLocalBackupPayload(value.payload).ok;
}

export function saveRestoreSafetyPoint(storage: Storage, point: RestoreSafetyPoint): void {
  if (!isRestoreSafetyPoint(point)) {
    throw new Error(INVALID_RESTORE_SAFETY_POINT_MESSAGE);
  }

  try {
    const serialized = JSON.stringify(point);
    if (typeof serialized !== "string") {
      throw new Error("안전 지점 직렬화 결과가 비어 있습니다.");
    }
    storage.setItem(RESTORE_SAFETY_STORAGE_KEY, serialized);
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new Error(`${RESTORE_SAFETY_SAVE_FAILED_MESSAGE}${detail}`);
  }
}

export function loadRestoreSafetyPoint(storage: Storage): RestoreSafetyPoint | null {
  try {
    const raw = storage.getItem(RESTORE_SAFETY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return isRestoreSafetyPoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRestoreSafetyPoint(storage: Storage): void {
  storage.removeItem(RESTORE_SAFETY_STORAGE_KEY);
}
