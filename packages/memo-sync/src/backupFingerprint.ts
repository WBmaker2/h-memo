import type { MemoBackupPayload } from "./backupTypes";

function compareUtf16CodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function restorableMemos(payload: MemoBackupPayload) {
  return payload.memos
    .filter((memo) => memo.deletedAt === null)
    .map(({ syncState: _syncState, ...memo }) => memo)
    .sort((left, right) => compareUtf16CodeUnits(left.id, right.id));
}

export async function createBackupContentHash(
  payload: MemoBackupPayload
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalize(restorableMemos(payload)))
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createBackupPreviewText(payload: MemoBackupPayload): string {
  const preview = restorableMemos(payload)
    .slice(0, 3)
    .map((memo) => memo.plainText.trim().replace(/\s+/g, " ").slice(0, 72) || "빈 메모")
    .join(", ");
  return (preview || "메모 없음").slice(0, 240);
}
