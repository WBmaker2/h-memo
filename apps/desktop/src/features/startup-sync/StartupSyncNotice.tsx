import type { DesktopStartupRestorePhase } from "./useDesktopStartupServerRestore";

export function StartupSyncNotice({
  phase,
  message,
  onRetry,
}: {
  phase: DesktopStartupRestorePhase;
  message: string | null;
  onRetry: () => void;
}) {
  if (phase !== "error" && phase !== "conflict") return null;

  return (
    <aside className="startup-sync-notice" role="status" aria-live="polite">
      <p>{message ?? "서버 메모 상태를 확인하지 못했습니다. 로컬 메모는 유지됩니다."}</p>
      <button type="button" onClick={onRetry}>
        서버 메모 다시 확인
      </button>
    </aside>
  );
}
