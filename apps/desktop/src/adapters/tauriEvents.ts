import { emit, listen } from "@tauri-apps/api/event";
import type { HMemoUser } from "@h-memo/memo-sync";

const MEMO_STORE_CHANGED_EVENT = "h-memo:memo-store-changed";
const AUTH_STATE_CHANGED_EVENT = "h-memo:auth-state-changed";
const STARTUP_STATE_CHANGED_EVENT = "h-memo:startup-state-changed";
const TRAY_OPEN_ALL_MEMOS_EVENT = "h-memo:tray-open-all-memos";
const TRAY_CREATE_MEMO_EVENT = "h-memo:tray-create-memo";
const RESTORE_LOCK_REQUESTED_EVENT = "h-memo:restore-lock-requested";
const RESTORE_LOCK_ACKNOWLEDGED_EVENT = "h-memo:restore-lock-acknowledged";
const RESTORE_LOCK_RELEASED_EVENT = "h-memo:restore-lock-released";
const sourceId = `window-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type MemoStoreChangedPayload = {
  sourceId: string;
  memoId?: string;
  deletedMemoId?: string;
};

export type AuthStateChangedPayload = {
  sourceId: string;
  user: HMemoUser | null;
  status: string;
};

export type StartupStateChangedPayload = {
  sourceId: string;
  enabled: boolean;
};

export type RestoreLockRequestedPayload = {
  sourceId: string;
  token: string;
};

export type RestoreLockAcknowledgedPayload = {
  sourceId: string;
  token: string;
  windowLabel: string;
  ok: boolean;
  error?: string;
};

export type RestoreLockReleasedPayload = {
  sourceId: string;
  token: string;
};

export function notifyMemoStoreChanged(
  payload: Omit<MemoStoreChangedPayload, "sourceId"> = {}
) {
  return emit<MemoStoreChangedPayload>(MEMO_STORE_CHANGED_EVENT, {
    sourceId,
    ...payload,
  });
}

export function listenMemoStoreChanged(
  handler: (payload: Omit<MemoStoreChangedPayload, "sourceId">) => void
) {
  return listen<MemoStoreChangedPayload>(MEMO_STORE_CHANGED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    handler(event.payload);
  });
}

export function notifyAuthStateChanged(
  payload: Omit<AuthStateChangedPayload, "sourceId">
) {
  return emit<AuthStateChangedPayload>(AUTH_STATE_CHANGED_EVENT, {
    sourceId,
    ...payload,
  });
}

export function listenAuthStateChanged(
  handler: (payload: Omit<AuthStateChangedPayload, "sourceId">) => void
) {
  return listen<AuthStateChangedPayload>(AUTH_STATE_CHANGED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    handler(event.payload);
  });
}

export function notifyStartupStateChanged(
  payload: Omit<StartupStateChangedPayload, "sourceId">
) {
  return emit<StartupStateChangedPayload>(STARTUP_STATE_CHANGED_EVENT, {
    sourceId,
    ...payload,
  });
}

export function listenStartupStateChanged(
  handler: (payload: Omit<StartupStateChangedPayload, "sourceId">) => void
) {
  return listen<StartupStateChangedPayload>(STARTUP_STATE_CHANGED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    handler(event.payload);
  });
}

export function notifyRestoreLockRequested(token: string) {
  return emit<RestoreLockRequestedPayload>(RESTORE_LOCK_REQUESTED_EVENT, {
    sourceId,
    token,
  });
}

export function listenRestoreLockRequested(
  handler: (payload: Omit<RestoreLockRequestedPayload, "sourceId">) => void | Promise<void>
) {
  return listen<RestoreLockRequestedPayload>(RESTORE_LOCK_REQUESTED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    void handler(event.payload);
  });
}

export function notifyRestoreLockAcknowledged(
  payload: Omit<RestoreLockAcknowledgedPayload, "sourceId">
) {
  return emit<RestoreLockAcknowledgedPayload>(RESTORE_LOCK_ACKNOWLEDGED_EVENT, {
    sourceId,
    ...payload,
  });
}

export function listenRestoreLockAcknowledged(
  handler: (payload: Omit<RestoreLockAcknowledgedPayload, "sourceId">) => void
) {
  return listen<RestoreLockAcknowledgedPayload>(RESTORE_LOCK_ACKNOWLEDGED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    handler(event.payload);
  });
}

export function notifyRestoreLockReleased(token: string) {
  return emit<RestoreLockReleasedPayload>(RESTORE_LOCK_RELEASED_EVENT, {
    sourceId,
    token,
  });
}

export function listenRestoreLockReleased(
  handler: (payload: Omit<RestoreLockReleasedPayload, "sourceId">) => void
) {
  return listen<RestoreLockReleasedPayload>(RESTORE_LOCK_RELEASED_EVENT, (event) => {
    if (event.payload.sourceId === sourceId) {
      return;
    }
    handler(event.payload);
  });
}

export function listenTrayOpenAllMemos(handler: () => void | Promise<void>) {
  return listen(TRAY_OPEN_ALL_MEMOS_EVENT, () => {
    void handler();
  });
}

export function listenTrayCreateMemo(handler: () => void | Promise<void>) {
  return listen(TRAY_CREATE_MEMO_EVENT, () => {
    void handler();
  });
}
