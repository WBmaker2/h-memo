import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StartupServerRestoreDialog } from "./StartupServerRestoreDialog";

const versions = {
  local: { memoCount: 2, updatedAt: "2026-08-28T01:00:00.000Z" },
  server: { memoCount: 3, savedAt: "2026-08-28T02:00:00.000Z" },
};

describe("StartupServerRestoreDialog", () => {
  it("renders the requested copy and focuses the Enter default action", () => {
    render(
      <StartupServerRestoreDialog
        isOpen
        isBusy={false}
        {...versions}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "더 최근 서버 메모가 있습니다" })).toBeInTheDocument();
    expect(screen.getByText("서버에 저장된 최근 버전의 메모를 불러오시겠습니까?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예, 서버 메모 불러오기 ↵" })).toHaveFocus();
  });

  it("submits with Enter and supports mouse clicks for both choices", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <StartupServerRestoreDialog
        isOpen
        isBusy={false}
        {...versions}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    );

    await user.keyboard("{Enter}");
    expect(onAccept).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "아니요, 로컬 유지" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("closes with Escape and traps Tab focus", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn();
    render(
      <StartupServerRestoreDialog
        isOpen
        isBusy={false}
        {...versions}
        onAccept={vi.fn()}
        onDecline={onDecline}
      />
    );

    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "아니요, 로컬 유지" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "예, 서버 메모 불러오기 ↵" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "아니요, 로컬 유지" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("disables both actions during restore and exposes retry errors", () => {
    render(
      <StartupServerRestoreDialog
        isOpen
        isBusy
        errorMessage="서버 메모를 불러오지 못했습니다."
        statusMessage="다시 확인하는 중입니다."
        {...versions}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "아니요, 로컬 유지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 시도 ↵" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("서버 메모를 불러오지 못했습니다.");
  });
});
