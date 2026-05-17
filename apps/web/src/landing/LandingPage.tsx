import { useEffect, useState } from "react";
import { resolveWindowsDownloadUrl, type ReleaseDownloadState } from "./releaseDownload";

const LOADING_DOWNLOAD_LABEL = "다운로드 파일을 확인하는 중입니다.";
const MACOS_DOWNLOAD_URL =
  "https://github.com/WBmaker2/h-memo/releases/download/v0.1.2/H.Memo_0.1.2_aarch64.dmg";
const WEB_APP_URL = "https://wbmaker2.github.io/h-memo/";

function getInstallImagePath(fileName: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}install/${fileName}`;
}

export function LandingPage() {
  const [downloadState, setDownloadState] = useState<ReleaseDownloadState | null>(null);
  const downloadLabel = downloadState?.label ?? LOADING_DOWNLOAD_LABEL;
  const canDownload = downloadState !== null && downloadState.source !== "fallback";

  useEffect(() => {
    let mounted = true;

    resolveWindowsDownloadUrl().then((nextState) => {
      if (mounted) {
        setDownloadState(nextState);
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
        <p>Windows 설치 파일, macOS DMG 다운로드, 웹앱 실행 링크를 함께 제공합니다.</p>
        <div className="landing-page__download-actions">
          {canDownload ? (
            <a
              href={downloadState.url}
              className="landing-page__button"
              title={downloadLabel}
              aria-label="Windows 버전 다운로드"
            >
              Windows 버전 다운로드
            </a>
          ) : (
            <button
              type="button"
              className="landing-page__button"
              title={downloadLabel}
              aria-label="Windows 버전 다운로드"
              disabled
            >
              Windows 버전 다운로드
            </button>
          )}
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
        </div>
        <p className="landing-page__download-meta" aria-live="polite">
          {downloadLabel}
        </p>
        <p className="landing-page__download-meta">
          macOS 버전은 Apple Silicon용 DMG 파일로 제공합니다.
        </p>
        <p className="landing-page__download-meta">
          웹앱은 브라우저에서 열리며 설치 없이 H Memo를 사용할 수 있습니다.
        </p>
      </section>

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
        <p>macOS용 DMG 다운로드 제공</p>
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
          macOS에서는 다운로드 후 보안 확인 메시지가 표시될 수 있습니다. 다운로드한
          DMG 파일 이름이 H Memo 설치 파일인지 확인한 뒤 macOS 화면 안내에 따라
          실행하세요.
        </p>
      </section>
    </main>
  );
}
