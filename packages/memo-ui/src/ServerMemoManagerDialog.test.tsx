import { createMemo } from "@h-memo/memo-core";
import type { BackedUpMemo } from "@h-memo/memo-sync";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServerMemoManagerDialog } from "./ServerMemoManagerDialog";

describe("ServerMemoManagerDialog", () => {
  const items: BackedUpMemo[] = [
    {
      memo: {
        ...createMemo({
          id: "server-memo-1",
          now: "2026-05-17T09:00:00.000Z",
          plainText: "  서버에 저장된 메모  \n",
        }),
        deletedAt: "2026-05-17T09:03:00.000Z",
      },
      backupCreatedAt: "2026-05-17T09:05:00.000Z",
    },
  ];

  it("renders an open dialog with controls, memo label, and backup time", () => {
    render(
      <ServerMemoManagerDialog
        isOpen
        isBusy={false}
        items={items}
        status="로드 완료"
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "서버 메모 관리" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "새로고침" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("로드 완료");
    expect(screen.getByRole("heading", { name: "서버 메모 관리" })).toBeInTheDocument();
    expect(screen.getByText("서버에 저장된 메모")).toBeInTheDocument();
    expect(screen.getByText("백업 시각: 2026. 5. 17. 오후 6:05:00")).toBeInTheDocument();
    expect(screen.getByText("로컬 삭제 기록 있음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "서버에 저장된 메모 서버 삭제" })).toHaveClass(
      "server-memo-dialog__action--destructive"
    );
    expect(screen.getByRole("button", { name: "서버에 저장된 메모 복원" })).not.toHaveClass(
      "server-memo-dialog__action--destructive"
    );
  });

  it("calls refresh, restore, delete, and close handlers", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <ServerMemoManagerDialog
        isOpen
        isBusy={false}
        items={items}
        status="상태"
        onClose={onClose}
        onRefresh={onRefresh}
        onRestore={onRestore}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await user.click(screen.getByRole("button", { name: "서버에 저장된 메모 복원" }));
    await user.click(screen.getByRole("button", { name: "서버에 저장된 메모 서버 삭제" }));
    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("server-memo-1");
    expect(onDelete).toHaveBeenCalledWith("server-memo-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows empty-state message when there are no backups", () => {
    render(
      <ServerMemoManagerDialog
        isOpen
        isBusy={false}
        items={[]}
        status="빈 상태"
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("서버에 저장된 메모가 없습니다.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <ServerMemoManagerDialog
        isOpen={false}
        isBusy={false}
        items={items}
        status="상태"
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("서버 메모 관리")).not.toBeInTheDocument();
  });
});
