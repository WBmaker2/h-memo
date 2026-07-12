import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemo } from "@h-memo/memo-core";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("TauriMemoRepository", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("does not pass a restore token for an ordinary save", async () => {
    const { TauriMemoRepository } = await import("./tauriMemoRepository");
    const memo = createMemo({ id: "memo-normal", now: "2026-07-12T09:00:00.000Z" });
    mockInvoke.mockResolvedValue(memo);

    await new TauriMemoRepository().saveMemo(memo);

    expect(mockInvoke).toHaveBeenCalledWith("save_memo", { memo });
  });

  it("passes the scoped restore token to save and clears it after the callback settles", async () => {
    const { TauriMemoRepository } = await import("./tauriMemoRepository");
    const memo = createMemo({ id: "memo-restore", now: "2026-07-12T09:00:00.000Z" });
    mockInvoke.mockResolvedValue(memo);
    const repository = new TauriMemoRepository();

    await repository.withRestoreToken("restore-token", () => repository.saveMemo(memo));
    await repository.saveMemo(memo);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "save_memo", {
      memo,
      restoreToken: "restore-token",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "save_memo", { memo });
  });

  it("clears the scoped restore token when the locked callback fails", async () => {
    const { TauriMemoRepository } = await import("./tauriMemoRepository");
    const memo = createMemo({ id: "memo-failure", now: "2026-07-12T09:00:00.000Z" });
    mockInvoke.mockResolvedValue(memo);
    const repository = new TauriMemoRepository();

    await expect(
      repository.withRestoreToken("restore-token", async () => {
        await repository.saveMemo(memo);
        throw new Error("replacement failed");
      })
    ).rejects.toThrow("replacement failed");
    await repository.saveMemo(memo);

    expect(mockInvoke).toHaveBeenLastCalledWith("save_memo", { memo });
  });
});
