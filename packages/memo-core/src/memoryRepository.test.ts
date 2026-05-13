import { describe, expect, it } from "vitest";
import { createMemo, updateMemoStyle } from "./memoFactory";
import { MemoryMemoRepository } from "./memoryRepository";

describe("memoryMemoRepository", () => {
  it("loads initial memos from constructor", async () => {
    const initialMemos = [
      { ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }) },
      { ...createMemo({ now: "2026-05-13T09:01:00.000Z", id: "memo-2" }) },
    ];
    const repo = new MemoryMemoRepository(initialMemos);

    const memos = await repo.listMemos();

    expect(memos).toHaveLength(2);
    expect(memos.map((memo) => memo.id)).toEqual(["memo-2", "memo-1"]);
  });

  it("returns memos ordered by updatedAt descending", async () => {
    const older = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const newer = createMemo({ now: "2026-05-13T09:10:00.000Z", id: "memo-2" });
    const repo = new MemoryMemoRepository([older, newer]);

    const sorted = await repo.listMemos();

    expect(sorted[0].id).toBe("memo-2");
    expect(sorted[1].id).toBe("memo-1");
  });

  it("keeps order updated when save updates updatedAt", async () => {
    const repo = new MemoryMemoRepository([
      createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      createMemo({ now: "2026-05-13T09:01:00.000Z", id: "memo-2" }),
    ]);

    const newerMemo = updateMemoStyle(
      createMemo({ now: "2026-05-13T09:05:00.000Z", id: "memo-1" }),
      { fontSize: 24 },
      "2026-05-13T09:20:00.000Z"
    );
    await repo.saveMemo(newerMemo);
    const sorted = await repo.listMemos();

    expect(sorted[0].id).toBe("memo-1");
  });
});
