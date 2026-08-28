import { useCallback, useEffect, useRef, useState } from "react";

import * as memoSync from "@h-memo/memo-sync";
import type {
  BackupGateway,
  BackupSnapshotSummary,
  MemoBackupPayload,
} from "@h-memo/memo-sync";
import { createBackupPayload, type Memo, type MemoRepository } from "@h-memo/memo-core";

export type WebStartupRestoreDialogData = {
  local: {
    memoCount: number;
    updatedAt: string | null;
  };
  server: BackupSnapshotSummary;
};

export type WebStartupRestorePhase =
  | "idle"
  | "checking"
  | "prompting"
  | "restoring"
  | "ready"
  | "declined"
  | "conflict"
  | "error";

type StartupServices = { gateway: BackupGateway };

type StartupBaseline = {
  snapshotId: string | null;
  contentHash: string | null;
  localFingerprint: string | null;
};

export type UseWebStartupServerRestoreOptions = {
  user: { uid: string } | null;
  isServerReady: boolean;
  hasLoadedMemos: boolean;
  repository: MemoRepository;
  storage: Storage | null;
  getServices: () => StartupServices | null;
  getLatestServerSummary: (
    gateway: BackupGateway,
    userId: string,
  ) => Promise<BackupSnapshotSummary | null>;
  getLocalFingerprint: (memos: Memo[]) => string;
  restoreServerMemos: (userId: string, payload: MemoBackupPayload) => Promise<void>;
  onStatus: (message: string) => void;
};

function createHashPayload(userId: string, memos: Memo[]) {
  return createBackupPayload({
    userId,
    memos,
    createdAt: "1970-01-01T00:00:00.000Z",
  });
}

async function createStartupContentHash(userId: string, memos: Memo[]): Promise<string> {
  const payload = createHashPayload(userId, memos);
  if (typeof memoSync.createBackupContentHash === "function") {
    return memoSync.createBackupContentHash(payload);
  }

  // Keep test doubles and older integrations usable when the optional hash export
  // is not present. Production builds always provide the SHA-256 implementation.
  return JSON.stringify(payload.memos);
}

function readStartupCheckpoint(storage: Storage | null, userId: string) {
  if (typeof memoSync.readLocalSyncCheckpoint !== "function") return null;
  return memoSync.readLocalSyncCheckpoint(storage, userId);
}

function writeStartupCheckpoint(
  storage: Storage | null,
  input: Parameters<typeof memoSync.createLocalSyncCheckpoint>[0],
) {
  if (
    typeof memoSync.createLocalSyncCheckpoint !== "function" ||
    typeof memoSync.writeLocalSyncCheckpoint !== "function"
  ) {
    return;
  }
  memoSync.writeLocalSyncCheckpoint(storage, memoSync.createLocalSyncCheckpoint(input));
}

export function useWebStartupServerRestore(
  options: UseWebStartupServerRestoreOptions
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [phase, setPhase] = useState<WebStartupRestorePhase>("idle");
  const [dialog, setDialog] = useState<WebStartupRestoreDialogData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<StartupBaseline>({
    snapshotId: null,
    contentHash: null,
    localFingerprint: null,
  });
  const checkedUserRef = useRef<string | null>(null);
  const operationRef = useRef(0);

  const setReadyBaseline = useCallback((input: {
    snapshot: BackupSnapshotSummary | null;
    contentHash: string;
    localFingerprint: string;
  }) => {
    setBaseline({
      snapshotId: input.snapshot?.id ?? null,
      contentHash: input.contentHash,
      localFingerprint: input.localFingerprint,
    });
    setPhase("ready");
  }, []);

  useEffect(() => {
    const { user, isServerReady, hasLoadedMemos } = options;
    if (!user) {
      operationRef.current += 1;
      checkedUserRef.current = null;
      setDialog(null);
      setErrorMessage(null);
      setPhase("idle");
      return;
    }
    if (!isServerReady || !hasLoadedMemos || checkedUserRef.current === user.uid) {
      return;
    }

    checkedUserRef.current = user.uid;
    const operation = ++operationRef.current;
    setPhase("checking");
    setDialog(null);
    setErrorMessage(null);

    void (async () => {
      try {
        const services = optionsRef.current.getServices();
        if (!services) {
          setReadyBaseline({
            snapshot: null,
            contentHash: "",
            localFingerprint: "",
          });
          return;
        }

        const localMemos = await optionsRef.current.repository.listMemos();
        const localHash = await createStartupContentHash(user.uid, localMemos);
        const server = await optionsRef.current.getLatestServerSummary(services.gateway, user.uid);
        if (operation !== operationRef.current) return;

        const decision = memoSync.compareStartupVersions({
          local: {
            contentHash: localHash,
            memoCount: localMemos.filter((memo) => memo.deletedAt === null).length,
            latestUpdatedAt: memoSync.getLatestMemoUpdatedAt(localMemos),
          },
          server,
          checkpoint: readStartupCheckpoint(optionsRef.current.storage, user.uid),
        });

        if (decision.kind === "server-newer" && server) {
          setBaseline({
            snapshotId: server.id,
            contentHash: localHash,
            localFingerprint: optionsRef.current.getLocalFingerprint(localMemos),
          });
          setDialog({
            local: {
              memoCount: localMemos.filter((memo) => memo.deletedAt === null).length,
              updatedAt: memoSync.getLatestMemoUpdatedAt(localMemos),
            },
            server,
          });
          setPhase("prompting");
          return;
        }

        if (decision.kind === "conflict") {
          setPhase("conflict");
          optionsRef.current.onStatus(
            "로컬과 서버가 모두 변경되었습니다. 자동 백업을 중지했으니 백업 기록에서 비교 후 복원해 주세요."
          );
          return;
        }

        if (decision.kind === "unknown") {
          setPhase("error");
          optionsRef.current.onStatus(
            "서버 최신본의 시각을 확인할 수 없습니다. 자동 복원을 하지 않고 로컬 메모를 유지합니다."
          );
          return;
        }

        if (decision.kind === "equal" && server) {
          writeStartupCheckpoint(optionsRef.current.storage, {
            userId: user.uid,
            snapshotId: server.id,
            contentHash: localHash,
            serverSavedAt: server.savedAt,
          });
        }

        setReadyBaseline({
          snapshot: server,
          contentHash: localHash,
          localFingerprint: optionsRef.current.getLocalFingerprint(localMemos),
        });
      } catch (error) {
        if (operation !== operationRef.current) return;
        checkedUserRef.current = null;
        setPhase("error");
        optionsRef.current.onStatus(
          `최신 서버 메모 확인 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
        );
      }
    })();
  }, [options.hasLoadedMemos, options.isServerReady, options.user?.uid, setReadyBaseline]);

  const decline = useCallback(() => {
    if (phase !== "prompting") return;
    setDialog(null);
    setErrorMessage(null);
    setPhase("declined");
    optionsRef.current.onStatus(
      "서버 메모는 유지하고 로컬 메모를 계속 사용합니다. 이번 실행에서는 자동 백업을 잠시 중지했습니다."
    );
  }, [phase]);

  const accept = useCallback(() => {
    if (phase !== "prompting" || !dialog) return;
    const operation = ++operationRef.current;
    setPhase("restoring");
    setErrorMessage(null);

    void (async () => {
      try {
        const currentOptions = optionsRef.current;
        const userId = currentOptions.user?.uid;
        const services = currentOptions.getServices();
        if (!userId || !services) throw new Error("서버 백업 세션이 준비되지 않았습니다.");

        const localMemos = await currentOptions.repository.listMemos();
        const localHash = await createStartupContentHash(userId, localMemos);
        const latestServer = await currentOptions.getLatestServerSummary(services.gateway, userId);
        const decision = memoSync.compareStartupVersions({
          local: {
            contentHash: localHash,
            memoCount: localMemos.filter((memo) => memo.deletedAt === null).length,
            latestUpdatedAt: memoSync.getLatestMemoUpdatedAt(localMemos),
          },
          server: latestServer,
          checkpoint: readStartupCheckpoint(currentOptions.storage, userId),
        });

        if (operation !== operationRef.current || currentOptions.user?.uid !== userId) {
          return;
        }

        if (decision.kind !== "server-newer" || !latestServer) {
          setDialog(null);
          if (decision.kind === "conflict") {
            setPhase("conflict");
          } else {
            setReadyBaseline({
              snapshot: latestServer,
              contentHash: localHash,
              localFingerprint: currentOptions.getLocalFingerprint(localMemos),
            });
          }
          if (decision.kind === "conflict") {
            currentOptions.onStatus("서버 확인 중 로컬과 서버가 모두 변경되었습니다. 복원을 중단했습니다.");
          }
          return;
        }

        const payload = await memoSync.loadBackupSnapshot(services.gateway, userId, latestServer.id);
        if (!payload) throw new Error("최신 서버 메모를 불러오지 못했습니다.");
        if (operation !== operationRef.current || optionsRef.current.user?.uid !== userId) {
          return;
        }
        await currentOptions.restoreServerMemos(userId, payload);
        if (operation !== operationRef.current || optionsRef.current.user?.uid !== userId) {
          return;
        }
        const restoredHash = await createStartupContentHash(userId, payload.memos);
        writeStartupCheckpoint(currentOptions.storage, {
          userId,
          snapshotId: latestServer.id,
          contentHash: restoredHash,
          serverSavedAt: latestServer.savedAt,
        });
        if (operation !== operationRef.current) return;
        setDialog(null);
        setErrorMessage(null);
        setReadyBaseline({
          snapshot: latestServer,
          contentHash: restoredHash,
          localFingerprint: currentOptions.getLocalFingerprint(payload.memos),
        });
        currentOptions.onStatus(`최신 서버 메모 ${payload.memos.length}개를 불러왔습니다.`);
      } catch (error) {
        if (operation !== operationRef.current) return;
        setPhase("prompting");
        setErrorMessage(error instanceof Error ? error.message : "최신 서버 메모를 불러오지 못했습니다.");
        optionsRef.current.onStatus("최신 서버 메모를 불러오지 못했습니다. 다시 시도해 주세요.");
      }
    })();
  }, [dialog, phase, setReadyBaseline]);

  return {
    phase,
    dialog,
    errorMessage,
    isBusy: phase === "checking" || phase === "restoring",
    isReadyForAutoBackup:
      phase === "ready" && checkedUserRef.current === options.user?.uid,
    isAutoBackupPaused:
      phase === "checking" ||
      phase === "prompting" ||
      phase === "restoring" ||
      phase === "declined" ||
      phase === "conflict" ||
      phase === "error",
    baseline,
    accept,
    decline,
  };
}
