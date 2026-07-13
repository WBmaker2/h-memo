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
    expect(screen.getByText("KST 날짜 표시 안정화")).toBeInTheDocument();
    expect(screen.getByText("최종 호환성 보강")).toBeInTheDocument();
    expect(screen.getByText("KST 일별 백업 보존")).toBeInTheDocument();
    expect(
      screen.getByText(
        "대한민국 날짜별 최신 백업 1개를 최근 365일 동안 보관하고, 선택한 날짜의 메모만 불러오도록 개선했습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "실행 PC와 CI의 시간대가 달라도 날짜와 시각을 대한민국 표준시(Asia/Seoul)로 일관되게 표시하도록 개선했습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Node\/환경이 달라도 한국어 오전·오후 표기가 일관되게 보이도록 보강했습니다\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업데이트 내역 닫기" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
