import type { WebStartupRestorePhase } from "./useWebStartupServerRestore";

export function StartupSyncNotice({
  phase,
  message,
  isBusy,
  onResolveWithServer,
  onKeepLocal,
}: {
  phase: WebStartupRestorePhase;
  message: string | null;
  isBusy: boolean;
  onResolveWithServer: () => void;
  onKeepLocal: () => void;
}) {
  if (phase !== "conflict") return null;

  return (
    <aside className="startup-sync-notice startup-sync-notice--conflict" role="alertdialog" aria-live="polite" aria-label="로컬과 서버 충돌 해소">
      <p>{message ?? "로컬과 서버가 모두 변경되었습니다."}</p>
      <div className="startup-sync-notice__actions">
        <button type="button" onClick={onKeepLocal} disabled={isBusy}>
          내 메모 유지
        </button>
        <button
          type="button"
          onClick={onResolveWithServer}
          disabled={isBusy}
          className="btn-pulse"
          autoFocus
        >
          {isBusy ? "불러오는 중…" : "서버로 덮어쓰기"}
        </button>
      </div>
      <p className="startup-sync-notice__hint">서버로 덮어쓰면 현재 내 메모는 안전 지점에 보관됩니다.</p>
    </aside>
  );
}
