import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouter } from "../AppRouter";
import { LandingPage } from "./LandingPage";
import { resolveWindowsDownloadUrls } from "./releaseDownload";

vi.mock("../WebApp", () => ({
  WebApp: () => <h1>H Memo (웹 미리보기)</h1>,
}));

vi.mock("./releaseDownload", async () => {
  const actual = await vi.importActual<typeof import("./releaseDownload")>("./releaseDownload");
  return {
    ...actual,
    resolveWindowsDownloadUrls: vi.fn(),
  };
});

const FALLBACK_DOWNLOAD_STATE = {
  url: "",
  label: "다운로드 링크를 준비 중입니다. 잠시 후 다시 시도해 주세요.",
  source: "fallback" as const,
};

const RESOLVED_DOWNLOAD_STATE = {
  url: "https://github.com/WBmaker2/h-memo/releases/download/v1.0.0/H.Memo_1.0.0_x64_en-US.msi",
  label: "Windows MSI 설치 파일로 연결됩니다.",
  source: "github-asset" as const,
};

const MANIFEST_DOWNLOAD_STATE = {
  url: "https://github.com/WBmaker2/h-memo/releases/download/v1.0.0/H.Memo_1.0.0_x64-setup.exe",
  label: "Windows EXE 설치 파일로 연결됩니다.",
  source: "download-manifest" as const,
};

const FALLBACK_DOWNLOAD_STATES = {
  msi: FALLBACK_DOWNLOAD_STATE,
  exe: FALLBACK_DOWNLOAD_STATE,
};

const RESOLVED_DOWNLOAD_STATES = {
  msi: RESOLVED_DOWNLOAD_STATE,
  exe: MANIFEST_DOWNLOAD_STATE,
};

const MACOS_DOWNLOAD_URL =
  "https://github.com/WBmaker2/h-memo/releases/download/v0.1.2/H.Memo_0.1.2_aarch64.dmg";
const WEB_APP_URL = "https://wbmaker2.github.io/h-memo/";

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  vi.mocked(resolveWindowsDownloadUrls).mockResolvedValue(FALLBACK_DOWNLOAD_STATES);
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("LandingPage", () => {
  it("renders landing page by default via AppRouter", async () => {
    render(<AppRouter />);

    expect(screen.getByRole("heading", { name: "H Memo" })).toBeInTheDocument();
    const msiDownloadButton = await screen.findByRole("button", { name: "Windows MSI 다운로드" });
    const exeDownloadButton = screen.getByRole("button", { name: "Windows EXE 다운로드" });
    expect(msiDownloadButton).toBeDisabled();
    expect(exeDownloadButton).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "H Memo (웹 미리보기)" }),
    ).not.toBeInTheDocument();
  });

  it("renders a disabled download button before resolution", async () => {
    render(<LandingPage />);

    expect(
      screen.getByText(/v1\.0\.0 탑재 완료: 백업 기록 선택 복원과 보안 의존성 정리/),
    ).toBeInTheDocument();
    const msiDownloadButton = screen.getByRole("button", { name: "Windows MSI 다운로드" });
    const exeDownloadButton = screen.getByRole("button", { name: "Windows EXE 다운로드" });
    expect(msiDownloadButton).toBeDisabled();
    expect(exeDownloadButton).toBeDisabled();
    expect(msiDownloadButton).toHaveAttribute("title", "다운로드 파일을 확인하는 중입니다.");
    expect(exeDownloadButton).toHaveAttribute("title", "다운로드 파일을 확인하는 중입니다.");
    expect(screen.getByText("MSI: 다운로드 파일을 확인하는 중입니다.")).toBeInTheDocument();
    expect(screen.getByText("EXE: 다운로드 파일을 확인하는 중입니다.")).toBeInTheDocument();

    await waitFor(() => {
      expect(msiDownloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
      expect(exeDownloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
    });
  });

  it("updates the MSI download link href when the resolver returns a GitHub asset", async () => {
    vi.mocked(resolveWindowsDownloadUrls).mockResolvedValue(RESOLVED_DOWNLOAD_STATES);

    render(<LandingPage />);

    const downloadLink = await screen.findByRole("link", { name: "Windows MSI 다운로드" });

    expect(downloadLink).toHaveAttribute("href", RESOLVED_DOWNLOAD_STATE.url);
    expect(downloadLink).toHaveAttribute("title", RESOLVED_DOWNLOAD_STATE.label);
  });

  it("renders a separate EXE download link when the resolver returns an EXE URL", async () => {
    vi.mocked(resolveWindowsDownloadUrls).mockResolvedValue(RESOLVED_DOWNLOAD_STATES);

    render(<LandingPage />);

    const downloadLink = await screen.findByRole("link", { name: "Windows EXE 다운로드" });

    expect(downloadLink).toHaveAttribute("href", MANIFEST_DOWNLOAD_STATE.url);
    expect(downloadLink).toHaveAttribute("title", MANIFEST_DOWNLOAD_STATE.label);
  });

  it("keeps the download button disabled when no installer URL is available", async () => {
    vi.mocked(resolveWindowsDownloadUrls).mockResolvedValue(FALLBACK_DOWNLOAD_STATES);

    render(<LandingPage />);

    const msiDownloadButton = screen.getByRole("button", { name: "Windows MSI 다운로드" });
    const exeDownloadButton = screen.getByRole("button", { name: "Windows EXE 다운로드" });

    await waitFor(() => {
      expect(msiDownloadButton).toBeDisabled();
      expect(msiDownloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
      expect(exeDownloadButton).toBeDisabled();
      expect(exeDownloadButton).toHaveAttribute("title", FALLBACK_DOWNLOAD_STATE.label);
      expect(screen.getByText(`MSI: ${FALLBACK_DOWNLOAD_STATE.label}`)).toBeInTheDocument();
      expect(screen.getByText(`EXE: ${FALLBACK_DOWNLOAD_STATE.label}`)).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "최신 릴리스 페이지" })).not.toBeInTheDocument();
  });

  it("opens and closes the update history dialog", async () => {
    const user = userEvent.setup();

    render(<LandingPage />);

    expect(screen.queryByRole("dialog", { name: "업데이트 기록" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "업데이트 기록" }));

    const dialog = screen.getByRole("dialog", { name: "업데이트 기록" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("백업 기록 선택 복원")).toBeInTheDocument();
    expect(
      screen.getByText("서버 복원 시 최신본을 바로 덮어쓰지 않고 시간대별 백업 기록 중 선택해 복원합니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-07-12")).toBeInTheDocument();
    expect(screen.getByText("2026-05-13")).toBeInTheDocument();
    expect(
      screen.getByText("데이터 안전성, 복원 안전성, 접근성, 메뉴 개선"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "업데이트 기록 닫기" }));

    expect(screen.queryByRole("dialog", { name: "업데이트 기록" })).not.toBeInTheDocument();
  });

  it("renders both SmartScreen guidance images with exact alt text", async () => {
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Windows MSI 다운로드" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Windows EXE 다운로드" })).toBeDisabled();
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
      expect(screen.getByText(`MSI: ${FALLBACK_DOWNLOAD_STATE.label}`)).toBeInTheDocument();
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

  it("links to the macOS DMG download from the landing page", async () => {
    render(<LandingPage />);

    const macDownloadLink = screen.getByRole("link", { name: "macOS 버전 다운로드" });

    expect(macDownloadLink).toHaveAttribute("href", MACOS_DOWNLOAD_URL);
    expect(macDownloadLink).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("heading", { name: "macOS 다운로드 안내" })).toBeInTheDocument();
    expect(screen.getByText("macOS용 DMG는 보안 문제로 정상 설치가 제한될 수 있음")).toBeInTheDocument();
    expect(
      screen.queryByText("웹 브라우저용 웹앱도 개발 및 배포 예정"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(`MSI: ${FALLBACK_DOWNLOAD_STATE.label}`)).toBeInTheDocument();
    });
  });

  it("links to the hosted web app from the landing page", async () => {
    render(<LandingPage />);

    const webAppLink = screen.getByRole("link", { name: "웹앱 실행" });

    expect(webAppLink).toHaveAttribute("href", WEB_APP_URL);
    expect(webAppLink).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText("웹앱은 브라우저에서 열리며 설치 없이 H Memo를 사용할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("웹 브라우저용 웹앱 제공")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(`MSI: ${FALLBACK_DOWNLOAD_STATE.label}`)).toBeInTheDocument();
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

  it("renders WebApp at the root when the web app deployment route is enabled", () => {
    vi.stubEnv("VITE_H_MEMO_WEB_DEFAULT_ROUTE", "app");

    render(<AppRouter />);

    expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
  });
});
