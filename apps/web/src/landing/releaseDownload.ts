export const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/WBmaker2/h-memo-releases/releases/latest";
export const DOWNLOAD_MANIFEST_PATH = "download-manifest.json";

export type ReleaseDownloadState = {
  url: string;
  label: string;
  source: "github-asset" | "download-manifest" | "fallback";
};

type GitHubAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubAssetCandidate = {
  name?: unknown;
  browser_download_url?: unknown;
};

type GitHubLatestReleaseResponse = {
  assets?: unknown;
};

type DownloadManifestResponse = {
  windows?: unknown;
};

type WindowsDownloadManifest = {
  msiUrl?: unknown;
  exeUrl?: unknown;
};

const FALLBACK_STATE: ReleaseDownloadState = {
  url: "",
  label: "다운로드 링크를 준비 중입니다. 잠시 후 다시 시도해 주세요.",
  source: "fallback",
} as const;

function getDownloadManifestUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${DOWNLOAD_MANIFEST_PATH}`;
}

function isValidBrowserDownloadUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidAsset(asset: unknown): asset is GitHubAsset {
  return (
    typeof asset === "object" &&
    asset !== null &&
    isValidBrowserDownloadUrl((asset as GitHubAssetCandidate).browser_download_url) &&
    typeof (asset as GitHubAssetCandidate).name === "string"
  );
}

function chooseWindowsInstaller(assets: readonly GitHubAsset[]): ReleaseDownloadState | null {
  const installerExtensions = [".msi", ".exe"] as const;

  for (const extension of installerExtensions) {
    const matchingAssets = assets.filter((asset) =>
      asset.name.toLowerCase().endsWith(extension),
    );
    if (matchingAssets.length === 0) {
      continue;
    }

    const x64 = matchingAssets.find((asset) => asset.name.toLowerCase().includes("x64"));
    const selected = x64 ?? matchingAssets[0];

    return {
      url: selected.browser_download_url,
      label:
        extension === ".msi"
          ? "Windows MSI 설치 파일로 연결됩니다."
          : "Windows EXE 설치 파일로 연결됩니다.",
      source: "github-asset",
    };
  }

  return null;
}

function isWindowsDownloadManifest(value: unknown): value is WindowsDownloadManifest {
  return typeof value === "object" && value !== null;
}

function chooseManifestInstaller(manifest: DownloadManifestResponse): ReleaseDownloadState | null {
  const windows = manifest.windows;
  if (!isWindowsDownloadManifest(windows)) {
    return null;
  }

  if (isValidBrowserDownloadUrl(windows.msiUrl)) {
    return {
      url: windows.msiUrl,
      label: "Windows MSI 설치 파일로 연결됩니다.",
      source: "download-manifest",
    };
  }

  if (isValidBrowserDownloadUrl(windows.exeUrl)) {
    return {
      url: windows.exeUrl,
      label: "Windows EXE 설치 파일로 연결됩니다.",
      source: "download-manifest",
    };
  }

  return null;
}

async function resolveFromLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<ReleaseDownloadState | null> {
  try {
    const response = await fetcher(GITHUB_LATEST_RELEASE_API_URL);
    if (!response.ok) {
      return null;
    }

    const release = (await response.json()) as GitHubLatestReleaseResponse;
    const assetsRaw = release.assets;

    if (!Array.isArray(assetsRaw)) {
      return null;
    }

    const validAssets = assetsRaw.filter(isValidAsset);
    if (validAssets.length === 0) {
      return null;
    }

    return chooseWindowsInstaller(validAssets);
  } catch {
    return null;
  }
}

async function resolveFromDownloadManifest(
  fetcher: typeof fetch = fetch,
): Promise<ReleaseDownloadState | null> {
  try {
    const response = await fetcher(getDownloadManifestUrl());
    if (!response.ok) {
      return null;
    }

    const manifest = (await response.json()) as DownloadManifestResponse;
    return chooseManifestInstaller(manifest);
  } catch {
    return null;
  }
}

export async function resolveWindowsDownloadUrl(
  fetcher: typeof fetch = fetch,
): Promise<ReleaseDownloadState> {
  const latestReleaseState = await resolveFromLatestRelease(fetcher);
  if (latestReleaseState) {
    return latestReleaseState;
  }

  const manifestState = await resolveFromDownloadManifest(fetcher);
  return manifestState ?? FALLBACK_STATE;
}
