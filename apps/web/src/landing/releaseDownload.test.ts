import { afterEach, describe, expect, it, vi } from "vitest";
import { DOWNLOAD_MANIFEST_PATH, resolveWindowsDownloadUrl } from "./releaseDownload";

const makeResponse = (overrides: { ok?: boolean; body?: unknown } = {}) => {
  const { ok = true, body = {} } = overrides;

  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  };
};

describe("resolveWindowsDownloadUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers x64 MSI when both x64 MSI and x64 EXE are available", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      makeResponse({
        body: {
          assets: [
            {
              name: "H Memo_0.1.2_x64-setup.exe",
              browser_download_url: "https://github.com/example/H Memo_0.1.2_x64-setup.exe",
            },
            {
              name: "H Memo_0.1.2_x64_en-US.msi",
              browser_download_url: "https://github.com/example/H Memo_0.1.2_x64_en-US.msi",
            },
          ],
        },
      }),
    );

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/WBmaker2/h-memo-releases/releases/latest",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      url: "https://github.com/example/H Memo_0.1.2_x64_en-US.msi",
      label: "Windows MSI 설치 파일로 연결됩니다.",
      source: "github-asset",
    });
  });

  it("falls back to EXE when no MSI asset exists", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      makeResponse({
        body: {
          assets: [
            {
              name: "H Memo_0.1.2_x64-setup.exe",
              browser_download_url: "https://github.com/example/H Memo_0.1.2_x64-setup.exe",
            },
          ],
        },
      }),
    );

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      url: "https://github.com/example/H Memo_0.1.2_x64-setup.exe",
      label: "Windows EXE 설치 파일로 연결됩니다.",
      source: "github-asset",
    });
  });

  it("uses the download manifest MSI when no Windows installer exists in latest release", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(
        makeResponse({
          body: {
            assets: [
              {
                name: "README.txt",
                browser_download_url: "https://github.com/example/README.txt",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          body: {
            windows: {
              msiUrl: "https://github.com/example/H.Memo_0.1.2_x64_en-US.msi",
              exeUrl: "https://github.com/example/H.Memo_0.1.2_x64-setup.exe",
            },
          },
        }),
      );

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/WBmaker2/h-memo-releases/releases/latest",
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, `/${DOWNLOAD_MANIFEST_PATH}`);
    expect(result).toEqual({
      url: "https://github.com/example/H.Memo_0.1.2_x64_en-US.msi",
      label: "Windows MSI 설치 파일로 연결됩니다.",
      source: "download-manifest",
    });
  });

  it("uses the download manifest EXE when GitHub API rejects and no manifest MSI exists", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        makeResponse({
          body: {
            windows: {
              exeUrl: "https://github.com/example/H.Memo_0.1.2_x64-setup.exe",
            },
          },
        }),
      );

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(result).toEqual({
      url: "https://github.com/example/H.Memo_0.1.2_x64-setup.exe",
      label: "Windows EXE 설치 파일로 연결됩니다.",
      source: "download-manifest",
    });
  });

  it("returns fallback when both latest release and manifest have no installer URL", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(makeResponse({ ok: false }))
      .mockResolvedValueOnce(
        makeResponse({
          body: {
            windows: {},
          },
        }),
      );

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(result).toEqual({
      url: "",
      label: "다운로드 링크를 준비 중입니다. 잠시 후 다시 시도해 주세요.",
      source: "fallback",
    });
  });

  it("falls back when response json and manifest json are malformed", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("invalid release json")),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("invalid manifest json")),
      });

    const result = await resolveWindowsDownloadUrl(fetcher);

    expect(result).toEqual({
      url: "",
      label: "다운로드 링크를 준비 중입니다. 잠시 후 다시 시도해 주세요.",
      source: "fallback",
    });
  });
});
