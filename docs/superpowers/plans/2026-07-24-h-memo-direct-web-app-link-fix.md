# H Memo 웹앱 직접 실행 링크 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 별도 랜딩페이지에서 `웹앱 실행` 버튼을 한 번만 눌러 실제 H Memo 웹앱을 새 창으로 연다.

**Architecture:** 랜딩페이지의 상대 해시 링크를 실제 웹앱 GitHub Pages 절대 주소로 바꾼다. 기존 새 창 동작과 AppRouter 해시 라우팅은 유지하며, 링크 대상 URL을 통합 테스트로 고정한다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, GitHub Pages

## Global Constraints

- 실제 웹앱 배포 주소는 `https://wbmaker2.github.io/h-memo/#/app`이다.
- 랜딩페이지 주소가 `h-memo-releases`여도 링크는 실제 웹앱 배포 주소로 이동해야 한다.
- `target="_blank"` 동작을 유지한다.
- 버전 파일은 수정하지 않는다.

---

### Task 1: 직접 실행 링크 회귀 수정

**Files:**
- Modify: `apps/web/src/landing/LandingPage.test.tsx`
- Modify: `apps/web/src/landing/LandingPage.tsx`

- [ ] **Step 1: Write the failing test**

기존 링크 테스트의 기대 URL을 다음 절대 주소로 변경한다.

```ts
const WEB_APP_URL = "https://wbmaker2.github.io/h-memo/#/app";
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm test -- --pool=forks apps/web/src/landing/LandingPage.test.tsx`

Expected: 실제 링크가 `#/app`이므로 실패한다.

- [ ] **Step 3: Implement the minimal fix**

`LandingPage.tsx`의 `WEB_APP_URL`을 동일한 절대 주소로 변경한다.

- [ ] **Step 4: Verify GREEN and regression safety**

Run:

```bash
npm test -- --pool=forks apps/web/src/landing/LandingPage.test.tsx
npm test -- --pool=forks apps/web/src
npm run typecheck -w apps/web
npm run build -w apps/web
```

Expected: 모든 명령이 종료 코드 0으로 통과한다.