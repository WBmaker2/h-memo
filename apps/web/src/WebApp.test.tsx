import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { WebApp } from "./WebApp";

const STORAGE_KEY = "h-memo:web-memo-repository-v1";

type LocalStorageStubOptions = {
  initialEntries?: [string, string][];
  failOnSet?: boolean;
};

function installLocalStorageStub(options: LocalStorageStubOptions = {}) {
  const store = new Map<string, string>(options.initialEntries ?? []);

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => {
        store.clear();
      },
      getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        if (options.failOnSet) {
          throw new Error("quota exceeded");
        }
        store.set(String(key), String(value));
      },
    },
    writable: true,
  });

  return store;
}

beforeEach(() => {
  installLocalStorageStub();
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
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "브라우저에서 저장되는 메모" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).not.toHaveTextContent(/제목:/);
    expect(preview).toHaveTextContent(/브라우저에서 저장되는 메모/);
  });

  it("persists memo data to localStorage for browser session preview", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WebApp />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "세션 유지 메모" },
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
    });

    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(
      raw.some((memo: { plainText: string }) => memo.plainText === "세션 유지 메모")
    ).toBe(true);

    unmount();
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("세션 유지 메모")).toBeInTheDocument();
    });
  });

  it("loads corrupt legacy localStorage records without crashing", async () => {
    installLocalStorageStub({
      initialEntries: [
        [
          STORAGE_KEY,
          JSON.stringify([
            {
              id: "legacy-web-memo",
              title: "복구된 웹 메모",
              plainText: "windowState가 없어도 렌더링됩니다.",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
            },
            {
              title: "무시될 메모",
              plainText: "id가 없습니다.",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
            },
          ]),
        ],
      ],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("windowState가 없어도 렌더링됩니다.")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("무시될 메모")).not.toBeInTheDocument();
  });

  it("reports localStorage write failures when creating a memo", async () => {
    const user = userEvent.setup();
    installLocalStorageStub({ failOnSet: true });
    render(<WebApp />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /메모 저장 실패: localStorage 저장 실패/
      );
    });
  });
});
