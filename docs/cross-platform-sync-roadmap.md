# H Memo Cross-Platform Realtime Sync 로드맵

작성일: 2026-05-17  
대상 브랜치: `codex/h-memo-sync-roadmap`  
범위: Windows/macOS Tauri 앱 + 웹 앱이 같은 Firebase Auth + Cloud Firestore 사용자 DB를 사용해 동기화되도록 설계

## 1) 목표와 비목표

### 목표 (In Scope)
- **단일 사용자 계정 단위의 실시간/준실시간 동기화**를 Windows 앱, macOS 앱, 웹앱이 같은 데이터 모델을 사용해 공유한다.
- 클라우드 동기화의 단위를 “메모 단위”(`users/{uid}/memos/{memoId}`)로 전환한다.
- 기기별 메모 윈도우 상태(위치/크기/가시성)는 사용자 데이터와 분리해 기기별로 안정적으로 저장한다.
- 기존 `서버 백업/복원` 흐름을 깨지 않으면서 점진적으로 실시간 동기화로 확장한다.
- 충돌 탐지/표시를 제공하고, 사용자의 의도(로컬 우선)로 안전하게 복구할 수 있는 규칙을 둔다.
- Firebase 보안 규칙, 오프라인 큐, 스냅샷 기반 복구 가드라인까지 포함한 운영 가능한 최소 동기화 품질을 확보한다.

### 비목표 (Out of Scope)
- 실시간 공동 편집(같은 메모의 동시 타이핑 충돌 병합)은 초기 1차 범위에서 제외한다.
- 팀 공유/메모 공유 링크/초대 기능은 제외한다.
- 파일 첨부, 이미지, 음성, 캘린더 연동은 제외한다.
- 암호화/복호화 키 협상 기반 E2EE는 v1 범위 밖으로 둔다.

## 2) 현재 백업/복원 모델의 한계

현재 구조는 `users/{uid}/backupSnapshots/{snapshotId}` + `serverMemoDeletes` 기반이다. 이 구조는 “수동 백업”엔 유효하지만, 다음 제약이 크다.

- **메모 단위 변경 추적이 어렵다.**  
  모든 메모를 하나의 스냅샷으로 다루기 때문에 기기별 증분 반영이 어렵고, 스냅샷 병합이 불투명하다.
- **실시간 동기화의 경계가 희박하다.**  
  현재는 전체 백업/전체 복원 흐름이 기본이며, 기기 B에서 변경한 일부 메모만 받아오는 구성이 곧바로 어려워 충돌이 명확히 보이지 않는다.
- **복구/삭제 보정이 간접적이다.**  
  `serverMemoDeletes`로 삭제를 보정하지만, 영속성/삭제 의도/복구 우선순위를 명시적으로 구분하기보다 보정 규칙에 의존한다.
- **규모 확장성 한계**  
  다중 기기 동시 사용 시 “마지막 스냅샷”을 기준으로 overwrite 동작이 발생하기 쉬워 UI에서 의도된 충돌 표현이 어렵다.
- **플랫폼 확장 비용 증가**  
  웹앱/향후 모바일이 같은 사용자 계정으로 동작할 때, 개별 문서 기반 listener 방식이 아니라 스냅샷 단위로만 동기화해야 하므로 동기화 엔진을 새로 짜야 한다.

## 3) 권장 Firestore 모델

### 3.1 핵심 저장소 구조

#### 메모 본문/메타
`users/{uid}/memos/{memoId}`

- `title`
- `plainText`
- `richContent` (예: Tiptap/ProseMirror JSON)
- `style` (`backgroundColor`, `textColor`, `fontFamily`, `fontSize` 등)
- `syncMeta`
  - `createdAt`, `updatedAt`
- `deletedAt` (Soft delete 표시)
- `lastEditedBy` (`uid`, 선택: `displayName`, `email`, `deviceId`, `clientApp`)
- `contentHash` (중복/변경 검증용)
- `version` (Monotonic integer 또는 서버 타임스탬프 보조)

#### 기기별 창 상태 분리
`users/{uid}/memos/{memoId}/windowStates/{deviceId}` (권장)

- 메모 본문 문서의 하위 컬렉션으로 두어 `memoId`와 자연스럽게 연결
- 필드: `x`, `y`, `width`, `height`, `zOrderHint`, `isPinned`, `isMinimized`, `isHidden`, `updatedAt`, `deviceId`
- 이유: 화면 배치 데이터는 기기별 UX 환경이 다르므로 기기 간 공유하지 않는다.

#### 삭제 처리 (Tombstone/Soft Delete)
`users/{uid}/deletedMemos/{memoId}` 또는 `users/{uid}/memos/{memoId}` 내부 soft-delete 플래그 + `deletedAt` + `deletedBy`

- 운영 안정성 측면에서는 **soft delete가 가장 단순**하고 복원 비용이 낮다.
- 강제 삭제(영구 삭제)는 보존기간 이후 백엔드 유지보수 작업 또는 수동 클리너에서 처리한다.

#### 선택적 `syncEvents` 큐
`users/{uid}/syncEvents/{eventId}`

- 기본값은 선택 적용
- 필드: `memoId`, `type`(`upsert|delete`), `version`, `occurredAt`, `actor`, `deviceId`, `payloadHash`
- 장점: 오프라인/네트워크 경합에서 “누락된 이벤트 재재생” 추적에 유리
- 단점: 동기화 레이어가 더 복잡해지므로, v1에서는 `version` + `updatedAt` + listener 기반 동기화로 시작하고 추후 단계적으로 추가

### 3.2 권장 데이터 스키마 정리

- `memos`는 **진실의 원천(Truth source for memo content)**으로 둔다.
- `memos/{memoId}/windowStates/{deviceId}`는 **기기별 상태**로 둔다.
- `serverMeta`는 민감도별 분리:
  - `syncState`(local-only / cloud-stale / cloud-newer / conflict)
  - `clientClockSkewMs`(선택)로 타임스탬프 신뢰성 보완

## 4) 동기화 정책

### 4.1 원칙

1. **로컬 우선(Local-First)**  
   앱 실행 즉시 로컬 스토리지에서 렌더링을 시작하고, 인증/네트워크 상태와 무관하게 편집이 끊기지 않는다.
2. **자동 저장**  
   메모 수정은 debounce 기반으로 로컬 저장 후 업로드 큐에 등록한다.
3. **snapshot listener 기반 수신**  
   로그인 후 `users/{uid}/memos`에 대한 실시간 구독으로 원격 변경 반영한다.
4. **오프라인 큐**  
   네트워크가 끊겨도 로컬 큐에 변경사항을 축적하고, 재접속 시 업로드.
5. **마지막 작성자 기준 + 충돌 표시 기준 분리**  
   서버에서 받는 단일 변경은 `updatedAt + version + lastEditedBy` 정합성으로 평가.

### 4.2 동기화 동작 상세

- 편집 흐름:
  1. 사용자가 메모를 변경.
  2. 로컬 저장 즉시 반영(파일/SQLite/IndexedDB는 플랫폼별).
  3. queue에 `upsert` 이벤트 적재.
  4. 네트워크 가능 시 배치 업로드 + write batch/transaction 적용.
  5. Firestore listener는 원격 최신값을 수신해 로컬 목록 갱신.
- 삭제 흐름:
  1. 사용자가 삭제를 확정.
  2. 로컬 soft-delete(`deletedAt`, `syncState=queued`) 반영.
  3. 클라우드 soft-delete 동기화.
  4. UI에서 휴지통/복구 기간 정책 적용.
- 창 상태:
  - local 변경은 `memos/{memoId}/windowStates/{deviceId}`에 저장.
  - 서버 동기화는 선택적으로 수행되며, 기본값은 “기기별 독립 + 로컬 우선” 유지.

### 4.3 충돌 탐지 및 표시

- 충돌 후보 조건:
  - 같은 `memoId`를 서로 다른 기기에서 모두 `deletedAt`/`updatedAt` 기준으로 거의 동일한 시점에 수정.
  - 업로드 타임스탬프가 뒤집히거나, 동일버전에서 서로 다른 `contentHash`가 들어오는 경우.
- 처리:
  - 로컬을 기본 채택(`updatedAt` 최신 + 같은 기기 우선/현재 활성 기기 우선 정책).
  - 다만, `conflict` 상태는 해당 메모에 `syncState=conflict` 표시 + 히스토리/복원 버튼 제공.
  - 사용자가 수동으로 “로컬 우선/원격 덮어쓰기/병합 대기” 선택 가능하게 단계적으로 확장.

## 5) 플랫폼별 역할

### 5.1 Windows Tauri 앱
- 기본 UI/운영 담당: 트레이, 윈도우 생성/복원, 시작 프로그램, 로컬 DB(SQLite) 및 파일 다이얼로그.
- Sync Layer는 공통 패키지(`memo-sync`) 사용.
- 오프라인 큐 재시도 정책, 백그라운드 업로드/다운로드, 충돌 상태 알림을 담당.

### 5.2 macOS Tauri 앱
- Windows와 동일한 동기화 도메인 사용.
- 창 영속성/시스템 트레이 차이에 맞춰 `windowStates`의 macOS 기기 ID를 별도 할당.
- macOS 특화 저장 경로/시작 등록 API만 플랫폼 어댑터에서 처리.

### 5.3 Web/PWA
- 인증/Cloud Sync 체인은 동일 Firestore 경로 사용.
- 로컬 저장은 IndexedDB; Sync adapter는 동일 인터페이스 준수.
- 오프라인 큐 정책은 브라우저 탭/서비스워커 lifecycle을 고려해 큐 만료 정책과 재시도 규칙 조정.

### 5.4 추후 모바일(확장)
- 웹뷰 또는 PWA 우선 탑재.
- 기기별 창 상태는 모바일에서는 화면 제약상 최소화(저장하지 않거나 축소).
- 메모 본문 동기화만 우선 지원하고, 창 상태/트레이는 플랫폼에 맞게 비활성.

## 6) 단계별 구현 순서 및 검증 항목

### Phase 1: 모델 정비 (기반 구축)
- `memos` 문서 스키마 확정, `windowStates` 하위 컬렉션 분리, `deletedAt`/`lastEditedBy`/`version` 추가
- Sync 이벤트 타입/저장소 인터페이스 분리
- 동기화 도메인 인터페이스(`applyRemoteChange`, `queueOfflineMutation`) 정의

검증 항목:
- 도메인 타입 단위 테스트(타입/검증/직렬화)
- 기존 백업 로직이 깨지지 않도록 기존 payload 파서 테스트 유지
- 규칙 문서 템플릿 초안 생성

### Phase 2: 동기화 엔진 1차
- 로컬 우선 동작 + 자동저장 + 업로드 큐 구현
- Firestore snapshot listener로 원격 변경 반영
- 오프라인 큐 재시도 백오프 적용

검증 항목:
- 오프라인에서 편집 후 재연결 시 로컬 변경 재전송
- listener 수신 시 중복 적용 방지(idempotent 처리)
- 단일 기기 다중 창에서 충돌이 없는지 수동 검증

### Phase 3: soft-delete + 충돌 표시
- 삭제 tombstone 정책 적용
- `syncState: conflict` 상태 관리
- 충돌 감지 조건 및 conflict UI 표식

검증 항목:
- 동일 메모 동시 수정 시 로컬 우선 반영 + 충돌 표시
- 삭제 후 즉시 복구 플로우 동작
- 백업/복원 수동 버튼과 실시간 동기화 경로의 충돌 없음 확인

### Phase 4: 플랫폼 동기화 정렬
- Windows/macOS 앱이 동일 동기화 adapter 사용
- 웹앱(및 PWA)에서 동일 사용자로 `users/{uid}` 데이터 공유
- 디바이스별 창 상태 분리 적용

검증 항목:
- 같은 계정으로 2기기(예: Windows + web)에서 메모 생성/수정 후 cross-device 반영
- 기기별 창 상태 분리 확인(위치·크기 오염 없음)
- 로그인/로그아웃 전환 시 동기화 상태 정합성 유지

### Phase 5: 운영 하드닝
- Firestore rules 강화, 인덱스 적용
- 보안 감사 포인트 정리
- 마이그레이션 모드에서 듀얼 동작 전환 지원(legacy+new)

검증 항목:
- rules emulator + integration에서 uid 외부 접근 차단
- 인덱스 누락으로 인한 listener 지연/실패 확인
- 장애 대응 문서 + 수동 복구 시나리오(백업 무결성) 점검

## 7) 기존 모델에서 새 모델로의 마이그레이션 방법

### 7.1 동시 운영(하이브리드) 전략
- 1단계: 기존 `backupSnapshots`/`serverMemoDeletes` **읽기 유지**
- 1.5단계: 새 `memos`에 기존 스냅샷의 최신 유효 데이터 마이그레이션 실행(버전 부여)
- 2단계: 신규 편집은 `memos` 중심 경로로만 쓰기
- 3단계: 일정 기간 뒤 legacy 경로를 read-only로 축소 후 deprecate

### 7.2 마이그레이션 절차(권장)
1. 백업 스냅샷 조회: `serverMemoDeletes`를 반영해 현재 유효 메모만 추출
2. 각 메모를 `memoId` 기준으로 정규화(`richContent`, `plainText`, `style`, `timestamps`, `lastEditedBy`)
3. 새 문서(`memos/{memoId}`) 생성/업데이트(버전 시작값 부여)
4. 삭제 정보는 soft-delete(`deletedAt`)로 변환
5. 기기별 창 상태는 `memos/{memoId}/windowStates/{deviceId}` 하위 문서로 생성(기기별 상태만 있는 경우에 한해)
6. 마이그레이션 수행 후 동일 계정으로 수동 복원 시 두 모델 비교 후 차이 리포트

### 7.3 안전장치
- 마이그레이션은 원자적이진 않더라도 **멱등성(idempotent)** 보장.
- 실행 중 실패해도 기존 `backupSnapshots` 경로는 보존되어 수동 복구 가능.
- 마이그레이션 로그(시작 시각, 대상 uid, 처리 개수, 실패 개수, 샘플 에러)를 남기고, 추적 가능한 감사표시로 보관.
- 운영 초기에 **legacy read + new read dual viewer** 제공해 데이터 회귀를 줄임.

## 8) 보안 / Firestore Rules / 인덱스 / 개인정보

### 8.1 보안 원칙
- 사용자 인증(`request.auth != null`) + `request.auth.uid == userId` 제한 필수.
- 클라이언트는 자기 문서만 접근.
- `deletedAt`이 설정된 문서라도 사용자 소유권 확인 동일 적용.
- 클라이언트에서 서버 시크릿 값/OAuth 비밀 주입 금지(현재 방식 유지).

### 8.2 권장 규칙(개요)
- `match /users/{uid}/memos/{memoId}`: 읽기/쓰기 모두 `isAuthenticatedUser(uid)`만 허용
- `match /users/{uid}/memos/{memoId}/windowStates/{deviceId}`: 동일한 사용자 소유 조건
- `match /users/{uid}/syncEvents/{eventId}`: 로그인 사용자만 쓰기/읽기 가능 + 데이터 소유 검증
- `match /users/{uid}/backupSnapshots/{snapshotId}`: 과도기용 read/optional write 정책(legacy 호환 기간만 허용)
- 규칙에서 `request.resource.data.keys()` 제한으로 필드 주입 공격 완화

### 8.3 인덱스
- 자주 쓰는 쿼리 패턴에 맞춘 composite index:
  - `users/{uid}/memos`: `updatedAt desc`
  - `users/{uid}/memos`: `deletedAt asc`, `updatedAt desc`
  - `users/{uid}/memos/{memoId}/windowStates/{deviceId}`: 단일 문서 접근이 주가 되므로 보통 단일 조회
  - `users/{uid}/syncEvents`: (`occurredAt desc`, `memoId`, `type`)는 이벤트 추적용

### 8.4 개인정보/컴플라이언스
- 클라우드는 사용자 텍스트/메모 내용이 직접 저장되므로 민감도 분류 및 UI 경고 문구 제공.
- 익명화/마스킹은 현재 범위를 벗어나므로 별도 동의 정책 수립 필요.
- 로그에는 메모 본문을 출력하지 않고 `memoId`, `uid`, 에러 코드만 남김.
- 계정 삭제/탈퇴 시 사용자 하위 경로 전체 삭제 정책을 문서화(법적 필요 시 보존 기간 정책 반영).
