import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { WebApp } from "./WebApp";

const STORAGE_KEY = "h-memo:web-memo-repository-v1";

beforeEach(() => {
  const store = new Map<string, string>();

  if (!window.localStorage || typeof window.localStorage.getItem !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          store.clear();
        },
        getItem: (key: string) => (store.has(key) ? store.get(key) : null),
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      writable: true,
    });
  } else {
    window.localStorage.clear();
  }
});

describe("WebApp", () => {
  it("renders web preview shell", async () => {
    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "새 메모" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "TXT 미리보기" })).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "시작프로그램 등록" })).toBeDisabled();
    });
  });

  it("generates TXT preview for edited memo", async () => {
    const user = userEvent.setup();
    render(<WebApp />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByRole("textbox", { name: "메모 제목" }), {
      target: { value: "웹 미리보기 메모" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "브라우저에서 저장되는 메모" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/제목: 웹 미리보기 메모/);
    expect(preview).toHaveTextContent(/브라우저에서 저장되는 메모/);
  });

  it("persists memo data to localStorage for browser session preview", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WebApp />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByRole("textbox", { name: "메모 제목" }), {
      target: { value: "세션 유지 메모" },
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
    });

    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(raw.some((memo: { title: string }) => memo.title === "세션 유지 메모")).toBe(
      true
    );

    unmount();
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("세션 유지 메모")).toBeInTheDocument();
    });
  });
});
