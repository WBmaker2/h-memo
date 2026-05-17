import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouter } from "../AppRouter";
import { LandingPage } from "./LandingPage";
import { resolveWindowsDownloadUrl } from "./releaseDownload";

vi.mock("../WebApp", () => ({
  WebApp: () => <h1>H Memo (웹 미리보기)</h1>,
}));

vi.mock("./releaseDownload", async () => {
  const actual = await vi.importActual<typeof import("./releaseDownload")>("./releaseDownload");
  return {
    ...actual,
    resolveWindowsDownloadUrl: vi.fn(),
  };
});

const FALLBACK_DOWNLOAD_STATE = {
  url: "",
  label: "다운로드 링크를 준비 중입니다. 잠시 후 다시 시도해 주세요.",
  source: "fallback" as const,
};

const RESOLVED_DOWNLOAD_STATE = {
  url: "https://github.com/WBmaker2/h-memo-releases/releases/download/v0.1.2/H.Memo_0.1.2_x64_en-US.msi",
  label: "Windows MSI 설치 파일로 연결됩니다.",
  source: "github-asset" as const,
};

const MANIFEST_DOWNLOAD_STATE = {
  url: "https://github.com/WBmaker2/h-memo-releases/releases/download/v0.1.2/H.Memo_0.1.2_x64-setup.exe",
  label: "Windows EXE 설치 파일로 연결됩니다.",
  source: "download-manifest" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  vi.mocked(resolveWindowsDownloadUrl).mockResolvedValue(FALLBACK_DOWNLOAD_STATE);
});

afterEach(() => {
  cleanup();
});

describe("LandingPage", () => {
  it("renders landing page by default via AppRouter", async () => {
    render(<AppRouter />);

    expect(screen.getByRole("heading", { name: "H Memo" })).toBeInTheDocument();
    const downloadButton = await screen.findByRole("button", { name: "프로그램 다운로드" });
    expect(downloadButton).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "H Memo (웹 미리보기)" }),
    ).not.toBeInTheDocument();
  });

  it("renders a disabled download button before resolution", async () => {
    render(<LandingPage />);

    const downloadButton = screen.getByRole("button", { name: "프로그램 다운로드" });
    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute("title", "다운로드 파일을 확인하는 중입니다.");
    expect(screen.getByText("다운로드 파일을 확인하는 중입니다.")).toBeInTheDocument();

    await waitFor(() => {
      expect(downloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
    });
  });

  it("updates the download link href when resolveWindowsDownloadUrl returns a GitHub asset", async () => {
    vi.mocked(resolveWindowsDownloadUrl).mockResolvedValue(RESOLVED_DOWNLOAD_STATE);

    render(<LandingPage />);

    const downloadLink = await screen.findByRole("link", { name: "프로그램 다운로드" });

    expect(downloadLink).toHaveAttribute("href", RESOLVED_DOWNLOAD_STATE.url);
    expect(downloadLink).toHaveAttribute("title", RESOLVED_DOWNLOAD_STATE.label);
  });

  it("enables the download link when resolveWindowsDownloadUrl returns the manifest fallback", async () => {
    vi.mocked(resolveWindowsDownloadUrl).mockResolvedValue(MANIFEST_DOWNLOAD_STATE);

    render(<LandingPage />);

    const downloadLink = await screen.findByRole("link", { name: "프로그램 다운로드" });

    expect(downloadLink).toHaveAttribute("href", MANIFEST_DOWNLOAD_STATE.url);
    expect(downloadLink).toHaveAttribute("title", MANIFEST_DOWNLOAD_STATE.label);
  });

  it("keeps the download button disabled when no installer URL is available", async () => {
    vi.mocked(resolveWindowsDownloadUrl).mockResolvedValue(FALLBACK_DOWNLOAD_STATE);

    render(<LandingPage />);

    const downloadButton = screen.getByRole("button", { name: "프로그램 다운로드" });

    await waitFor(() => {
      expect(downloadButton).toBeDisabled();
      expect(downloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
      expect(screen.getByText(FALLBACK_DOWNLOAD_STATE.label)).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "최신 릴리스 페이지" })).not.toBeInTheDocument();
  });

  it("renders both SmartScreen guidance images with exact alt text", async () => {
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "프로그램 다운로드" })).toBeDisabled();
    });

    expect(
      screen.getByAltText("Windows SmartScreen 화면에서 추가 정보가 강조된 모습"),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Windows SmartScreen 화면에서 실행 버튼이 강조된 모습"),
    ).toBeInTheDocument();
  });

  it("does not expose the GitHub releases page in the download section", async () => {
    render(<LandingPage />);

    await waitFor(() => {
      expect(screen.getByText(FALLBACK_DOWNLOAD_STATE.label)).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "최신 릴리스 페이지" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Windows MSI 설치 파일을 우선 안내합니다."),
    ).not.toBeInTheDocument();
  });

  it("renders product preview image", async () => {
    render(<LandingPage />);

    await waitFor(() => {
      expect(
        screen.getByAltText("H Memo 메모 관리 화면 미리보기"),
      ).toBeInTheDocument();
    });
  });

  it('renders WebApp when hash is "#/app"', () => {
    window.location.hash = "#/app";
    render(<AppRouter />);

    expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
  });

  it('also renders WebApp when hash is "#app"', () => {
    window.location.hash = "#app";
    render(<AppRouter />);

    expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
  });
});
