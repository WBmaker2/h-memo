import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  backupMemos,
  type BackupGateway,
  type MemoBackupPayload,
  restoreLatestBackup,
} from "./backup";

class FakeBackupGateway implements BackupGateway {
  private snapshots: Array<{ path: string; payload: MemoBackupPayload }> = [];
  private counter = 1;

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const path = `users/${userId}/backupSnapshots/${this.counter}`;
    this.snapshots.push({ path, payload });
    this.counter += 1;
    return path;
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    const filtered = this.snapshots.filter((snapshot) =>
      snapshot.path.startsWith(`users/${userId}/backupSnapshots/`)
    );
    const latest = filtered[filtered.length - 1];
    return latest ? latest.payload : null;
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
    }

    const gateway = new InvalidPayloadGateway();
    await expect(restoreLatestBackup(gateway, "user-1")).rejects.toThrow(
      "지원하지 않는 백업 버전입니다."
    );
  });
});
