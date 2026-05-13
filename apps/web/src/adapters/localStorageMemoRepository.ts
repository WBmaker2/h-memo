import { softDeleteMemo, type Memo, type MemoRepository } from "@h-memo/memo-core";

const STORAGE_KEY = "h-memo:web-memo-repository-v1";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMemo(value: unknown): value is Memo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const memo = value as Memo;
  return (
    typeof memo.id === "string" &&
    typeof memo.title === "string" &&
    typeof memo.plainText === "string" &&
    typeof memo.createdAt === "string" &&
    typeof memo.updatedAt === "string"
  );
}

function safeReadStorage(): Memo[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isMemo).map(clone);
  } catch {
    return [];
  }
}

function writeStorage(value: Memo[]) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // keep memory state only
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

  private persist() {
    writeStorage(sortMemos(Array.from(this.records.values())));
  }

  async listMemos(): Promise<Memo[]> {
    return sortMemos(Array.from(this.records.values()).map((memo) => clone(memo)));
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    const nextMemo = clone(memo);
    this.records.set(nextMemo.id, nextMemo);
    this.persist();
    return clone(nextMemo);
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }

    const next = softDeleteMemo(found, deletedAt);
    this.records.set(next.id, clone(next));
    this.persist();
    return clone(next);
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
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

    this.records.set(id, clone(next));
    this.persist();
    return clone(next);
  }
}
