import { describe, expect, it } from "vitest";

import type { BackupSnapshotSummary } from "./backupTypes";
import {
  compareStartupVersions,
  getLatestMemoUpdatedAt,
  type StartupLocalVersion,
} from "./startupVersionComparison";
import type { LocalSyncCheckpoint } from "./localSyncCheckpoint";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function server(overrides: Partial<BackupSnapshotSummary> = {}): BackupSnapshotSummary {
  return {
    id: "snapshot-2",
    savedAt: "2026-08-28T02:00:00.000Z",
    kstDate: "2026-08-28",
    memoCount: 2,
    previewText: "메모",
    contentHash: HASH_B,
    schemaVersion: 3,
    state: "complete",
    legacyUndated: false,
    ...overrides,
  };
}

function local(overrides: Partial<StartupLocalVersion> = {}): StartupLocalVersion {
  return {
    contentHash: HASH_A,
    memoCount: 2,
    latestUpdatedAt: "2026-08-28T01:00:00.000Z",
    ...overrides,
  };
}

function checkpoint(overrides: Partial<LocalSyncCheckpoint> = {}): LocalSyncCheckpoint {
  return {
    version: 1,
    userId: "user-1",
    snapshotId: "snapshot-1",
    contentHash: HASH_A,
    serverSavedAt: "2026-08-28T01:00:00.000Z",
    recordedAt: "2026-08-28T01:00:00.000Z",
    ...overrides,
  };
}

describe("startup version comparison", () => {
  it("keeps local-only users out of the restore prompt", () => {
    expect(compareStartupVersions({ local: local(), server: null, checkpoint: null })).toMatchObject({
      kind: "no-server-backup",
    });
  });

  it("treats equal content hashes as the same version", () => {
    expect(
      compareStartupVersions({
        local: local({ contentHash: HASH_B }),
        server: server(),
        checkpoint: checkpoint(),
      })
    ).toMatchObject({ kind: "equal" });
  });

  it("detects a server-only change from the checkpoint", () => {
    expect(
      compareStartupVersions({ local: local(), server: server(), checkpoint: checkpoint() })
    ).toMatchObject({ kind: "server-newer" });
  });

  it("treats a matching checkpoint and unchanged server ID as equal even without a server hash", () => {
    expect(
      compareStartupVersions({
        local: local(),
        server: server({ id: "snapshot-1", contentHash: null }),
        checkpoint: checkpoint(),
      })
    ).toMatchObject({ kind: "equal" });
  });

  it("detects a local-only change when the server snapshot is unchanged", () => {
    expect(
      compareStartupVersions({
        local: local({ contentHash: HASH_B }),
        server: server({ id: "snapshot-1", contentHash: HASH_A }),
        checkpoint: checkpoint(),
      })
    ).toMatchObject({ kind: "local-newer" });
  });

  it("stops automatic replacement when both sides changed", () => {
    expect(
      compareStartupVersions({
        local: local({ contentHash: HASH_B }),
        server: server({ contentHash: HASH_C }),
        checkpoint: checkpoint(),
      })
    ).toMatchObject({ kind: "conflict" });
  });

  it("uses timestamps only when no checkpoint or server hash exists", () => {
    expect(
      compareStartupVersions({
        local: local({ contentHash: null }),
        server: server({ contentHash: null }),
        checkpoint: null,
      })
    ).toMatchObject({ kind: "server-newer" });
    expect(
      compareStartupVersions({
        local: local({ contentHash: null, latestUpdatedAt: "2026-08-28T03:00:00.000Z" }),
        server: server({ contentHash: null }),
        checkpoint: null,
      })
    ).toMatchObject({ kind: "local-newer" });
  });

  it("does not make an automatic decision for undated legacy snapshots", () => {
    expect(
      compareStartupVersions({
        local: local({ contentHash: null }),
        server: server({ contentHash: null, savedAt: null, legacyUndated: true }),
        checkpoint: null,
      })
    ).toMatchObject({ kind: "unknown" });
  });

  it("includes soft-deleted memos when finding the local latest edit", () => {
    expect(
      getLatestMemoUpdatedAt([
        {
          id: "active",
          title: "",
          plainText: "",
          richContent: null,
          style: {
            backgroundColor: "#fff",
            textColor: "#111",
            fontFamily: "sans-serif",
            fontSize: 16,
          },
          windowState: {
            x: null,
            y: null,
            width: 320,
            height: 280,
            visible: true,
            alwaysOnTop: false,
          },
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T01:00:00.000Z",
          deletedAt: null,
          syncState: "local-only",
        },
        {
          id: "deleted",
          title: "",
          plainText: "",
          richContent: null,
          style: {
            backgroundColor: "#fff",
            textColor: "#111",
            fontFamily: "sans-serif",
            fontSize: 16,
          },
          windowState: {
            x: null,
            y: null,
            width: 320,
            height: 280,
            visible: true,
            alwaysOnTop: false,
          },
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T04:00:00.000Z",
          deletedAt: "2026-08-28T04:00:00.000Z",
          syncState: "local-only",
        },
      ])
    ).toBe("2026-08-28T04:00:00.000Z");
  });
});
