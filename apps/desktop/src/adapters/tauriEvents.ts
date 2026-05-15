import { emit, listen } from "@tauri-apps/api/event";
import type { HMemoUser } from "@h-memo/memo-sync";

const MEMO_STORE_CHANGED_EVENT = "h-memo:memo-store-changed";
const AUTH_STATE_CHANGED_EVENT = "h-memo:auth-state-changed";
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
