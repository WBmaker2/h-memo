import { createMemo } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StickyMemo } from "./StickyMemo";
import { StrictMode } from "react";

describe("StickyMemo", () => {
  it("edits title, body, and style", async () => {
    const user = userEvent.setup();
    const memo = createMemo({
      now: "2026-05-13T09:00:00.000Z",
      id: "memo-1",
      title: "",
    });
    const onChange = vi.fn();

    render(<StickyMemo memo={memo} onChange={onChange} onHide={vi.fn()} onDelete={vi.fn()} />);

    await user.type(screen.getByLabelText("메모 제목"), "오늘할일");
    await user.type(screen.getByLabelText("메모 내용"), "자료 정리");
    await user.click(screen.getByRole("button", { name: "노란색 배경" }));
    await user.click(screen.getByRole("button", { name: "흰색 배경" }));
    await user.click(screen.getByRole("button", { name: "빨강 글자" }));

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByDisplayValue("오늘할일")).toBeInTheDocument();
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      richContent: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "자료 정리" }] }],
      },
      plainText: "자료 정리",
      style: { backgroundColor: "#ffffff", textColor: "#b91c1c" },
    });
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

  it("uses renameMemo on each title change and applies trim fallback", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onChange = vi.fn();

    render(<StickyMemo memo={memo} onChange={onChange} onHide={vi.fn()} onDelete={vi.fn()} />);

    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "   ");

    const latest = onChange.mock.calls.at(-1)?.[0];
    expect(latest).toMatchObject({
      title: "새 메모",
    });
    expect(screen.getByDisplayValue("새 메모")).toBeInTheDocument();
  });

  it("does not duplicate onChange in StrictMode per single edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <StrictMode>
        <StickyMemo
          memo={createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" })}
          onChange={onChange}
          onHide={vi.fn()}
          onDelete={vi.fn()}
        />
      </StrictMode>
    );

    const titleInput = screen.getByLabelText("메모 제목");
    const backgroundButton = screen.getByRole("button", { name: "흰색 배경" });

    await user.click(backgroundButton);
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.type(titleInput, "A");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
