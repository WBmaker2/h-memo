import { createMemo } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StickyMemo } from "./StickyMemo";
import { StrictMode } from "react";

describe("StickyMemo", () => {
  it("edits body and style from the memo menu", async () => {
    const user = userEvent.setup();
    const memo = createMemo({
      now: "2026-05-13T09:00:00.000Z",
      id: "memo-1",
    });
    const onChange = vi.fn();

    render(<StickyMemo memo={memo} onChange={onChange} onHide={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.queryByLabelText("메모 제목")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("메모 내용"), "자료 정리");
    await user.click(screen.getByRole("button", { name: "노란색 배경" }));
    await user.click(screen.getByRole("button", { name: "흰색 배경" }));
    await user.click(screen.getByRole("button", { name: "빨강 글자" }));

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByDisplayValue("자료 정리")).toBeInTheDocument();
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

  it("requests native window drag and resize from the titlebar and handle", async () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onRequestWindowDrag = vi.fn();
    const onRequestWindowResize = vi.fn();
    const onRequestWindowMinimize = vi.fn();
    const onRequestWindowMaximize = vi.fn();
    const onRequestWindowClose = vi.fn();

    render(
      <StickyMemo
        memo={memo}
        onChange={vi.fn()}
        onHide={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowDrag={onRequestWindowDrag}
        onRequestWindowResize={onRequestWindowResize}
        onRequestWindowMinimize={onRequestWindowMinimize}
        onRequestWindowMaximize={onRequestWindowMaximize}
        onRequestWindowClose={onRequestWindowClose}
      />
    );

    fireEvent.mouseDown(screen.getByLabelText("상단 메뉴바"), { button: 0 });
    fireEvent.pointerDown(screen.getByLabelText("창 크기 조절"), { button: 0 });
    await userEvent.click(screen.getByRole("button", { name: "최소화" }));
    await userEvent.click(screen.getByRole("button", { name: "최대화" }));
    await userEvent.click(screen.getByRole("button", { name: "종료" }));

    expect(onRequestWindowDrag).toHaveBeenCalledTimes(1);
    expect(onRequestWindowResize).toHaveBeenCalledWith("SouthEast");
    expect(onRequestWindowMinimize).toHaveBeenCalledTimes(1);
    expect(onRequestWindowMaximize).toHaveBeenCalledTimes(1);
    expect(onRequestWindowClose).toHaveBeenCalledTimes(1);
  });

  it("collapses and expands the memo body from titlebar double click", () => {
    const memo = createMemo({
      now: "2026-05-13T09:00:00.000Z",
      id: "memo-1",
      plainText: "접었다 펼칠 내용",
    });
    const onRequestCollapseChange = vi.fn();

    render(
      <StickyMemo
        memo={memo}
        onChange={vi.fn()}
        onHide={vi.fn()}
        onDelete={vi.fn()}
        onRequestCollapseChange={onRequestCollapseChange}
      />
    );

    fireEvent.doubleClick(screen.getByLabelText("상단 메뉴바"));

    expect(screen.queryByLabelText("메모 내용")).not.toBeInTheDocument();
    expect(onRequestCollapseChange).toHaveBeenCalledWith(true);

    fireEvent.doubleClick(screen.getByLabelText("상단 메뉴바"));

    expect(screen.getByLabelText("메모 내용")).toBeInTheDocument();
    expect(onRequestCollapseChange).toHaveBeenCalledWith(false);
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

    const bodyInput = screen.getByLabelText("메모 내용");
    const backgroundButton = screen.getByRole("button", { name: "흰색 배경" });

    await user.click(backgroundButton);
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.type(bodyInput, "A");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
