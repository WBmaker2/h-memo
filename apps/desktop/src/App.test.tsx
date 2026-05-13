import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("desktop App", () => {
  it("creates a memo, edits it, and exports text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "윈도우 메모");
    await user.type(screen.getByLabelText("메모 내용"), "트레이에서 열리는 메모");
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    const preview = screen.getByLabelText("TXT 미리보기 결과");

    expect(preview).toHaveTextContent(/제목: 윈도우 메모/);
    expect(preview).toHaveTextContent(/트레이에서 열리는 메모/);
  });
});
