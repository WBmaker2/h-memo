export const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/WBmaker2/h-memo/releases/latest";
export const DOWNLOAD_MANIFEST_PATH = "download-manifest.json";

export type ReleaseDownloadState = {
  url: string;
  label: string;
  source: "github-asset" | "download-manifest" | "fallback";
};

export type WindowsInstallerKind = "msi" | "exe";

export type WindowsInstallerDownloadStates = Record<WindowsInstallerKind, ReleaseDownloadState>;

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

const INSTALLER_EXTENSIONS: Record<WindowsInstallerKind, ".msi" | ".exe"> = {
  msi: ".msi",
  exe: ".exe",
} as const;

const INSTALLER_LABELS: Record<WindowsInstallerKind, string> = {
  msi: "Windows MSI 설치 파일로 연결됩니다.",
  exe: "Windows EXE 설치 파일로 연결됩니다.",
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

function toDownloadState(
  kind: WindowsInstallerKind,
  url: string,
  source: ReleaseDownloadState["source"],
): ReleaseDownloadState {
  return {
    url,
    label: INSTALLER_LABELS[kind],
    source,
  };
}

function chooseAssetInstaller(
  assets: readonly GitHubAsset[],
  kind: WindowsInstallerKind,
): ReleaseDownloadState | null {
  const extension = INSTALLER_EXTENSIONS[kind];
  const matchingAssets = assets.filter((asset) => asset.name.toLowerCase().endsWith(extension));
  if (matchingAssets.length === 0) {
    return null;
  }

  const x64 = matchingAssets.find((asset) => asset.name.toLowerCase().includes("x64"));
  const selected = x64 ?? matchingAssets[0];

  return toDownloadState(kind, selected.browser_download_url, "github-asset");
}

function chooseWindowsInstaller(assets: readonly GitHubAsset[]): ReleaseDownloadState | null {
  return chooseAssetInstaller(assets, "msi") ?? chooseAssetInstaller(assets, "exe");
}

function chooseWindowsInstallers(
  assets: readonly GitHubAsset[],
): Partial<WindowsInstallerDownloadStates> {
  return {
    msi: chooseAssetInstaller(assets, "msi") ?? undefined,
    exe: chooseAssetInstaller(assets, "exe") ?? undefined,
  };
}

function isWindowsDownloadManifest(value: unknown): value is WindowsDownloadManifest {
  return typeof value === "object" && value !== null;
}

function getManifestInstallerUrl(
  windows: WindowsDownloadManifest,
  kind: WindowsInstallerKind,
): unknown {
  return kind === "msi" ? windows.msiUrl : windows.exeUrl;
}

function chooseManifestInstallerByKind(
  manifest: DownloadManifestResponse,
  kind: WindowsInstallerKind,
): ReleaseDownloadState | null {
  const windows = manifest.windows;
  if (!isWindowsDownloadManifest(windows)) {
    return null;
  }

  const url = getManifestInstallerUrl(windows, kind);

  if (isValidBrowserDownloadUrl(url)) {
    return toDownloadState(kind, url, "download-manifest");
  }

  return null;
}

function chooseManifestInstaller(manifest: DownloadManifestResponse): ReleaseDownloadState | null {
  return chooseManifestInstallerByKind(manifest, "msi") ?? chooseManifestInstallerByKind(manifest, "exe");
}

function chooseManifestInstallers(
  manifest: DownloadManifestResponse,
): Partial<WindowsInstallerDownloadStates> {
  return {
    msi: chooseManifestInstallerByKind(manifest, "msi") ?? undefined,
    exe: chooseManifestInstallerByKind(manifest, "exe") ?? undefined,
  };
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

async function resolveInstallersFromLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<Partial<WindowsInstallerDownloadStates>> {
  try {
    const response = await fetcher(GITHUB_LATEST_RELEASE_API_URL);
    if (!response.ok) {
      return {};
    }

    const release = (await response.json()) as GitHubLatestReleaseResponse;
    const assetsRaw = release.assets;

    if (!Array.isArray(assetsRaw)) {
      return {};
    }

    const validAssets = assetsRaw.filter(isValidAsset);
    if (validAssets.length === 0) {
      return {};
    }

    return chooseWindowsInstallers(validAssets);
  } catch {
    return {};
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

async function resolveInstallersFromDownloadManifest(
  fetcher: typeof fetch = fetch,
): Promise<Partial<WindowsInstallerDownloadStates>> {
  try {
    const response = await fetcher(getDownloadManifestUrl());
    if (!response.ok) {
      return {};
    }

    const manifest = (await response.json()) as DownloadManifestResponse;
    return chooseManifestInstallers(manifest);
  } catch {
    return {};
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

export async function resolveWindowsDownloadUrls(
  fetcher: typeof fetch = fetch,
): Promise<WindowsInstallerDownloadStates> {
  const latestReleaseStates = await resolveInstallersFromLatestRelease(fetcher);
  const hasBothLatestInstallers = latestReleaseStates.msi && latestReleaseStates.exe;
  const manifestStates = hasBothLatestInstallers
    ? {}
    : await resolveInstallersFromDownloadManifest(fetcher);

  return {
    msi: latestReleaseStates.msi ?? manifestStates.msi ?? FALLBACK_STATE,
    exe: latestReleaseStates.exe ?? manifestStates.exe ?? FALLBACK_STATE,
  };
}
