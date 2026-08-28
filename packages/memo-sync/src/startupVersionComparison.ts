import type { Memo } from "@h-memo/memo-core";
import type { BackupSnapshotSummary } from "./backupTypes";
import type { LocalSyncCheckpoint } from "./localSyncCheckpoint";

export type StartupLocalVersion = {
  contentHash: string | null;
  memoCount: number;
  latestUpdatedAt: string | null;
};

export type StartupVersionDecisionKind =
  | "no-server-backup"
  | "equal"
  | "local-newer"
  | "server-newer"
  | "conflict"
  | "unknown";

export type StartupVersionDecision = {
  kind: StartupVersionDecisionKind;
  server: BackupSnapshotSummary | null;
};

function isValidTimestamp(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value));
}

function compareTimestamp(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

export function getLatestMemoUpdatedAt(memos: Memo[]): string | null {
  return memos.reduce<string | null>((latest, memo) => {
    if (!isValidTimestamp(memo.updatedAt)) return latest;
    if (!latest || compareTimestamp(memo.updatedAt, latest) > 0) {
      return memo.updatedAt;
    }
    return latest;
  }, null);
}

export function compareStartupVersions(input: {
  local: StartupLocalVersion;
  server: BackupSnapshotSummary | null;
  checkpoint: LocalSyncCheckpoint | null;
}): StartupVersionDecision {
  const { local, server, checkpoint } = input;

  if (!server) {
    return { kind: "no-server-backup", server: null };
  }

  if (
    local.contentHash !== null &&
    server.contentHash !== null &&
    local.contentHash === server.contentHash
  ) {
    return { kind: "equal", server };
  }

  if (checkpoint && checkpoint.userId.trim() !== "") {
    const localMatchesCheckpoint = local.contentHash === checkpoint.contentHash;
    const serverChangedSinceCheckpoint = server.id !== checkpoint.snapshotId;

    if (localMatchesCheckpoint && !serverChangedSinceCheckpoint) {
      return { kind: "equal", server };
    }
    if (localMatchesCheckpoint && serverChangedSinceCheckpoint) {
      return { kind: "server-newer", server };
    }
    if (!localMatchesCheckpoint && !serverChangedSinceCheckpoint) {
      return { kind: "local-newer", server };
    }
    if (!localMatchesCheckpoint && serverChangedSinceCheckpoint) {
      return { kind: "conflict", server };
    }

    return { kind: "unknown", server };
  }

  if (!isValidTimestamp(server.savedAt)) {
    return { kind: "unknown", server };
  }

  if (local.latestUpdatedAt === null) {
    return { kind: "server-newer", server };
  }

  return {
    kind:
      compareTimestamp(server.savedAt, local.latestUpdatedAt) > 0
        ? "server-newer"
        : "local-newer",
    server,
  };
}
