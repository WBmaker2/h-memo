import {
  DEFAULT_MEMO_STYLE,
  DEFAULT_MEMO_WINDOW_STATE,
  softDeleteMemo,
  type Memo,
  type MemoRepository,
  type MemoStyle,
  type MemoWindowState,
  type SyncState,
} from "@h-memo/memo-core";

export const WEB_MEMO_STORAGE_KEY = "h-memo:web-memo-repository-v1";
export const WEB_MEMO_STORAGE_CHANGED_EVENT = "h-memo:web-memo-storage-changed";
const DEFAULT_RICH_CONTENT = { type: "doc", content: [{ type: "paragraph" }] } as const;
const SYNC_STATES = new Set<SyncState>([
  "local-only",
  "queued",
  "backed-up",
  "conflict",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function readNullableNumber(value: unknown, fallback: number | null): number | null {
  return value === null || isFiniteNumber(value) ? value : fallback;
}

function normalizeStyle(value: unknown): MemoStyle {
  if (!isRecord(value)) {
    return clone(DEFAULT_MEMO_STYLE);
  }

  return {
    backgroundColor: readString(
      value.backgroundColor,
      DEFAULT_MEMO_STYLE.backgroundColor
    ),
    textColor: readString(value.textColor, DEFAULT_MEMO_STYLE.textColor),
    fontFamily: readString(value.fontFamily, DEFAULT_MEMO_STYLE.fontFamily),
    fontSize: readPositiveNumber(value.fontSize, DEFAULT_MEMO_STYLE.fontSize),
  };
}

function normalizeWindowState(value: unknown): MemoWindowState {
  if (!isRecord(value)) {
    return clone(DEFAULT_MEMO_WINDOW_STATE);
  }

  return {
    x: readNullableNumber(value.x, DEFAULT_MEMO_WINDOW_STATE.x),
    y: readNullableNumber(value.y, DEFAULT_MEMO_WINDOW_STATE.y),
    width: readPositiveNumber(value.width, DEFAULT_MEMO_WINDOW_STATE.width),
    height: readPositiveNumber(value.height, DEFAULT_MEMO_WINDOW_STATE.height),
    visible:
      typeof value.visible === "boolean"
        ? value.visible
        : DEFAULT_MEMO_WINDOW_STATE.visible,
    alwaysOnTop:
      typeof value.alwaysOnTop === "boolean"
        ? value.alwaysOnTop
        : DEFAULT_MEMO_WINDOW_STATE.alwaysOnTop,
  };
}

function normalizeSyncState(value: unknown): SyncState {
  return typeof value === "string" && SYNC_STATES.has(value as SyncState)
    ? (value as SyncState)
    : "local-only";
}

function normalizeDeletedAt(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeMemo(value: unknown): Memo | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return null;
  }

  return {
    id: value.id,
    title: readString(value.title, "새 메모"),
    plainText: readString(value.plainText, ""),
    richContent:
      value.richContent === undefined ? clone(DEFAULT_RICH_CONTENT) : value.richContent,
    style: normalizeStyle(value.style),
    windowState: normalizeWindowState(value.windowState),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: normalizeDeletedAt(value.deletedAt),
    syncState: normalizeSyncState(value.syncState),
  };
}

function isMemo(value: Memo | null): value is Memo {
  return value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "알 수 없는 오류";
}

function safeReadStorage(): Memo[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(WEB_MEMO_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeMemo).filter(isMemo).map(clone);
  } catch {
    return [];
  }
}

function writeStorage(value: Memo[]) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    throw new Error("localStorage를 사용할 수 없습니다.");
  }

  try {
    window.localStorage.setItem(WEB_MEMO_STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(WEB_MEMO_STORAGE_CHANGED_EVENT));
  } catch (error) {
    throw new Error(`localStorage 저장 실패: ${getErrorMessage(error)}`);
  }
}

function sortMemos(memos: Memo[]): Memo[] {
  return [...memos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export class LocalStorageMemoRepository implements MemoRepository {
  private readonly records = new Map<string, Memo>();

  constructor() {
    for (const memo of safeReadStorage()) {
      this.records.set(memo.id, memo);
    }
  }

  private persistRecords(records: Map<string, Memo>) {
    writeStorage(sortMemos(Array.from(records.values())));
  }

  private replaceRecords(records: Map<string, Memo>) {
    this.records.clear();
    for (const [id, memo] of records.entries()) {
      this.records.set(id, clone(memo));
    }
  }

  private refreshRecords() {
    const latestRecords = new Map<string, Memo>();
    for (const memo of safeReadStorage()) {
      latestRecords.set(memo.id, memo);
    }
    this.replaceRecords(latestRecords);
  }

  async listMemos(): Promise<Memo[]> {
    this.refreshRecords();
    return sortMemos(Array.from(this.records.values()).map((memo) => clone(memo)));
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    this.refreshRecords();
    const nextMemo = clone(memo);
    const nextRecords = new Map(this.records);
    nextRecords.set(nextMemo.id, nextMemo);
    this.persistRecords(nextRecords);
    this.replaceRecords(nextRecords);
    return clone(nextMemo);
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    this.refreshRecords();
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }

    const next = softDeleteMemo(found, deletedAt);
    const nextRecords = new Map(this.records);
    nextRecords.set(next.id, clone(next));
    this.persistRecords(nextRecords);
    this.replaceRecords(nextRecords);
    return clone(next);
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
    this.refreshRecords();
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot restore memo: memo not found (${id})`);
    }

    const next = {
      ...found,
      deletedAt: null,
      updatedAt: restoredAt,
      syncState: "queued" as const,
      windowState: {
        ...found.windowState,
        visible: true,
      },
    };

    const nextRecords = new Map(this.records);
    nextRecords.set(id, clone(next));
    this.persistRecords(nextRecords);
    this.replaceRecords(nextRecords);
    return clone(next);
  }
}
