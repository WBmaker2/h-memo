import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("shows backup state and calls platform actions", async () => {
    const user = userEvent.setup();
    const onBackup = vi.fn();
    const onRestore = vi.fn();
    const onExportText = vi.fn();
    const onExportJsonBackup = vi.fn();
    const onImportJsonBackup = vi.fn();
    const onToggleStartup = vi.fn();

    render(
      <SettingsPanel
        userName="홍길동"
        backupStatus="마지막 백업: 2026-05-13 18:00"
        startupEnabled={false}
        onBackup={onBackup}
        onRestore={onRestore}
        onExportText={onExportText}
        onExportJsonBackup={onExportJsonBackup}
        onImportJsonBackup={onImportJsonBackup}
        onToggleStartup={onToggleStartup}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    await user.click(screen.getByRole("button", { name: "JSON 백업" }));
    await user.click(screen.getByRole("button", { name: "JSON 복원" }));
    await user.click(screen.getByRole("switch", { name: "시작프로그램 등록" }));

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "계정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "백업/복원" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "시작프로그램" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("마지막 백업: 2026-05-13 18:00");
    expect(onBackup).toHaveBeenCalled();
    expect(onRestore).toHaveBeenCalled();
    expect(onExportText).toHaveBeenCalled();
    expect(onExportJsonBackup).toHaveBeenCalled();
    expect(onImportJsonBackup).toHaveBeenCalled();
    expect(onToggleStartup).toHaveBeenCalledWith(true);
  });

  it("renders fallback and calls sign-in for null userName", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();

    render(
      <SettingsPanel
        userName={null}
        backupStatus="백업 없음"
        startupEnabled={true}
        onBackup={vi.fn()}
        onRestore={vi.fn()}
        onExportText={vi.fn()}
        onToggleStartup={vi.fn()}
        onSignIn={onSignIn}
        onSignOut={vi.fn()}
      />
    );

    expect(screen.getByText("구글 로그인(선택)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    expect(onSignIn).toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "시작프로그램 등록" })).toBeChecked();
  });

  it("saves and clears Firebase config values", async () => {
    const user = userEvent.setup();
    const onSaveFirebaseConfig = vi.fn();
    const onClearFirebaseConfig = vi.fn();

    render(
      <SettingsPanel
        userName={null}
        backupStatus="백업 없음"
        startupEnabled={false}
        firebaseConfig={{
          apiKey: "",
          authDomain: "",
          projectId: "",
          appId: "",
          storageBucket: "",
          messagingSenderId: "",
          measurementId: "",
        }}
        onBackup={vi.fn()}
        onRestore={vi.fn()}
        onExportText={vi.fn()}
        onToggleStartup={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onSaveFirebaseConfig={onSaveFirebaseConfig}
        onClearFirebaseConfig={onClearFirebaseConfig}
      />
    );

    await user.type(screen.getByLabelText("API key"), "api-key");
    await user.type(screen.getByLabelText("Auth domain"), "project.firebaseapp.com");
    await user.type(screen.getByLabelText("Project ID"), "project-id");
    await user.type(screen.getByLabelText("App ID"), "app-id");
    await user.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(onSaveFirebaseConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "api-key",
        authDomain: "project.firebaseapp.com",
        projectId: "project-id",
        appId: "app-id",
      })
    );

    await user.click(screen.getByRole("button", { name: "설정 지우기" }));
    expect(onClearFirebaseConfig).toHaveBeenCalled();
  });

  it("calls sign-out when user is signed in", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(
      <SettingsPanel
        userName="홍길동"
        backupStatus="마지막 백업: 없음"
        startupEnabled={true}
        onBackup={vi.fn()}
        onRestore={vi.fn()}
        onExportText={vi.fn()}
        onToggleStartup={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={onSignOut}
      />
    );

    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("disables startup switch when startup is unavailable", async () => {
    const user = userEvent.setup();
    const onToggleStartup = vi.fn();

    render(
      <SettingsPanel
        userName={null}
        backupStatus="웹 미리보기"
        startupEnabled={false}
        isStartupAvailable={false}
        onBackup={vi.fn()}
        onRestore={vi.fn()}
        onExportText={vi.fn()}
        onToggleStartup={onToggleStartup}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });
    expect(startupSwitch).toBeDisabled();

    await user.click(startupSwitch);
    expect(onToggleStartup).not.toHaveBeenCalled();
  });
});
