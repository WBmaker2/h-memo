import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExportTextFile,
  mockGetStartupEnabled,
  mockSetStartupEnabled,
  tauriRepositoryState,
  MockTauriMemoRepository,
} = vi.hoisted(() => {
  const mockExportTextFile = vi.fn();
  const mockGetStartupEnabled = vi.fn();
  const mockSetStartupEnabled = vi.fn();

  const tauriRepositoryState = new Map<string, any>();

  const cloneMemo = (value: any) => JSON.parse(JSON.stringify(value));

  const listMemos = async () => {
    return [...tauriRepositoryState.values()].map(cloneMemo);
  };

  const saveMemo = async (nextMemo: any) => {
    tauriRepositoryState.set(nextMemo.id, cloneMemo(nextMemo));
    return cloneMemo(nextMemo);
  };

  const softDeleteMemo = async (id: string, deletedAt: string) => {
    const current = tauriRepositoryState.get(id);
    if (!current) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    tauriRepositoryState.set(id, cloneMemo(next));
    return cloneMemo(next);
  };

  const restoreMemo = async (id: string, restoredAt: string) => {
    const current = tauriRepositoryState.get(id);
    if (!current) {
      throw new Error(`Cannot restore memo: memo not found (${id})`);
    }
    const next = {
      ...current,
      deletedAt: null,
      updatedAt: restoredAt,
      syncState: "queued",
      windowState: {
        ...current.windowState,
        visible: true,
      },
    };
    tauriRepositoryState.set(id, cloneMemo(next));
    return cloneMemo(next);
  };

  class MockTauriMemoRepository {
    listMemos = listMemos;
    saveMemo = saveMemo;
    softDeleteMemo = softDeleteMemo;
    restoreMemo = restoreMemo;
  }

  return {
    mockExportTextFile,
    mockGetStartupEnabled,
    mockSetStartupEnabled,
    tauriRepositoryState,
    MockTauriMemoRepository,
  };
});

vi.mock("./adapters/tauriPlatform", () => ({
  exportTextFile: (...args: Parameters<typeof mockExportTextFile>) =>
    mockExportTextFile(...args),
  getStartupEnabled: () => mockGetStartupEnabled(),
  setStartupEnabled: (enabled: boolean) => mockSetStartupEnabled(enabled),
}));

vi.mock("./adapters/tauriMemoRepository", () => ({
  TauriMemoRepository: MockTauriMemoRepository,
}));

import { App } from "./App";

type TestWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function setTauriRuntime(enabled: boolean) {
  const nextWindow = window as TestWindow;
  if (enabled) {
    nextWindow.__TAURI_INTERNALS__ = {};
  } else {
    delete nextWindow.__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  setTauriRuntime(false);
  tauriRepositoryState.clear();
  mockExportTextFile.mockReset();
  mockGetStartupEnabled.mockReset();
  mockSetStartupEnabled.mockReset();
});

describe("desktop App", () => {
  it("keeps title text as-is in exported text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "윈도우메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "tray memo" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    const preview = screen.getByLabelText("TXT 미리보기 결과");

    expect(preview).toHaveTextContent(/제목: 윈도우메모/);
    expect(preview).toHaveTextContent(/tray memo/);
  });

  it("hides memo from view after 메모 숨기기", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), { target: { value: "윈도우메모" } });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("윈도우메모")).not.toBeInTheDocument();
    });
  });

  it("exports hidden memos too, including via settings panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "숨김메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "숨김 텍스트" },
    });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("숨김메모")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    let preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김메모/);
    expect(preview).toHaveTextContent(/숨김 텍스트/);

    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김메모/);
    expect(preview).toHaveTextContent(/숨김 텍스트/);
  });

  it("keeps browser fallback behavior for text export preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("백업 정보 없음");

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "브라우저메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "browser text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/브라우저메모/);
    expect(preview).toHaveTextContent(/browser text/);
    expect(status).toHaveTextContent("백업 정보 없음");
    expect(mockExportTextFile).not.toHaveBeenCalled();
  });

  it("displays tauri export cancelled message", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockExportTextFile.mockResolvedValue({ status: "cancelled" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "취소테스트" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "cancel text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장을 취소했습니다.");
    });
  });

  it("displays tauri export failure message", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockExportTextFile.mockResolvedValue({
      status: "failed",
      message: "저장 경로 접근 오류",
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "실패테스트" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "fail text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장 실패: 저장 경로 접근 오류");
    });
  });

  it("loads startup state and handles failure", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockRejectedValue(new Error("fail"));

    render(<App />);

    const status = screen.getByRole("status");
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
      expect(status).toHaveTextContent("시작프로그램 상태를 확인하지 못했습니다.");
    });
  });

  it("reverts startup state when tauri toggle fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockSetStartupEnabled.mockResolvedValue(false);

    render(<App />);
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
    });

    mockSetStartupEnabled.mockRejectedValueOnce(new Error("fail"));
    await user.click(startupSwitch);

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
      expect(screen.getByRole("status")).toHaveTextContent("시작프로그램 설정을 변경하지 못했습니다.");
    });
  });

  it("excludes deleted memo from export", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "삭제용메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "delete text" },
    });
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent("");
    expect(preview).not.toHaveTextContent(/삭제용메모/);
  });

  it("toggles startup registration switch", async () => {
    const user = userEvent.setup();
    render(<App />);

    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });
    expect(startupSwitch).not.toBeChecked();

    await user.click(startupSwitch);
    expect(startupSwitch).toBeChecked();
  });

  it("updates status on backup and restore actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    const status = screen.getByRole("status");
    const backupButton = screen.getByRole("button", { name: "서버 백업" });
    const restoreButton = screen.getByRole("button", { name: "서버 복원" });

    await user.click(backupButton);
    expect(status).toHaveTextContent("백업 예정");

    await user.click(restoreButton);
    expect(status).toHaveTextContent("복원 완료");
  });
});
