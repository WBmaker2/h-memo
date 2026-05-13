export type SyncState = "local-only" | "queued" | "backed-up" | "conflict";

export type MemoStyle = {
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
};

export type MemoWindowState = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  visible: boolean;
  alwaysOnTop: boolean;
};

export type Memo = {
  id: string;
  title: string;
  plainText: string;
  richContent: unknown;
  style: MemoStyle;
  windowState: MemoWindowState;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState: SyncState;
};

export type MemoRepository = {
  listMemos(): Promise<Memo[]>;
  saveMemo(memo: Memo): Promise<Memo>;
  softDeleteMemo(id: string, deletedAt: string): Promise<Memo>;
  restoreMemo(id: string, restoredAt: string): Promise<Memo>;
};

export type BackupPayload = {
  version: 1;
  userId: string;
  createdAt: string;
  memos: Memo[];
};

export type ValidationResult =
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: string };

export const DEFAULT_MEMO_STYLE: MemoStyle = {
  backgroundColor: "#fff7b8",
  textColor: "#1f2937",
  fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
  fontSize: 16,
};

export const DEFAULT_MEMO_WINDOW_STATE: MemoWindowState = {
  x: null,
  y: null,
  width: 320,
  height: 280,
  visible: true,
  alwaysOnTop: false,
};
