import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoWorkspace } from "./MemoWorkspace";

describe("MemoWorkspace", () => {
  it("shows the dated update history from the app menu", async () => {
    const user = userEvent.setup();

    render(
      <MemoWorkspace
        appClassName="test-app"
        title="H Memo"
        memos={[]}
        onCreateMemo={vi.fn()}
        onMemoChange={vi.fn()}
        onDeleteMemo={vi.fn()}
        settingsProps={{
          userName: null,
          backupStatus: "백업 정보 없음",
          startupEnabled: false,
          onBackup: vi.fn(),
          onRestore: vi.fn(),
          onExportText: vi.fn(),
          onToggleStartup: vi.fn(),
          onSignIn: vi.fn(),
          onSignOut: vi.fn(),
        }}
      />
    );

    expect(screen.queryByRole("region", { name: "업데이트 내역" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "업데이트 내역" }));

    expect(screen.getByRole("region", { name: "업데이트 내역" })).toBeInTheDocument();
    expect(screen.getByText("2026-05-13")).toBeInTheDocument();
    expect(screen.getByText("최종 호환성 보강")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업데이트 내역 닫기" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
