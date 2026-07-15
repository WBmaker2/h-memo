import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BackupHistoryDialog, type BackupHistoryItem } from "./BackupHistoryDialog";

const item: BackupHistoryItem = {
  id: "snapshot-1",
  savedAt: "2026-07-12T15:30:00.000Z",
  kstDate: "2026-07-13",
  memoCount: 3,
  previewText: "111, 222, 333",
  legacyUndated: false,
};

describe("BackupHistoryDialog", () => {
  it("renders one KST-dated item and restores by snapshot ID", async () => {
    const onRestore = vi.fn();
    const user = userEvent.setup();

    render(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={[item]}
        onClose={vi.fn()}
        onRestore={onRestore}
      />
    );

    expect(screen.getByRole("dialog", { name: "백업 기록 선택" })).toBeInTheDocument();
    expect(screen.getByText("2026-07-13")).toBeInTheDocument();
    expect(screen.getByText(/오전 12:30/)).toBeInTheDocument();
    expect(screen.getByText("백업 당시 3개 메모")).toBeInTheDocument();
    expect(screen.getByText("미리보기: 111, 222, 333")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2026-07-13 백업 복원" }));

    expect(onRestore).toHaveBeenCalledWith("snapshot-1");
  });

  it("focuses the close button, closes with Escape, and cleans up the listener", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={[item]}
        onClose={onClose}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables restore buttons while busy and renders a legacy undated fallback", () => {
    render(
      <BackupHistoryDialog
        isOpen
        isBusy
        items={[{ ...item, id: "legacy", savedAt: null, kstDate: null, legacyUndated: true }]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText("기존 백업")).toBeInTheDocument();
    expect(screen.getByText("백업 시각: 날짜 정보 없음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기존 백업 백업 복원" })).toBeDisabled();
  });

  it("renders nothing when closed", () => {
    render(
      <BackupHistoryDialog
        isOpen={false}
        isBusy={false}
        items={[item]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows ten newest backups per page and navigates the remaining history", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 25 }, (_, index) => ({
      ...item,
      id: `snapshot-${index + 1}`,
      kstDate: `2026-06-${String(30 - index).padStart(2, "0")}`,
      previewText: `백업 ${index + 1}`,
    }));

    render(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={items}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText("전체 25개 · 1 / 3 페이지")).toBeInTheDocument();
    expect(screen.getByText("2026-06-30")).toBeInTheDocument();
    expect(screen.getByText("2026-06-21")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-20")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 페이지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음 페이지" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "다음 페이지" }));

    expect(screen.getByText("전체 25개 · 2 / 3 페이지")).toBeInTheDocument();
    expect(screen.getByText("2026-06-20")).toBeInTheDocument();
    expect(screen.getByText("2026-06-11")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-30")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음 페이지" }));

    expect(screen.getByText("전체 25개 · 3 / 3 페이지")).toBeInTheDocument();
    expect(screen.getByText("2026-06-10")).toBeInTheDocument();
    expect(screen.getByText("2026-06-06")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이전 페이지" })).toBeEnabled();
  });

  it("returns to the newest page when the dialog is reopened", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 11 }, (_, index) => ({
      ...item,
      id: `snapshot-${index + 1}`,
      kstDate: `2026-06-${String(30 - index).padStart(2, "0")}`,
    }));
    const { rerender } = render(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={items}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(screen.getByText("전체 11개 · 2 / 2 페이지")).toBeInTheDocument();

    rerender(
      <BackupHistoryDialog
        isOpen={false}
        isBusy={false}
        items={items}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    rerender(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={items}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(await screen.findByText("전체 11개 · 1 / 2 페이지")).toBeInTheDocument();
  });

  it("delegates server-backed page navigation without slicing the current page", async () => {
    const user = userEvent.setup();
    const onPreviousPage = vi.fn();
    const onNextPage = vi.fn();
    const currentPageItems = Array.from({ length: 10 }, (_, index) => ({
      ...item,
      id: `server-${index + 11}`,
      kstDate: `2026-06-${String(20 - index).padStart(2, "0")}`,
    }));

    render(
      <BackupHistoryDialog
        isOpen
        isBusy={false}
        items={currentPageItems}
        pagination={{
          pageNumber: 2,
          hasPreviousPage: true,
          hasNextPage: true,
          onPreviousPage,
          onNextPage,
        }}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText("2페이지 · 최대 10개씩 표시")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /백업 복원/ })).toHaveLength(10);

    await user.click(screen.getByRole("button", { name: "이전 페이지" }));
    await user.click(screen.getByRole("button", { name: "다음 페이지" }));

    expect(onPreviousPage).toHaveBeenCalledOnce();
    expect(onNextPage).toHaveBeenCalledOnce();
  });
});
