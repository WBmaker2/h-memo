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

function shortHash(value: string | null): string {
  if (value === null) return "null";
  return value.length > 8 ? value.slice(0, 8) : value;
}

export function formatStartupVersionDiagnosis(input: {
  local: StartupLocalVersion;
  server: BackupSnapshotSummary | null;
  checkpoint: LocalSyncCheckpoint | null;
  decision: StartupVersionDecisionKind;
}): string {
  const { local, server, checkpoint, decision } = input;
  return [
    `decision=${decision}`,
    `local=${shortHash(local.contentHash)}`,
    `serverId=${server?.id ?? "null"}`,
    `server=${shortHash(server?.contentHash ?? null)}`,
    `checkpointId=${checkpoint?.snapshotId ?? "null"}`,
    `checkpoint=${shortHash(checkpoint?.contentHash ?? null)}`,
  ].join(" ");
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
    const serverChangedSinceCheckpoint =
      server.id !== checkpoint.snapshotId ||
      (server.contentHash !== null && server.contentHash !== checkpoint.contentHash);

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
