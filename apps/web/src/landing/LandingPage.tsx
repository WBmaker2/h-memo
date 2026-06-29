import { useEffect, useState } from "react";
import {
  resolveWindowsDownloadUrls,
  type WindowsInstallerDownloadStates,
  type WindowsInstallerKind,
} from "./releaseDownload";

const LOADING_DOWNLOAD_LABEL = "다운로드 파일을 확인하는 중입니다.";
const LATEST_RELEASE_VERSION = "v1.0.0";
const MACOS_DOWNLOAD_URL =
  "https://github.com/WBmaker2/h-memo/releases/download/v0.1.2/H.Memo_0.1.2_aarch64.dmg";
const WEB_APP_URL = "https://wbmaker2.github.io/h-memo/";
const RELEASE_HISTORY = [
  {
    version: "v1.0.0",
    title: "백업 기록 선택 복원",
    items: [
      "서버 복원 시 최신본을 바로 덮어쓰지 않고 시간대별 백업 기록 중 선택해 복원합니다.",
      "삭제 처리된 서버 메모는 백업 기록 목록과 복원 대상에서 제외합니다.",
      "Vite, Vitest, Firebase 등 보안 취약점이 보고된 의존성을 최신 버전으로 정리했습니다.",
    ],
  },
  {
    version: "v0.1.6",
    title: "상단바 사용성 개선",
    items: [
      "메모창 제목 옆에 현재 버전을 표시합니다.",
      "구글 로그인 아이콘 옆에 서버 백업용 동기화 버튼을 다시 추가했습니다.",
      "메뉴 화면이 가로로 길게 밀리지 않도록 최대 폭을 조정했습니다.",
    ],
  },
  {
    version: "v0.1.5",
    title: "새 PC 화면 복원 안정화",
    items: [
      "새 Windows PC에서 로그인 후 메모창이 화면 밖으로 복원되는 문제를 보완했습니다.",
      "저장된 창 위치를 현재 모니터 범위 안으로 다시 맞추도록 개선했습니다.",
    ],
  },
  {
    version: "v0.1.4",
    title: "Windows 설치 파일 정리",
    items: [
      "MSI와 EXE 설치 파일을 각각 받을 수 있도록 다운로드 버튼을 분리했습니다.",
      "Google 로그인에 필요한 Desktop OAuth 설정을 빌드에 반영했습니다.",
    ],
  },
];

const WINDOWS_INSTALLER_BUTTONS: Array<{
  kind: WindowsInstallerKind;
  label: string;
}> = [
  { kind: "msi", label: "Windows MSI 다운로드" },
  { kind: "exe", label: "Windows EXE 다운로드" },
];

function getInstallImagePath(fileName: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}install/${fileName}`;
}

export function LandingPage() {
  const [downloadStates, setDownloadStates] = useState<WindowsInstallerDownloadStates | null>(null);
  const [isReleaseHistoryOpen, setIsReleaseHistoryOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    resolveWindowsDownloadUrls().then((nextState) => {
      if (mounted) {
        setDownloadStates(nextState);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="landing-page">
      <header className="landing-page__hero">
        <p className="landing-page__eyebrow">교사 업무 메모 도우미</p>
        <h1>H Memo</h1>
        <p className="landing-page__tagline">
          학교 업무에 필요한 메모를 저장하고 백업하는 Windows 메모앱
        </p>
      </header>

      <section className="landing-page__section landing-page__section--download">
        <h2>프로그램 다운로드</h2>
        <p className="landing-page__release-notice">
          {LATEST_RELEASE_VERSION} 탑재 완료: 백업 기록 선택 복원과 보안 의존성 정리가
          반영된 최신 Windows 설치 파일을 받을 수 있습니다.
        </p>
        <p>
          Windows MSI/EXE 설치 파일과 웹앱 실행 링크를 제공합니다. macOS 버전은 현재
          보안 문제로 정상 설치가 어려울 수 있습니다.
        </p>
        <div className="landing-page__download-actions">
          {WINDOWS_INSTALLER_BUTTONS.map(({ kind, label }) => {
            const downloadState = downloadStates?.[kind] ?? null;
            const downloadLabel = downloadState?.label ?? LOADING_DOWNLOAD_LABEL;
            const canDownload = downloadState !== null && downloadState.source !== "fallback";
            const className =
              kind === "exe"
                ? "landing-page__button landing-page__button--exe"
                : "landing-page__button";

            return canDownload ? (
              <a
                key={kind}
                href={downloadState.url}
                className={className}
                title={downloadLabel}
                aria-label={label}
              >
                {label}
              </a>
            ) : (
              <button
                key={kind}
                type="button"
                className={className}
                title={downloadLabel}
                aria-label={label}
                disabled
              >
                {label}
              </button>
            );
          })}
          <a
            href={MACOS_DOWNLOAD_URL}
            className="landing-page__button landing-page__button--secondary"
            target="_blank"
            rel="noreferrer"
          >
            macOS 버전 다운로드
          </a>
          <a
            href={WEB_APP_URL}
            className="landing-page__button landing-page__button--web"
            target="_blank"
            rel="noreferrer"
          >
            웹앱 실행
          </a>
          <button
            type="button"
            className="landing-page__button landing-page__button--history"
            onClick={() => setIsReleaseHistoryOpen(true)}
          >
            업데이트 기록
          </button>
        </div>
        <p className="landing-page__download-meta" aria-live="polite">
          MSI: {downloadStates?.msi.label ?? LOADING_DOWNLOAD_LABEL}
        </p>
        <p className="landing-page__download-meta" aria-live="polite">
          EXE: {downloadStates?.exe.label ?? LOADING_DOWNLOAD_LABEL}
        </p>
        <p className="landing-page__download-meta">
          macOS 버전은 Apple 개발자 서명/공증이 없어 보안 문제로 정상 설치가 안될 수
          있습니다. 현재는 Windows 설치 파일 사용을 권장합니다.
        </p>
        <p className="landing-page__download-meta">
          웹앱은 브라우저에서 열리며 설치 없이 H Memo를 사용할 수 있습니다.
        </p>
      </section>

      {isReleaseHistoryOpen ? (
        <div className="landing-page__modal-backdrop" role="presentation">
          <section
            className="landing-page__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-history-title"
          >
            <div className="landing-page__modal-header">
              <h2 id="release-history-title">업데이트 기록</h2>
              <button
                type="button"
                className="landing-page__modal-close"
                onClick={() => setIsReleaseHistoryOpen(false)}
                aria-label="업데이트 기록 닫기"
              >
                닫기
              </button>
            </div>
            <div className="landing-page__release-list">
              {RELEASE_HISTORY.map((release) => (
                <article className="landing-page__release-card" key={release.version}>
                  <h3>
                    <span>{release.version}</span>
                    {release.title}
                  </h3>
                  <ul>
                    {release.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <section className="landing-page__section">
        <h2>앱 소개</h2>
        <p>
          학교 행정 메모, 점검 체크리스트, 수업 운영 아이디어 등을 빠르게 기록하고
          로컬 우선으로 저장한 뒤 필요한 경우 서버로 백업할 수 있습니다.
        </p>
        <ul className="landing-page__feature-grid">
          <li>메모를 로컬 파일처럼 빠르게 저장</li>
          <li>메모창 여러 개를 동시에 열어 업무를 분리하여 관리</li>
          <li>TXT/JSON 로컬 백업 내보내기</li>
          <li>Google 계정 기반 서버 백업/복원</li>
          <li>Windows 시작프로그램 등록</li>
          <li>Windows 트레이 및 빠른 접근</li>
        </ul>
      </section>

      <section className="landing-page__section">
        <h2>제품 미리보기</h2>
        <figure className="landing-page__figure">
          <img
            src={getInstallImagePath("h-memo-product-preview.png")}
            alt="H Memo 메모 관리 화면 미리보기"
            className="landing-page__image landing-page__image--preview"
          />
          <figcaption>메모 본문, 메모 목록, 백업 동작이 함께 보이는 화면</figcaption>
        </figure>
      </section>

      <section className="landing-page__section">
        <h2>지원 플랫폼</h2>
        <p>Windows용 설치 파일 제공</p>
        <p>macOS용 DMG는 보안 문제로 정상 설치가 제한될 수 있음</p>
        <p>웹 브라우저용 웹앱 제공</p>
      </section>

      <section className="landing-page__section">
        <h2>Microsoft Defender SmartScreen 안내</h2>
        <p>
          현재 초기 배포본은 서명이 되지 않은 상태일 수 있어 SmartScreen 경고가
          나타날 수 있습니다. 실행 전에는 다운로드한 설치 파일 이름이 H Memo 설치
          파일인지 확인해 주세요. <br />
          추가 정보를 누른 뒤 실행을 선택합니다
        </p>
        <div className="landing-page__image-grid">
          <figure>
            <img
              src={getInstallImagePath("windows-smartscreen-more-info.png")}
              alt="Windows SmartScreen 화면에서 추가 정보가 강조된 모습"
              className="landing-page__image"
            />
            <figcaption>
              Windows SmartScreen에서 추가 정보를 눌러 경고 해제 화면으로 진행
            </figcaption>
          </figure>
          <figure>
            <img
              src={getInstallImagePath("windows-smartscreen-run-anyway.png")}
              alt="Windows SmartScreen 화면에서 실행 버튼이 강조된 모습"
              className="landing-page__image"
            />
            <figcaption>최종 실행 버튼 선택 안내</figcaption>
          </figure>
        </div>
      </section>

      <section className="landing-page__section landing-page__section--links">
        <h2>macOS 다운로드 안내</h2>
        <p>
          macOS 버전은 현재 Apple 개발자 서명 및 공증이 적용되지 않아 보안 문제로
          정상 설치가 안될 수 있습니다. 개발/내부 테스트 용도로만 확인해 주세요.
        </p>
      </section>
    </main>
  );
}
