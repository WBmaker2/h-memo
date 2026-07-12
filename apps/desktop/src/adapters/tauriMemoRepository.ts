import { invoke } from "@tauri-apps/api/core";
import { softDeleteMemo, type Memo, type MemoRepository } from "@h-memo/memo-core";

type TauriMemoRecord = Omit<Memo, "windowState" | "style" | "richContent"> & {
  windowState: Memo["windowState"];
  style: Memo["style"];
  richContent: Memo["richContent"];
};

export class TauriMemoRepository implements MemoRepository {
  private restoreToken: string | null = null;
  private assertRestoreActive: (() => void) | null = null;

  async withRestoreToken<T>(
    token: string,
    operation: () => Promise<T>,
    assertActive: () => void = () => {}
  ): Promise<T> {
    if (this.restoreToken !== null) {
      throw new Error("이미 다른 복원 저장 범위가 진행 중입니다.");
    }

    this.restoreToken = token;
    this.assertRestoreActive = assertActive;
    try {
      assertActive();
      return await operation();
    } finally {
      this.restoreToken = null;
      this.assertRestoreActive = null;
    }
  }

  async listMemos(): Promise<Memo[]> {
    const records = await invoke<TauriMemoRecord[]>("list_memos");
    return records;
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    this.assertRestoreActive?.();
    const args = this.restoreToken
      ? { memo, restoreToken: this.restoreToken }
      : { memo };
    const saved = await invoke<TauriMemoRecord>("save_memo", args);
    return saved;
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const all = await this.listMemos();
    const current = all.find((memo) => memo.id === id);
    if (!current) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }
    const next = softDeleteMemo(current, deletedAt);
    return this.saveMemo(next);
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
    const all = await this.listMemos();
    const current = all.find((memo) => memo.id === id);
    if (!current) {
      throw new Error(`Cannot restore memo: memo not found (${id})`);
    }

    const next: Memo = {
      ...current,
      deletedAt: null,
      updatedAt: restoredAt,
      syncState: "queued",
      windowState: {
        ...current.windowState,
        visible: true,
      },
    };

    return this.saveMemo(next);
  }
}
