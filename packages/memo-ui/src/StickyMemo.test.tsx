import { createMemo } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StickyMemo } from "./StickyMemo";

describe("StickyMemo", () => {
  it("edits title, body, and style", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onChange = vi.fn();

    render(<StickyMemo memo={memo} onChange={onChange} onHide={vi.fn()} onDelete={vi.fn()} />);

    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "오늘 할 일");
    await user.type(screen.getByLabelText("메모 내용"), "자료 정리");
    await user.click(screen.getByRole("button", { name: "노란색 배경" }));

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByDisplayValue("오늘 할 일")).toBeInTheDocument();
  });

  it("requests hide and delete through icon buttons", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onHide = vi.fn();
    const onDelete = vi.fn();

    render(<StickyMemo memo={memo} onChange={vi.fn()} onHide={onHide} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));

    expect(onHide).toHaveBeenCalledWith("memo-1");
    expect(onDelete).toHaveBeenCalledWith("memo-1");
  });
});
