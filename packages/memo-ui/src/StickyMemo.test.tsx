import { createMemo } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    render(<StickyMemo memo={memo} onChange={onChange} onDelete={vi.fn()} />);

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

  it("renders memo menu sections with style and app actions", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-menu" });
    const onGenerateText = vi.fn();
    const onBackup = vi.fn();
    const onRestore = vi.fn();
    const onToggleStartup = vi.fn();

    const appMenuContent = (
      <>
        <h4>메모 기능</h4>
        <button type="button" onClick={onGenerateText}>
          TXT 내보내기
        </button>
        <button type="button" onClick={onBackup}>
          서버 백업
        </button>
        <label>
          시작프로그램 등록
          <input
            type="checkbox"
            role="switch"
            aria-label="시작프로그램 등록"
            checked={false}
            onChange={(event) => onToggleStartup(event.currentTarget.checked)}
          />
        </label>
      </>
    );

    render(
      <StickyMemo
        memo={memo}
        appMenuContent={appMenuContent}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "메모 스타일" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "메모 기능" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "메모 삭제" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await user.click(screen.getByRole("switch", { name: "시작프로그램 등록" }));

    expect(onGenerateText).toHaveBeenCalled();
    expect(onBackup).toHaveBeenCalled();
    expect(onToggleStartup).toHaveBeenCalledWith(true);
  });

  it("requests delete through the memo action button", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onDelete = vi.fn();

    render(<StickyMemo memo={memo} onChange={vi.fn()} onDelete={onDelete} />);

    expect(screen.queryByRole("button", { name: "메모 숨기기" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));

    expect(onDelete).toHaveBeenCalledWith("memo-1");
  });

  it("closes another memo menu when a different memo menu opens", async () => {
    const user = userEvent.setup();
    const firstMemo = createMemo({
      now: "2026-05-13T09:00:00.000Z",
      id: "memo-1",
    });
    const secondMemo = createMemo({
      now: "2026-05-13T09:01:00.000Z",
      id: "memo-2",
    });

    render(
      <>
        <StickyMemo memo={firstMemo} onChange={vi.fn()} onDelete={vi.fn()} />
        <StickyMemo memo={secondMemo} onChange={vi.fn()} onDelete={vi.fn()} />
      </>
    );

    const menuButtons = screen.getAllByTitle("메모 메뉴");
    const firstMenu = menuButtons[0].closest("details");
    const secondMenu = menuButtons[1].closest("details");

    await user.click(menuButtons[0]);
    expect(firstMenu).toHaveAttribute("open");

    await user.click(menuButtons[1]);

    await waitFor(() => {
      expect(firstMenu).not.toHaveAttribute("open");
      expect(secondMenu).toHaveAttribute("open");
    });
  });

  it("requests native window drag and resize from the titlebar and handle", async () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onRequestWindowDrag = vi.fn();
    const onRequestWindowResize = vi.fn();
    const onRequestWindowClose = vi.fn();

    render(
      <StickyMemo
        memo={memo}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowDrag={onRequestWindowDrag}
        onRequestWindowResize={onRequestWindowResize}
        onRequestWindowClose={onRequestWindowClose}
      />
    );

    fireEvent.mouseDown(screen.getByLabelText("상단 메뉴바"), { button: 0 });
    fireEvent.pointerDown(screen.getByLabelText("창 크기 조절"), { button: 0 });
    expect(screen.queryByRole("button", { name: "최소화" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최대화" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "종료" }));

    expect(onRequestWindowDrag).toHaveBeenCalledTimes(1);
    expect(onRequestWindowResize).toHaveBeenCalledWith("SouthEast");
    expect(onRequestWindowClose).toHaveBeenCalledTimes(1);
  });

  it("renders the app version next to the title", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });

    render(
      <StickyMemo
        memo={memo}
        appVersion="v0.1.6"
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowClose={vi.fn()}
      />
    );

    expect(screen.getByText("H Memo")).toBeInTheDocument();
    expect(screen.getByText("v0.1.6")).toBeInTheDocument();
  });

  it("renders an icon-only sync button before the Google login indicator", async () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onRequestSync = vi.fn();

    const { container } = render(
      <StickyMemo
        memo={memo}
        authStatus={{
          state: "signed-in",
          label: "우주TV",
          photoUrl: "https://example.com/profile.png",
        }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowClose={vi.fn()}
        onRequestSync={onRequestSync}
      />
    );

    const syncButton = screen.getByRole("button", { name: "동기화" });
    const loginIndicator = screen.getByLabelText("구글 로그인됨: 우주TV");
    const controls = container.querySelector(".sticky-memo__window-controls");

    expect(syncButton).toHaveTextContent("↻");
    expect(syncButton).not.toHaveTextContent("동기화");
    expect(controls?.children[0]).toBe(syncButton);
    expect(controls?.children[1]).toBe(loginIndicator);

    await userEvent.click(syncButton);

    expect(onRequestSync).toHaveBeenCalledTimes(1);
  });

  it("renders the topbar sync button whenever a sync handler is available", async () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onRequestSync = vi.fn();

    render(
      <StickyMemo
        memo={memo}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowClose={vi.fn()}
        onRequestSync={onRequestSync}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "동기화" }));

    expect(onRequestSync).toHaveBeenCalledTimes(1);
  });

  it("disables the topbar sync button when server backup is not available", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onRequestSync = vi.fn();

    render(
      <StickyMemo
        memo={memo}
        authStatus={{ state: "signed-out", label: "구글 로그인 필요" }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onRequestWindowClose={vi.fn()}
        onRequestSync={onRequestSync}
        isSyncDisabled
      />
    );

    expect(screen.getByRole("button", { name: "동기화" })).toBeDisabled();
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
