import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { DESKTOP_UPDATE_CHECK_EVENT, DesktopUpdatePrompt } from "./DesktopUpdatePrompt";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
const mockCheck = vi.mocked(check);

describe("DesktopUpdatePrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the latest-version result after a menu-triggered manual check", async () => {
    mockCheck.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<DesktopUpdatePrompt enabled blocked={false} />);
    await waitFor(() => expect(mockCheck).toHaveBeenCalledOnce());

    await act(async () => {
      window.dispatchEvent(new Event(DESKTOP_UPDATE_CHECK_EVENT));
    });
    expect(await screen.findByRole("dialog", { name: "최신 버전입니다" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("설치된 프로그램이 공개된 최신 버전입니다.");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "최신 버전입니다" })).not.toBeInTheDocument();
  });

  it("ignores duplicate menu checks while one request is pending", async () => {
    mockCheck.mockResolvedValueOnce(null).mockImplementation(() => new Promise(() => {}));
    render(<DesktopUpdatePrompt enabled blocked={false} />);
    await waitFor(() => expect(mockCheck).toHaveBeenCalledOnce());

    await act(async () => {
      window.dispatchEvent(new Event(DESKTOP_UPDATE_CHECK_EVENT));
      window.dispatchEvent(new Event(DESKTOP_UPDATE_CHECK_EVENT));
    });
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });
});
