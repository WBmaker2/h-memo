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
}: UseDesktopUpdaterOptions): DesktopUpdaterState & {
  accept: () => Promise<void>;
  decline: (snoozePeriod?: UpdateSnoozePeriod) => Promise<void>;
  retry: () => Promise<void>;
} {
  const [state, setState] = useState<DesktopUpdaterState>(INITIAL_STATE);
  const updateRef = useRef<Update | null>(null);
  const hasCheckedRef = useRef(false);
  const hasDismissedRef = useRef(false);
  const mountedRef = useRef(true);

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

    setState((current) => ({
      ...current,
      phase: "checking",
      errorMessage: null,
    }));

    void check()
      .then((nextUpdate) => {
        if (!mountedRef.current) {
          closeUpdate(nextUpdate);
          return;
        }

        if (!nextUpdate) {
          setState(INITIAL_STATE);
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
          setState(INITIAL_STATE);
        }
      });
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
    if (!pendingUpdate || !mountedRef.current) return;

    setState((current) => ({
      ...current,
      phase: "installing",
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    }));

    try {
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
    }
  }, [handleDownloadEvent]);

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
  };
}
