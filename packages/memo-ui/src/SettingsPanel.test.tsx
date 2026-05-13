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
    const onToggleStartup = vi.fn();

    render(
      <SettingsPanel
        userName="홍길동"
        backupStatus="마지막 백업: 2026-05-13 18:00"
        startupEnabled={false}
        onBackup={onBackup}
        onRestore={onRestore}
        onExportText={onExportText}
        onToggleStartup={onToggleStartup}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    await user.click(screen.getByRole("switch", { name: "시작프로그램 등록" }));

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("마지막 백업: 2026-05-13 18:00");
    expect(onBackup).toHaveBeenCalled();
    expect(onRestore).toHaveBeenCalled();
    expect(onExportText).toHaveBeenCalled();
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

    expect(screen.getByText("로그인 필요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(onSignIn).toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "시작프로그램 등록" })).toBeChecked();
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
});
