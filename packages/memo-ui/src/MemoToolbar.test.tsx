import { type MemoStyle } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoToolbar } from "./MemoToolbar";

describe("MemoToolbar", () => {
  const defaultStyle: MemoStyle = {
    backgroundColor: "#fff7b8",
    textColor: "#1f2937",
    fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
    fontSize: 16,
  };

  it("exposes selected background and text colors with aria-pressed", () => {
    render(
      <MemoToolbar
        style={defaultStyle}
        onStyleChange={vi.fn()}
        onHide={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "배경색" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "폰트" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "글자 색" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "메모 동작" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "노란색 배경" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "흰색 배경" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "검정 글자" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "빨강 글자" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("calls onStyleChange and updates pressed state after rerender", async () => {
    const user = userEvent.setup();
    const onStyleChange = vi.fn();
    const { rerender } = render(
      <MemoToolbar
        style={defaultStyle}
        onStyleChange={onStyleChange}
        onHide={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "흰색 배경" }));
    expect(onStyleChange).toHaveBeenCalledWith({ backgroundColor: "#ffffff" });

    rerender(
      <MemoToolbar
        style={{ ...defaultStyle, backgroundColor: "#ffffff", textColor: "#b91c1c" }}
        onStyleChange={onStyleChange}
        onHide={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "흰색 배경" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "빨강 글자" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
