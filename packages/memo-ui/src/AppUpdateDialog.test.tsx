import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppUpdateDialog } from "./AppUpdateDialog";

const baseProps = {
  isOpen: true,
  phase: "available" as const,
  currentVersion: "1.0.6",
  version: "1.0.7",
  releaseNotes: "Windows 자동 업데이트를 추가했습니다.",
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  onAccept: vi.fn(),
  onDecline: vi.fn(),
};

describe("AppUpdateDialog", () => {
  it("shows the latest version prompt and focuses the update action", () => {
    render(<AppUpdateDialog {...baseProps} />);

    expect(
      screen.getByRole("dialog", {
        name: "프로그램을 v1.0.7(최신 버전)으로 업그레이드하시겠습니까?",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("현재 버전 v1.0.6입니다.");
    expect(screen.getByText("Windows 자동 업데이트를 추가했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예" })).toHaveFocus();
  });

  it("supports the yes/no choices, Escape, and a focus loop", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<AppUpdateDialog {...baseProps} onAccept={onAccept} onDecline={onDecline} />);

    await user.keyboard("{Enter}");
    expect(onAccept).toHaveBeenCalledOnce();

    await user.keyboard("{Tab}");
    expect(screen.getByRole("checkbox", { name: "1주일 뒤에 다시 안내" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("checkbox", { name: "1달 뒤에 다시 안내" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("checkbox", { name: "1주일 뒤에 다시 안내" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "예" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onDecline).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "아니요" }));
    expect(onDecline).toHaveBeenCalledTimes(2);
  });

  it("lets the user choose one re-prompt period before saying no", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn();
    render(<AppUpdateDialog {...baseProps} onDecline={onDecline} />);

    const week = screen.getByRole("checkbox", { name: "1주일 뒤에 다시 안내" });
    const month = screen.getByRole("checkbox", { name: "1달 뒤에 다시 안내" });
    await user.click(week);
    expect(week).toBeChecked();
    expect(month).not.toBeChecked();

    await user.click(month);
    expect(week).not.toBeChecked();
    expect(month).toBeChecked();

    await user.click(screen.getByRole("button", { name: "아니요" }));
    expect(onDecline).toHaveBeenCalledWith("month");
  });

  it("renders download progress and keeps actions disabled while installing", () => {
    render(
      <AppUpdateDialog
        {...baseProps}
        phase="installing"
        downloadedBytes={512}
        totalBytes={1024}
      />
    );

    expect(screen.getByRole("progressbar")).toHaveValue(50);
    expect(screen.getByText("50% · 512바이트 / 1,024바이트")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "아니요" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "예" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "1주일 뒤에 다시 안내" })).toBeDisabled();
  });

  it("shows an escaped plain-text error and retry action", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <AppUpdateDialog
        {...baseProps}
        phase="error"
        releaseNotes="<script>not markup</script>"
        errorMessage="업데이트를 설치하지 못했습니다."
        onAccept={onAccept}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("업데이트를 설치하지 못했습니다.");
    expect(screen.getByText("<script>not markup</script>")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "not markup" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });
});
