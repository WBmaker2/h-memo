import type { Memo, MemoRepository } from "./types";
import { softDeleteMemo as markSoftDelete } from "./memoFactory";

export class MemoryMemoRepository implements MemoRepository {
  private readonly records = new Map<string, Memo>();

  async listMemos(): Promise<Memo[]> {
    return Array.from(this.records.values());
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    const memoToSave = { ...memo };
    this.records.set(memoToSave.id, memoToSave);
    return memoToSave;
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const found = this.records.get(id);
    if (!found) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }

    const updated = markSoftDelete(found, deletedAt);
    this.records.set(id, updated);
    return updated;
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

    this.records.set(id, restored);
    return restored;
  }
}

export class MemoryRepository extends MemoryMemoRepository {}
