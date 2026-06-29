import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  backupMemos,
  deleteBackedUpMemo,
  listBackupSnapshots,
  listBackedUpMemos,
  type BackupGateway,
  type MemoBackupPayload,
  restoreLatestBackup,
} from "./backup";

class FakeBackupGateway implements BackupGateway {
  private snapshots: Array<{ path: string; payload: MemoBackupPayload }> = [];
  private deletedMemoIdsByUser = new Map<string, Set<string>>();
  private counter = 1;

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const path = `users/${userId}/backupSnapshots/${this.counter}`;
    this.snapshots.push({ path, payload });
    this.counter += 1;
    for (const memo of payload.memos) {
      if (memo.deletedAt === null) {
        this.deletedMemoIdsByUser.get(userId)?.delete(memo.id);
      }
    }
    return path;
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    const filtered = this.snapshots.filter((snapshot) =>
      snapshot.path.startsWith(`users/${userId}/backupSnapshots/`)
    );
    const latest = filtered[filtered.length - 1];
    return latest ? latest.payload : null;
  }

  async loadBackups(userId: string): Promise<unknown[]> {
    return this.snapshots
      .filter((snapshot) => snapshot.path.startsWith(`users/${userId}/backupSnapshots/`))
      .map((snapshot) => snapshot.payload)
      .reverse();
  }

  async loadDeletedMemoIds(userId: string): Promise<string[]> {
    return [...(this.deletedMemoIdsByUser.get(userId) ?? new Set<string>())];
  }

  async deleteMemoFromBackups(userId: string, memoId: string): Promise<number> {
    const deletedMemoIds = this.deletedMemoIdsByUser.get(userId) ?? new Set<string>();
    deletedMemoIds.add(memoId);
    this.deletedMemoIdsByUser.set(userId, deletedMemoIds);
    return 1;
  }
}

describe("memo-sync backup", () => {
  it("백업 저장 시 버전이 포함된 payload를 저장하고 예상 경로를 반환한다", async () => {
    const gateway = new FakeBackupGateway();
    const memos = [createMemo({ id: "memo-1", now: "2026-05-13T09:00:00.000Z" })];

    const result = await backupMemos(
      gateway,
      "user-1",
      memos,
      "2026-05-13T09:05:00.000Z"
    );

    expect(result.path).toBe("users/user-1/backupSnapshots/1");
    expect(result.payload.version).toBe(1);
    expect(result.payload.userId).toBe("user-1");
    expect(result.payload.createdAt).toBe("2026-05-13T09:05:00.000Z");
    expect(result.payload.memos).toEqual(memos);
  });

  it("복구 시 최신 백업 payload를 검증 후 반환한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";

    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-old", now: "2026-05-13T09:00:00.000Z" })],
      "2026-05-13T09:01:00.000Z"
    );
    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-new", now: "2026-05-13T09:02:00.000Z" })],
      "2026-05-13T09:03:00.000Z"
    );

    const restored = await restoreLatestBackup(gateway, userId);

    expect(restored).not.toBeNull();
    expect(restored?.version).toBe(1);
    expect(restored?.memos[0]?.id).toBe("memo-new");
  });

  it("시간대별 백업 스냅샷 목록을 최신순으로 반환하고 서버 삭제 표시를 적용한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const keepMemo = createMemo({
      id: "memo-keep",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "계속 유지할 메모",
    });
    const removedMemo = createMemo({
      id: "memo-removed",
      now: "2026-05-13T09:01:00.000Z",
      plainText: "서버에서 삭제할 메모",
    });

    await backupMemos(gateway, userId, [keepMemo, removedMemo], "2026-05-13T09:02:00.000Z");
    await backupMemos(
      gateway,
      userId,
      [{ ...keepMemo, plainText: "나중 백업", updatedAt: "2026-05-13T09:10:00.000Z" }],
      "2026-05-13T09:11:00.000Z"
    );
    await deleteBackedUpMemo(gateway, userId, "memo-removed");

    const snapshots = await listBackupSnapshots(gateway, userId);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.createdAt).toBe("2026-05-13T09:11:00.000Z");
    expect(snapshots[0]?.memoCount).toBe(1);
    expect(snapshots[0]?.payload.memos.map((memo) => memo.id)).toEqual(["memo-keep"]);
    expect(snapshots[1]?.createdAt).toBe("2026-05-13T09:02:00.000Z");
    expect(snapshots[1]?.memoCount).toBe(1);
    expect(snapshots[1]?.payload.memos.map((memo) => memo.id)).toEqual(["memo-keep"]);
  });

  it("최신 payload가 잘못되면 에러를 던진다", async () => {
    class InvalidPayloadGateway implements BackupGateway {
      async saveBackup(): Promise<string> {
        return "";
      }

      async loadLatestBackup(): Promise<unknown | null> {
        return {
          version: 2,
          userId: "user-1",
          createdAt: "2026-05-13T09:00:00.000Z",
          memos: [],
        };
      }

      async loadBackups(): Promise<unknown[]> {
        return [];
      }

      async loadDeletedMemoIds(): Promise<string[]> {
        return [];
      }

      async deleteMemoFromBackups(): Promise<number> {
        return 0;
      }
    }

    const gateway = new InvalidPayloadGateway();
    await expect(restoreLatestBackup(gateway, "user-1")).rejects.toThrow(
      "지원하지 않는 백업 버전입니다."
    );
  });

  it("서버 백업 목록에서 메모별 최신본을 모아 반환한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const olderMemo = createMemo({
      id: "memo-keep",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "이전 내용",
    });
    const newerMemo = {
      ...olderMemo,
      plainText: "최신 내용",
      updatedAt: "2026-05-13T09:10:00.000Z",
    };
    const deletedMemo = createMemo({
      id: "memo-deleted",
      now: "2026-05-13T09:05:00.000Z",
      plainText: "삭제됐지만 백업된 메모",
    });

    await backupMemos(gateway, userId, [olderMemo], "2026-05-13T09:01:00.000Z");
    await backupMemos(
      gateway,
      userId,
      [{ ...deletedMemo, deletedAt: "2026-05-13T09:06:00.000Z" }, newerMemo],
      "2026-05-13T09:11:00.000Z"
    );

    const backedUpMemos = await listBackedUpMemos(gateway, userId);

    expect(backedUpMemos).toHaveLength(2);
    expect(backedUpMemos[0]?.memo.id).toBe("memo-keep");
    expect(backedUpMemos[0]?.memo.plainText).toBe("최신 내용");
    expect(backedUpMemos[1]?.memo.id).toBe("memo-deleted");
    expect(backedUpMemos[1]?.backupCreatedAt).toBe("2026-05-13T09:11:00.000Z");
  });

  it("서버 삭제한 메모를 서버 백업 목록에서 제외한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const keepMemo = createMemo({ id: "memo-keep", now: "2026-05-13T09:00:00.000Z" });
    const removeMemo = createMemo({ id: "memo-remove", now: "2026-05-13T09:01:00.000Z" });

    await backupMemos(gateway, userId, [keepMemo, removeMemo], "2026-05-13T09:02:00.000Z");
    await backupMemos(gateway, userId, [removeMemo], "2026-05-13T09:03:00.000Z");

    const updatedCount = await deleteBackedUpMemo(gateway, userId, "memo-remove");
    const backedUpMemos = await listBackedUpMemos(gateway, userId);

    expect(updatedCount).toBe(1);
    expect(backedUpMemos.map((item) => item.memo.id)).toEqual(["memo-keep"]);
  });

  it("서버 삭제한 메모는 최신 전체 복원에서도 제외한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const keepMemo = createMemo({ id: "memo-keep", now: "2026-05-13T09:00:00.000Z" });
    const removeMemo = createMemo({ id: "memo-remove", now: "2026-05-13T09:01:00.000Z" });

    await backupMemos(gateway, userId, [keepMemo, removeMemo], "2026-05-13T09:02:00.000Z");

    await deleteBackedUpMemo(gateway, userId, "memo-remove");
    const restored = await restoreLatestBackup(gateway, userId);

    expect(restored?.memos.map((memo) => memo.id)).toEqual(["memo-keep"]);
  });

  it("보이는 로컬 메모를 다시 백업하면 서버 삭제 표시를 해제한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const memo = createMemo({ id: "memo-restore", now: "2026-05-13T09:00:00.000Z" });

    await backupMemos(gateway, userId, [memo], "2026-05-13T09:01:00.000Z");
    await deleteBackedUpMemo(gateway, userId, "memo-restore");
    expect(await listBackedUpMemos(gateway, userId)).toEqual([]);

    await backupMemos(
      gateway,
      userId,
      [{ ...memo, plainText: "다시 백업", updatedAt: "2026-05-13T09:02:00.000Z" }],
      "2026-05-13T09:03:00.000Z"
    );

    const backedUpMemos = await listBackedUpMemos(gateway, userId);
    expect(backedUpMemos.map((item) => item.memo.id)).toEqual(["memo-restore"]);
  });

  it("내용이 비어 있고 로컬 삭제 기록이 있는 서버 메모도 id 기준으로 제거한다", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const blankDeletedMemo = {
      ...createMemo({
        id: "memo-blank",
        now: "2026-05-13T09:00:00.000Z",
        plainText: "",
      }),
      deletedAt: "2026-05-13T09:05:00.000Z",
    };

    await backupMemos(gateway, userId, [blankDeletedMemo], "2026-05-13T09:06:00.000Z");

    const updatedCount = await deleteBackedUpMemo(gateway, userId, "memo-blank");
    const backedUpMemos = await listBackedUpMemos(gateway, userId);

    expect(updatedCount).toBe(1);
    expect(backedUpMemos).toEqual([]);
  });
});
