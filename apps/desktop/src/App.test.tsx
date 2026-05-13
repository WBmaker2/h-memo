import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

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
