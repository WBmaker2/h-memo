import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

export type FirebaseConfigFormValue = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId: string;
  googleOAuthClientId: string;
};

export type SettingsPanelProps = {
  userName: string | null;
  backupStatus: string;
  startupEnabled: boolean;
  isStartupAvailable?: boolean;
  isServerAvailable?: boolean;
  isServerBusy?: boolean;
  isBackupDisabled?: boolean;
  isRestoreDisabled?: boolean;
  canUndoRestore?: boolean;
  onUndoRestore?: () => void;
  isAuthDisabled?: boolean;
  showStartupSection?: boolean;
  firebaseConfig?: FirebaseConfigFormValue;
  onBackup: () => void;
  onRestore: () => void;
  onExportText: () => void;
  onExportJsonBackup?: () => void;
  onImportJsonBackup?: () => void;
  onToggleStartup: (enabled: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSaveFirebaseConfig?: (config: FirebaseConfigFormValue) => void;
  onClearFirebaseConfig?: () => void;
};

const EMPTY_FIREBASE_CONFIG: FirebaseConfigFormValue = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
  storageBucket: "",
  messagingSenderId: "",
  measurementId: "",
  googleOAuthClientId: "",
};

export function SettingsPanel({
  userName,
  backupStatus,
  startupEnabled,
  isStartupAvailable = true,
  isServerAvailable = true,
  isServerBusy = false,
  isBackupDisabled = false,
  isRestoreDisabled = false,
  canUndoRestore = false,
  onUndoRestore = () => {},
  isAuthDisabled = false,
  showStartupSection = true,
  firebaseConfig = EMPTY_FIREBASE_CONFIG,
  onBackup,
  onRestore,
  onExportText,
  onExportJsonBackup = () => {},
  onImportJsonBackup = () => {},
  onToggleStartup,
  onSignIn,
  onSignOut,
  onSaveFirebaseConfig,
  onClearFirebaseConfig,
}: SettingsPanelProps) {
  const [firebaseForm, setFirebaseForm] = useState<FirebaseConfigFormValue>(firebaseConfig);

  useEffect(() => {
    setFirebaseForm(firebaseConfig);
  }, [firebaseConfig]);

  const handleToggleStartup = (event: ChangeEvent<HTMLInputElement>) => {
    onToggleStartup(event.currentTarget.checked);
  };

  const handleAuthClick = () => {
    if (userName) {
      onSignOut();
    } else {
      onSignIn();
    }
  };

  const handleFirebaseConfigChange =
    (key: keyof FirebaseConfigFormValue) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      setFirebaseForm((current) => ({
        ...current,
        [key]: value,
      }));
    };

  const handleFirebaseConfigSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSaveFirebaseConfig?.(firebaseForm);
  };

  return (
    <section className="settings-panel">
      <section className="settings-panel__section">
        <h4 className="settings-panel__section-title">계정</h4>
        <p>{userName || "구글 로그인(선택)"}</p>
        <button
          type="button"
          onClick={handleAuthClick}
          disabled={isAuthDisabled || !isServerAvailable}
          title={userName ? "로그아웃" : "구글 로그인"}
        >
          {userName ? "로그아웃" : "구글 로그인"}
        </button>
      </section>

      {onSaveFirebaseConfig ? (
        <section className="settings-panel__section">
          <h4 className="settings-panel__section-title">구글 로그인 설정</h4>
          <form className="firebase-config-form" onSubmit={handleFirebaseConfigSubmit}>
            <label>
              API key
              <input
                value={firebaseForm.apiKey}
                onChange={handleFirebaseConfigChange("apiKey")}
                autoComplete="off"
              />
            </label>
            <label>
              Auth domain
              <input
                value={firebaseForm.authDomain}
                onChange={handleFirebaseConfigChange("authDomain")}
                autoComplete="off"
              />
            </label>
            <label>
              Project ID
              <input
                value={firebaseForm.projectId}
                onChange={handleFirebaseConfigChange("projectId")}
                autoComplete="off"
              />
            </label>
            <label>
              App ID
              <input
                value={firebaseForm.appId}
                onChange={handleFirebaseConfigChange("appId")}
                autoComplete="off"
              />
            </label>
            <label>
              Storage bucket
              <input
                value={firebaseForm.storageBucket}
                onChange={handleFirebaseConfigChange("storageBucket")}
                autoComplete="off"
              />
            </label>
            <label>
              Messaging sender ID
              <input
                value={firebaseForm.messagingSenderId}
                onChange={handleFirebaseConfigChange("messagingSenderId")}
                autoComplete="off"
              />
            </label>
            <label>
              Measurement ID
              <input
                value={firebaseForm.measurementId}
                onChange={handleFirebaseConfigChange("measurementId")}
                autoComplete="off"
              />
            </label>
            <label>
              Google OAuth Client ID
              <input
                value={firebaseForm.googleOAuthClientId}
                onChange={handleFirebaseConfigChange("googleOAuthClientId")}
                autoComplete="off"
              />
            </label>
            <div>
              <button type="submit" disabled={isServerBusy}>
                설정 저장
              </button>
              <button type="button" onClick={onClearFirebaseConfig} disabled={isServerBusy}>
                설정 지우기
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="settings-panel__section">
        <h4 className="settings-panel__section-title">백업/복원</h4>
        <p role="status">{backupStatus}</p>
        <div>
          <button
            type="button"
            onClick={onBackup}
            disabled={isBackupDisabled || !isServerAvailable}
          >
            서버 백업
          </button>
          <button
            type="button"
            onClick={onRestore}
            disabled={isRestoreDisabled || !isServerAvailable}
          >
            서버 복원
          </button>
          <button
            type="button"
            onClick={onExportText}
            disabled={isServerBusy}
          >
            TXT 내보내기
          </button>
          <button
            type="button"
            onClick={onExportJsonBackup}
            disabled={isServerBusy}
          >
            JSON 백업
          </button>
          <button
            type="button"
            onClick={onImportJsonBackup}
            disabled={isServerBusy}
          >
            JSON 복원
          </button>
          {canUndoRestore ? (
            <button type="button" onClick={onUndoRestore} disabled={isServerBusy}>
              마지막 복원 되돌리기
            </button>
          ) : null}
        </div>
      </section>

      {showStartupSection ? (
        <section className="settings-panel__section">
          <h4 className="settings-panel__section-title">시작프로그램</h4>
          <label className="settings-panel__switch-row">
            <span>시작프로그램 등록</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="시작프로그램 등록"
              checked={startupEnabled}
              disabled={!isStartupAvailable}
              onChange={handleToggleStartup}
            />
          </label>
        </section>
      ) : null}
    </section>
  );
}
