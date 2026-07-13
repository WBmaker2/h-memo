import { createMemo, type Memo } from "@h-memo/memo-core";
import { describe, expect, it } from "vitest";
import type { MemoBackupPayload } from "./backupTypes";
import {
  createBackupContentHash,
  createBackupPreviewText,
} from "./backupFingerprint";

function payloadWith(input: {
  createdAt?: string;
  memos?: Memo[];
  order?: string[];
  text?: string;
} = {}): MemoBackupPayload {
  const memos = input.memos ?? [
    createMemo({ id: "a", now: "2026-07-13T00:00:00.000Z", plainText: input.text ?? "첫 내용" }),
    createMemo({ id: "b", now: "2026-07-13T00:00:00.000Z", plainText: "둘째 내용" }),
  ];
  const byId = new Map(memos.map((memo) => [memo.id, memo]));

  return {
    version: 1,
    userId: "user-1",
    createdAt: input.createdAt ?? "2026-07-13T00:00:00.000Z",
    memos: (input.order ?? memos.map((memo) => memo.id)).map((id) => byId.get(id)!).filter(Boolean),
  };
}

describe("backup content fingerprints", () => {
  it("ignores payload time, memo order, and syncState while hashing stored content", async () => {
    const first = payloadWith({ createdAt: "2026-07-13T01:00:00.000Z", order: ["a", "b"] });
    const second = payloadWith({ createdAt: "2026-07-13T10:00:00.000Z", order: ["b", "a"] });
    second.memos[0]!.syncState = "backed-up";

    expect(await createBackupContentHash(first)).toBe(await createBackupContentHash(second));
  });

  it("ignores deleted memos because only stored memos are restored", async () => {
    const deletedMemo = createMemo({ id: "deleted", now: "2026-07-13T00:00:00.000Z", plainText: "삭제됨" });
    deletedMemo.deletedAt = "2026-07-13T01:00:00.000Z";
    const first = payloadWith({ memos: [...payloadWith().memos, deletedMemo] });
    const changedDeletedMemo = { ...deletedMemo, plainText: "삭제된 메모의 변경" };
    const second = payloadWith({ memos: [...payloadWith().memos, changedDeletedMemo] });

    expect(await createBackupContentHash(first)).toBe(await createBackupContentHash(second));
    expect(createBackupPreviewText(first)).not.toContain("삭제됨");
  });

  it("changes the hash when restorable memo content changes", async () => {
    const first = payloadWith({ text: "첫 내용" });
    const second = payloadWith({ text: "바뀐 내용" });

    expect(await createBackupContentHash(first)).not.toBe(await createBackupContentHash(second));
  });

  it("changes the hash when another restorable memo field changes", async () => {
    const first = payloadWith();
    const secondMemo = { ...first.memos[0]!, title: "바뀐 제목" };
    const second = payloadWith({ memos: [secondMemo, first.memos[1]!] });

    expect(await createBackupContentHash(first)).not.toBe(await createBackupContentHash(second));
  });

  it("limits the metadata preview to 240 characters", () => {
    expect(createBackupPreviewText(payloadWith({ text: "가".repeat(400) })).length).toBeLessThanOrEqual(240);
  });
});
