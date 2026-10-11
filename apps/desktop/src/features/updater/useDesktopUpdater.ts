import { useCallback, useEffect, useRef, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import {
  readUpdateSnoozeUntil,
  saveUpdateSnooze,
  type UpdateSnoozePeriod,
} from "./updateSnooze";

export type DesktopUpdaterPhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "installing"
  | "error"
  | "installed"
  | "dismissed";

export type DesktopUpdateDetails = {
  version: string;
  currentVersion: string;
  releaseNotes: string | null;
  releaseDate: string | null;
};

export type DesktopUpdaterState = {
  phase: DesktopUpdaterPhase;
  update: DesktopUpdateDetails | null;
  downloadedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
};

export type UseDesktopUpdaterOptions = {
  enabled: boolean;
  blocked: boolean;
  beforeInstall?: () => Promise<void>;
};

const INITIAL_STATE: DesktopUpdaterState = {
  phase: "idle",
  update: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
};

const INSTALL_ERROR_MESSAGE =
  "업데이트를 설치하지 못했습니다. 인터넷 연결과 Windows 권한을 확인한 뒤 다시 시도해 주세요.";
const INSTALL_BLOCKED_MESSAGE =
  "복원 또는 시작 확인 중에는 업데이트를 설치할 수 없습니다. 메모 저장과 복원이 끝난 뒤 다시 시도해 주세요.";
const PERSIST_FAILED_MESSAGE =
  "저장 대기 중인 메모를 저장하지 못해 업데이트를 중단했습니다. 메모 저장 상태를 확인한 뒤 다시 시도해 주세요.";

function toUpdateDetails(update: Update): DesktopUpdateDetails {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    releaseNotes: update.body?.trim().slice(0, 4000) || null,
    releaseDate: update.date ?? null,
  };
}

function closeUpdate(update: Update | null): void {
  if (!update) return;
  void update.close().catch(() => undefined);
}

export function useDesktopUpdater({
  enabled,
  blocked,
  beforeInstall,
}: UseDesktopUpdaterOptions): DesktopUpdaterState & {
  accept: () => Promise<void>;
  decline: (snoozePeriod?: UpdateSnoozePeriod) => Promise<void>;
  retry: () => Promise<void>;
  checkNow: () => Promise<void>;
} {
  const [state, setState] = useState<DesktopUpdaterState>(INITIAL_STATE);
  const updateRef = useRef<Update | null>(null);
  const hasCheckedRef = useRef(false);
  const hasDismissedRef = useRef(false);
  const mountedRef = useRef(true);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const blockedRef = useRef(blocked);
  const enabledRef = useRef(enabled);
  const beforeInstallRef = useRef(beforeInstall);
  blockedRef.current = blocked;
  enabledRef.current = enabled;
  beforeInstallRef.current = beforeInstall;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const pendingUpdate = updateRef.current;
      updateRef.current = null;
      closeUpdate(pendingUpdate);
    };
  }, []);

  useEffect(() => {
    if (!enabled || blocked || hasCheckedRef.current || hasDismissedRef.current) {
      return;
    }

    hasCheckedRef.current = true;
    if (readUpdateSnoozeUntil() !== null) {
      setState({ ...INITIAL_STATE, phase: "dismissed" });
      return;
    }

    checkingRef.current = true;
    setState((current) => ({
      ...current,
      phase: "checking",
      errorMessage: null,
    }));

    void check({ timeout: 15_000 })
      .then((nextUpdate) => {
        if (!mountedRef.current) {
          closeUpdate(nextUpdate);
          return;
        }

        if (!nextUpdate) {
          setState({ ...INITIAL_STATE, phase: "up-to-date" });
          return;
        }

        updateRef.current = nextUpdate;
        setState({
          phase: "available",
          update: toUpdateDetails(nextUpdate),
          downloadedBytes: 0,
          totalBytes: null,
          errorMessage: null,
        });
      })
      .catch(() => {
        // Update checks are intentionally non-blocking. Offline users should
        // keep using H Memo and will be checked again on the next launch.
        if (mountedRef.current) {
          setState({ ...INITIAL_STATE, phase: "error", errorMessage: "업데이트를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요." });
        }
      }).finally(() => { checkingRef.current = false; });
  }, [blocked, enabled]);

  const handleDownloadEvent = useCallback((event: DownloadEvent) => {
    if (!mountedRef.current) return;

    if (event.event === "Started") {
      setState((current) => ({
        ...current,
        downloadedBytes: 0,
        totalBytes: event.data.contentLength ?? null,
      }));
      return;
    }

    if (event.event === "Progress") {
      setState((current) => ({
        ...current,
        downloadedBytes: current.downloadedBytes + event.data.chunkLength,
      }));
    }
  }, []);

  const accept = useCallback(async () => {
    const pendingUpdate = updateRef.current;
    if (!pendingUpdate || !mountedRef.current || !enabledRef.current || blockedRef.current || installingRef.current) return;
    installingRef.current = true;

    setState((current) => ({
      ...current,
      phase: "installing",
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    }));

    try {
      try {
        await beforeInstallRef.current?.();
      } catch {
        if (mountedRef.current) setState((current) => ({ ...current, phase: "error", errorMessage: PERSIST_FAILED_MESSAGE }));
        return;
      }
      if (!mountedRef.current || !enabledRef.current || blockedRef.current) {
        if (mountedRef.current) setState((current) => ({ ...current, phase: "error", errorMessage: INSTALL_BLOCKED_MESSAGE }));
        return;
      }
      await pendingUpdate.downloadAndInstall(handleDownloadEvent);
      if (!mountedRef.current) return;

      updateRef.current = null;
      closeUpdate(pendingUpdate);
      setState((current) => ({
        ...current,
        phase: "installed",
        errorMessage: null,
      }));
    } catch {
      if (!mountedRef.current) return;

      setState((current) => ({
        ...current,
        phase: "error",
        errorMessage: INSTALL_ERROR_MESSAGE,
      }));
    } finally {
      installingRef.current = false;
    }
  }, [handleDownloadEvent]);

  const checkNow = useCallback(async () => {
    if (!enabled || blockedRef.current || checkingRef.current || installingRef.current) return;
    hasCheckedRef.current = true;
    checkingRef.current = true;
    setState((current) => ({ ...INITIAL_STATE, phase: "checking", update: current.update }));
    const previous = updateRef.current;
    updateRef.current = null;
    closeUpdate(previous);
    try {
      const nextUpdate = await check({ timeout: 15_000 });
      if (!mountedRef.current || !enabledRef.current) {
        closeUpdate(nextUpdate);
        return;
      }
      if (!nextUpdate) {
        setState({ ...INITIAL_STATE, phase: "up-to-date" });
        return;
      }
      updateRef.current = nextUpdate;
      setState({ phase: "available", update: toUpdateDetails(nextUpdate), downloadedBytes: 0, totalBytes: null, errorMessage: null });
    } catch {
      if (mountedRef.current && enabledRef.current) setState({ ...INITIAL_STATE, phase: "error", errorMessage: "업데이트를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요." });
    } finally {
      checkingRef.current = false;
    }
  }, [enabled]);

  const decline = useCallback(async (snoozePeriod?: UpdateSnoozePeriod) => {
    hasDismissedRef.current = true;
    if (snoozePeriod) {
      saveUpdateSnooze(snoozePeriod);
    }

    const pendingUpdate = updateRef.current;
    updateRef.current = null;
    if (pendingUpdate) {
      await pendingUpdate.close().catch(() => undefined);
    }

    if (mountedRef.current) {
      setState((current) => ({
        ...current,
        phase: "dismissed",
        errorMessage: null,
      }));
    }
  }, []);

  return {
    ...state,
    accept,
    decline,
    retry: accept,
    checkNow,
  };
}
