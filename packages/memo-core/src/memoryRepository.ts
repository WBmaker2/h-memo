import type { Memo, MemoRepository } from "./types";
import { softDeleteMemo as markSoftDelete } from "./memoFactory";

function cloneMemo(memo: Memo): Memo {
  return JSON.parse(JSON.stringify(memo)) as Memo;
}

export class MemoryMemoRepository implements MemoRepository {
  private readonly records = new Map<string, Memo>();

  constructor(initialMemos: Memo[] = []) {
    initialMemos.forEach((memo) => {
      this.records.set(memo.id, cloneMemo(memo));
    });
  }

  async listMemos(): Promise<Memo[]> {
    return Array.from(this.records.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((memo) => cloneMemo(memo));
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    const memoToSave = cloneMemo(memo);
    this.records.set(memoToSave.id, memoToSave);
    return cloneMemo(memoToSave);
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }

    const updated = cloneMemo(markSoftDelete(found, deletedAt));
    this.records.set(id, updated);
    return cloneMemo(updated);
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot restore memo: memo not found (${id})`);
    }

    const restored = {
      ...found,
      deletedAt: null,
      updatedAt: restoredAt,
      syncState: "queued" as const,
      windowState: {
        ...found.windowState,
        visible: true,
      },
    };

    const stored = cloneMemo(restored);
    this.records.set(id, stored);
    return cloneMemo(stored);
  }
}

export class MemoryRepository extends MemoryMemoRepository {}
