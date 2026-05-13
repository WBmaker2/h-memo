import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("shows backup state and calls platform actions", async () => {
    const user = userEvent.setup();
    const onBackup = vi.fn();
    const onExportText = vi.fn();
    const onToggleStartup = vi.fn();

    render(
      <SettingsPanel
        userName="홍길동"
        backupStatus="마지막 백업: 2026-05-13 18:00"
        startupEnabled={false}
        onBackup={onBackup}
        onRestore={vi.fn()}
        onExportText={onExportText}
        onToggleStartup={onToggleStartup}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    await user.click(screen.getByRole("switch", { name: "시작프로그램 등록" }));

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(onBackup).toHaveBeenCalled();
    expect(onExportText).toHaveBeenCalled();
    expect(onToggleStartup).toHaveBeenCalledWith(true);
  });
});
