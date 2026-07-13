# H Memo KST Daily Backup Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** H Memo의 Windows, macOS, 웹앱이 대한민국 날짜별 최신 백업 1개를 최근 365일 동안 공유하고, 동일 내용 반복 저장과 복원 목록의 불필요한 본문 읽기를 제거합니다.

**Architecture:** 기존 불변 스냅샷과 활성 세대 포인터를 유지하되 새 쓰기는 Firestore 스키마 v3로 기록합니다. 공용 `memo-sync` 패키지가 KST 날짜, 콘텐츠 해시, 날짜별 요약, 점진 정리를 담당하고, Desktop/Web은 메타데이터 목록을 먼저 표시한 뒤 사용자가 선택한 스냅샷만 지연 로드합니다. 새 백업은 완전 저장·활성화 후에만 이전 중복을 정리하므로 정리 실패가 최신 데이터에 영향을 주지 않습니다.

**Tech Stack:** TypeScript 5.7, React 19, Tauri 2, Firebase Authentication, Cloud Firestore, Vitest 4, Firebase Rules Unit Testing, Rust/Cargo

## Global Constraints

- 모든 날짜 경계와 보존 기간은 `Asia/Seoul` 기준으로 계산합니다.
- 오늘과 직전 364개 KST 달력 날짜만 보존하며 백업하지 않은 날짜에는 문서를 만들지 않습니다.
- 같은 KST 날짜에 내용이 같으면 Firestore 쓰기를 생략하고, 내용이 다르면 새 스냅샷을 먼저 활성화합니다.
- 사용자 복원 목록에는 KST 날짜별 가장 늦은 `complete` 백업 1개만 표시합니다.
- 활성 및 대기 스냅샷은 어떤 정리 작업에서도 삭제하지 않습니다.
- 정리는 새 스냅샷 활성화 후 실행하며 한 번에 최대 400개 Firestore 문서만 삭제합니다.
- 기존 v1·v2 백업 읽기와 복원을 유지하고 새 백업만 v3로 작성합니다.
- 수정 대상 책임이 500줄 이상 파일에 있으면 새 파일로 추출하며, 큰 App 파일에 백업 JSX나 새 핵심 로직을 추가하지 않습니다.
- Windows, macOS, 웹앱은 동일한 요약 타입, KST 정책, 복원 선택 컴포넌트를 사용합니다.
- 2026-07-13 업데이트 내역에 KST 일별 최신 백업과 365일 복원 기능을 기록합니다.
- 사용자 소유 미추적 파일 `h-memo-public-menu-fix.png`와 `img/`는 스테이징·수정·삭제하지 않습니다.
- 각 기능은 실패 테스트, 최소 구현, 통과 확인, 커밋 순서로 진행합니다.

---

## File Map

### Backup core

- `packages/memo-sync/src/backup.ts`: 공개 백업 함수만 조립합니다.
- `packages/memo-sync/src/backupTypes.ts`: 게이트웨이, 저장 결과, 스냅샷 요약 타입을 정의합니다.
- `packages/memo-sync/src/firestoreBackupDriver.ts`: Firebase SDK를 테스트 가능한 드라이버로 감쌉니다.
- `packages/memo-sync/src/firestoreBackupShared.ts`: Firestore 경로와 공용 파서·검증 함수를 제공합니다.
- `packages/memo-sync/src/firestoreBackupGateway.ts`: 작은 위임형 `FirestoreBackupGateway` 클래스를 제공합니다.
- `packages/memo-sync/src/firestoreBackupWrite.ts`: v3 스냅샷 작성, lease, 활성화를 담당합니다.
- `packages/memo-sync/src/firestoreBackupRead.ts`: v1·v2·v3 메타데이터와 선택 스냅샷을 읽습니다.
- `packages/memo-sync/src/firestoreCurrentMemoStore.ts`: 현재 서버 메모 및 삭제 표식을 유지합니다.
- `packages/memo-sync/src/backupKstDate.ts`: KST 날짜 키와 365일 범위를 계산합니다.
- `packages/memo-sync/src/backupFingerprint.ts`: 안정적 직렬화, SHA-256, 미리보기를 생성합니다.
- `packages/memo-sync/src/backupRetention.ts`: 날짜별 최신 요약과 정리 우선순위를 계산합니다.
- `packages/memo-sync/src/backupSnapshotSummary.ts`: v1·v2·v3 메타데이터를 공용 요약으로 변환합니다.
- `packages/memo-sync/src/firestoreBackupCleanup.ts`: 최대 400개 문서의 점진 삭제를 실행합니다.

### Test support

- `packages/memo-sync/src/testing/fakeFirestoreBackupDriver.ts`: Firestore 백업 테스트용 드라이버와 fixture를 제공합니다.
- `packages/memo-sync/src/backup.public.test.ts`: 공개 백업 API와 복원 필터를 검증합니다.
- `packages/memo-sync/src/firestoreBackupGateway.write.test.ts`: 정상 작성과 대용량 청크를 검증합니다.
- `packages/memo-sync/src/firestoreBackupGateway.failure.test.ts`: 작성·활성화 실패의 원자성을 검증합니다.
- `packages/memo-sync/src/firestoreBackupGateway.compat.test.ts`: v1·v2 및 memo ID 호환성을 검증합니다.
- `packages/memo-sync/src/firestoreBackupGateway.concurrency.test.ts`: lease, 삭제, 동시 백업 경쟁을 검증합니다.

### UI and platform integration

- `packages/memo-ui/src/BackupHistoryDialog.tsx`: 공용 날짜별 복원 선택 다이얼로그입니다.
- `packages/memo-ui/src/BackupHistoryDialog.test.tsx`: 접근성, KST 표기, 선택 이벤트를 검증합니다.
- `packages/memo-ui/src/backupStatusText.ts`: 저장 결과를 한국어 상태 메시지로 변환합니다.
- `packages/memo-ui/src/formatDateTime.ts`: 선택적 시간대 인자를 지원합니다.
- `apps/desktop/src/App.tsx`: 공용 다이얼로그와 지연 복원 API를 연결합니다.
- `apps/web/src/WebApp.tsx`: 공용 다이얼로그와 지연 복원 API를 연결합니다.
- `firestore.rules`: v3 작성·완료·비활성 정리 권한을 정의합니다.
- `scripts/firestore-rules-emulator.test.ts`: 실제 Firestore Rules Emulator에서 권한을 검증합니다.
- `docs/firebase-setup.md`: v3 경로, 정리 권한, 배포 순서를 설명합니다.

---

### Task 1: 기존 백업 모듈과 테스트를 책임별로 분리

**Files:**
- Create: `packages/memo-sync/src/backupTypes.ts`
- Create: `packages/memo-sync/src/firestoreBackupDriver.ts`
- Create: `packages/memo-sync/src/firestoreBackupShared.ts`
- Create: `packages/memo-sync/src/firestoreBackupGateway.ts`
- Create: `packages/memo-sync/src/firestoreBackupWrite.ts`
- Create: `packages/memo-sync/src/firestoreBackupRead.ts`
- Create: `packages/memo-sync/src/firestoreCurrentMemoStore.ts`
- Create: `packages/memo-sync/src/testing/fakeFirestoreBackupDriver.ts`
- Create: `packages/memo-sync/src/backup.public.test.ts`
- Create: `packages/memo-sync/src/firestoreBackupGateway.write.test.ts`
- Create: `packages/memo-sync/src/firestoreBackupGateway.failure.test.ts`
- Create: `packages/memo-sync/src/firestoreBackupGateway.compat.test.ts`
- Create: `packages/memo-sync/src/firestoreBackupGateway.concurrency.test.ts`
- Modify: `packages/memo-sync/src/backup.ts:1-957`
- Modify: `packages/memo-sync/src/index.ts:6-32`
- Delete: `packages/memo-sync/src/backup.test.ts`

**Interfaces:**
- Consumes: 기존 `BackupPayload`, `Memo`, memo document ID codec, Firebase Firestore SDK입니다.
- Produces: 기존 공개 함수명과 동작을 유지하는 분리된 백업 모듈입니다.

- [ ] **Step 1: 분리 전 기준 테스트를 실행합니다**

Run:

```bash
npm test -- packages/memo-sync/src/backup.test.ts --pool=forks
```

Expected: 기존 백업 테스트가 모두 PASS합니다.

- [ ] **Step 2: 공용 타입과 Firestore 문맥을 추출합니다**

`backupTypes.ts`에 다음 기존 계약을 이동합니다.

```ts
import type { BackupPayload, Memo } from "@h-memo/memo-core";

export type MemoBackupPayload = BackupPayload;

export type StoredBackupSnapshot = {
  id: string;
  payload: MemoBackupPayload;
  savedAt: string;
  source?: "firestore-v1";
};

export type StoredCurrentMemo = {
  memo: Memo;
  savedAt: string;
  snapshotId: string;
};

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}
```

`firestoreBackupShared.ts`에 드라이버 문맥을 정의합니다.

```ts
import type { Firestore } from "firebase/firestore";
import type { FirestoreBackupDriver } from "./firestoreBackupDriver";

export type FirestoreBackupContext = {
  firestore: Firestore;
  driver: FirestoreBackupDriver;
};

export const BACKUP_COLLECTIONS = {
  snapshots: "backupSnapshots",
  state: "backupState",
  currentState: "current",
  canonicalV2: "memosV2",
  snapshotLegacy: "memos",
  snapshotV2: "memosV2",
  deletedLegacy: "serverMemoDeletes",
  deletedV2: "serverMemoDeletesV2",
} as const;
```

- [ ] **Step 3: Gateway를 위임형 클래스로 바꿉니다**

`firestoreBackupGateway.ts`의 클래스는 각 저장소 함수에 위임만 수행합니다.

```ts
export class FirestoreBackupGateway implements BackupGateway {
  readonly context: FirestoreBackupContext;

  constructor(firestore: Firestore, driver: FirestoreBackupDriver = firebaseBackupDriver) {
    this.context = { firestore, driver };
  }

  saveBackup(userId: string, payload: MemoBackupPayload) {
    return saveFirestoreBackup(this.context, userId, payload);
  }

  loadLatestBackup(userId: string) {
    return loadLatestFirestoreBackup(this.context, userId);
  }

  loadBackups(userId: string) {
    return loadAllFirestoreBackups(this.context, userId);
  }

  loadCurrentMemos(userId: string) {
    return loadFirestoreCurrentMemos(this.context, userId);
  }

  loadDeletedMemoIds(userId: string) {
    return loadFirestoreDeletedMemoIds(this.context, userId);
  }

  deleteCurrentMemo(userId: string, memoId: string) {
    return deleteFirestoreCurrentMemo(this.context, userId, memoId);
  }
}
```

기존 작성 코드는 `firestoreBackupWrite.ts`, 스냅샷 읽기는 `firestoreBackupRead.ts`, 현재 메모와 삭제 표식은 `firestoreCurrentMemoStore.ts`로 그대로 옮깁니다. 이 단계에서는 컬렉션명, 스키마 버전, 오류 문구, 트랜잭션 순서를 바꾸지 않습니다.

- [ ] **Step 4: 1,572줄 테스트 파일을 독립 테스트 파일로 분리합니다**

다음 범위를 이동하고 공용 driver/fixture는 `testing/fakeFirestoreBackupDriver.ts`에서 import합니다.

```text
backup.public.test.ts                         기존 433-725행
firestoreBackupGateway.write.test.ts          기존 726-1067행
firestoreBackupGateway.failure.test.ts        기존 1068-1234행
firestoreBackupGateway.compat.test.ts         기존 1235-1425행
firestoreBackupGateway.concurrency.test.ts    기존 1426-1572행
```

각 테스트 파일은 500줄 미만이어야 하며 원래 테스트 이름과 assertion을 유지합니다.

공용 `FakeFirestoreBackupDriver`는 기존 기본 시각을 유지하면서 KST 테스트가 서버 시각을 제어할 수 있도록 다음 메서드를 제공합니다.

```ts
private serverClockMs = Date.parse("2026-05-13T09:00:00.000Z");
private nextTimestamp = 0;

setServerClock(iso: string) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`Invalid fake server clock: ${iso}`);
  this.serverClockMs = parsed;
  this.nextTimestamp = 0;
}

private resolveServerTimestamp() {
  const value = new FakeTimestamp(
    new Date(this.serverClockMs + this.nextTimestamp * 1000).toISOString()
  );
  this.nextTimestamp += 1;
  return value;
}
```

기존 `SERVER_TIMESTAMP` 해석 지점은 `resolveServerTimestamp()`를 호출합니다.

- [ ] **Step 5: 분리 후 회귀 테스트와 타입 검사를 실행합니다**

Run:

```bash
npm test -- packages/memo-sync/src/backup.public.test.ts packages/memo-sync/src/firestoreBackupGateway.write.test.ts packages/memo-sync/src/firestoreBackupGateway.failure.test.ts packages/memo-sync/src/firestoreBackupGateway.compat.test.ts packages/memo-sync/src/firestoreBackupGateway.concurrency.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
```

Expected: 이동 전과 같은 테스트가 모두 PASS하고 TypeScript 오류가 없습니다.

- [ ] **Step 6: 구조 분리만 커밋합니다**

```bash
git add packages/memo-sync/src
git commit -m "refactor: split backup storage responsibilities"
```

---

### Task 2: KST 달력 계산과 콘텐츠 지문 추가

**Files:**
- Create: `packages/memo-sync/src/backupKstDate.ts`
- Create: `packages/memo-sync/src/backupKstDate.test.ts`
- Create: `packages/memo-sync/src/backupFingerprint.ts`
- Create: `packages/memo-sync/src/backupFingerprint.test.ts`

**Interfaces:**
- Consumes: `MemoBackupPayload`의 삭제되지 않은 메모입니다.
- Produces: `toKstDateKey`, `getKstRetentionStartKey`, `isKstDateInRetention`, `createBackupContentHash`, `createBackupPreviewText`입니다.

- [ ] **Step 1: KST 경계와 365일 범위 실패 테스트를 작성합니다**

```ts
import { describe, expect, it } from "vitest";
import {
  getKstRetentionStartKey,
  isKstDateInRetention,
  toKstDateKey,
} from "./backupKstDate";

describe("KST backup dates", () => {
  it("changes date exactly at KST midnight", () => {
    expect(toKstDateKey("2026-07-12T14:59:59.999Z")).toBe("2026-07-12");
    expect(toKstDateKey("2026-07-12T15:00:00.000Z")).toBe("2026-07-13");
  });

  it("keeps today and the prior 364 calendar dates", () => {
    expect(getKstRetentionStartKey("2026-07-13T03:00:00.000Z")).toBe("2025-07-14");
    expect(isKstDateInRetention("2025-07-14", "2026-07-13T03:00:00.000Z")).toBe(true);
    expect(isKstDateInRetention("2025-07-13", "2026-07-13T03:00:00.000Z")).toBe(false);
  });

  it("handles leap-year February by calendar date", () => {
    expect(getKstRetentionStartKey("2024-03-01T03:00:00.000Z", 2)).toBe("2024-02-29");
  });
});
```

- [ ] **Step 2: KST 달력 함수를 구현합니다**

`formatToParts`로 연·월·일을 직접 조합해 Node ICU 출력 차이를 피합니다.

```ts
export const BACKUP_TIME_ZONE = "Asia/Seoul";
export const BACKUP_RETENTION_DAYS = 365;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BACKUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toKstDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftKstDateKey(key: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid KST date key: ${key}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getKstRetentionStartKey(
  now: string | Date,
  retentionDays = BACKUP_RETENTION_DAYS
): string {
  const today = toKstDateKey(now);
  if (!today) throw new Error("Invalid retention clock");
  return shiftKstDateKey(today, -(retentionDays - 1));
}

export function isKstDateInRetention(key: string, now: string | Date): boolean {
  const today = toKstDateKey(now);
  if (!today) return false;
  return key >= getKstRetentionStartKey(now) && key <= today;
}
```

- [ ] **Step 3: 지문과 미리보기 실패 테스트를 작성합니다**

```ts
it("ignores payload time, memo order, and syncState while hashing stored content", async () => {
  const first = payloadWith({ createdAt: "2026-07-13T01:00:00.000Z", order: ["a", "b"] });
  const second = payloadWith({ createdAt: "2026-07-13T10:00:00.000Z", order: ["b", "a"] });
  second.memos[0]!.syncState = "backed-up";
  expect(await createBackupContentHash(first)).toBe(await createBackupContentHash(second));
});

it("changes the hash when restorable memo content changes", async () => {
  const first = payloadWith({ text: "첫 내용" });
  const second = payloadWith({ text: "바뀐 내용" });
  expect(await createBackupContentHash(first)).not.toBe(await createBackupContentHash(second));
});

it("limits the metadata preview to 240 characters", () => {
  expect(createBackupPreviewText(payloadWith({ text: "가".repeat(400) })).length).toBeLessThanOrEqual(240);
});
```

- [ ] **Step 4: 안정적 SHA-256 지문을 구현합니다**

```ts
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function restorableMemos(payload: MemoBackupPayload) {
  return payload.memos
    .filter((memo) => memo.deletedAt === null)
    .map(({ syncState: _syncState, ...memo }) => memo)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function createBackupContentHash(payload: MemoBackupPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(restorableMemos(payload))));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createBackupPreviewText(payload: MemoBackupPayload): string {
  const preview = restorableMemos(payload)
    .slice(0, 3)
    .map((memo) => memo.plainText.trim().replace(/\s+/g, " ").slice(0, 72) || "빈 메모")
    .join(", ");
  return (preview || "메모 없음").slice(0, 240);
}
```

- [ ] **Step 5: 유틸리티 테스트와 타입 검사를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-sync/src/backupKstDate.test.ts packages/memo-sync/src/backupFingerprint.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
git add packages/memo-sync/src/backupKstDate.ts packages/memo-sync/src/backupKstDate.test.ts packages/memo-sync/src/backupFingerprint.ts packages/memo-sync/src/backupFingerprint.test.ts
git commit -m "feat: add KST backup dates and fingerprints"
```

---

### Task 3: 스냅샷 요약과 날짜별 보존 계획 추가

**Files:**
- Create: `packages/memo-sync/src/backupSnapshotSummary.ts`
- Create: `packages/memo-sync/src/backupSnapshotSummary.test.ts`
- Create: `packages/memo-sync/src/backupRetention.ts`
- Create: `packages/memo-sync/src/backupRetention.test.ts`
- Modify: `packages/memo-sync/src/backupTypes.ts`

**Interfaces:**
- Consumes: Firestore 메타데이터와 `toKstDateKey`입니다.
- Produces: `BackupSnapshotSummary`, `selectDailyBackupSummaries`, `planBackupCleanupCandidates`입니다.

- [ ] **Step 1: 공용 요약 타입을 정의합니다**

```ts
export type BackupSchemaVersion = 1 | 2 | 3;

export type BackupSnapshotSummary = {
  id: string;
  savedAt: string | null;
  kstDate: string | null;
  memoCount: number;
  previewText: string;
  contentHash: string | null;
  schemaVersion: BackupSchemaVersion;
  state: "complete";
  legacyUndated: boolean;
};

export type BackupCleanupCandidate = {
  id: string;
  schemaVersion: BackupSchemaVersion;
  savedAt: string;
  kstDate: string;
  reason: "same-day-duplicate" | "expired";
};
```

- [ ] **Step 2: 날짜별 최신 선택과 정리 순서 실패 테스트를 작성합니다**

```ts
it("returns only the latest complete snapshot for each KST date", () => {
  const result = selectDailyBackupSummaries([
    summary("old", "2026-07-13T01:00:00.000Z"),
    summary("latest", "2026-07-13T12:00:00.000Z"),
    summary("previous", "2026-07-12T12:00:00.000Z"),
  ], "2026-07-13T12:30:00.000Z");
  expect(result.map((item) => item.id)).toEqual(["latest", "previous"]);
});

it("keeps undated legacy backups visible but never schedules them automatically", () => {
  const undated = { ...summary("legacy", null), legacyUndated: true };
  expect(selectDailyBackupSummaries([undated], "2026-07-13T12:30:00.000Z")).toEqual([undated]);
  expect(planBackupCleanupCandidates([undated], {
    activeSnapshotId: null,
    pendingSnapshotId: null,
    now: "2026-07-13T12:30:00.000Z",
  })).toEqual([]);
});

it("prioritizes duplicates before expired snapshots and protects active and pending IDs", () => {
  const candidates = planBackupCleanupCandidates(retentionFixture(), {
    activeSnapshotId: "active",
    pendingSnapshotId: "pending",
    now: "2026-07-13T12:30:00.000Z",
  });
  expect(candidates.map((item) => item.id)).toEqual(["duplicate", "expired"]);
});
```

- [ ] **Step 3: 요약 파서와 보존 계획을 구현합니다**

`parseBackupSnapshotSummary`는 v3 필드를 엄격하게 확인하고, v2는 `memoCount`와 `savedAt`, v1은 인라인 payload에서 메모 수와 미리보기를 얻습니다. v1 날짜가 파싱되지 않으면 `savedAt: null`, `kstDate: null`, `legacyUndated: true`로 반환합니다.

```ts
export function selectDailyBackupSummaries(
  summaries: BackupSnapshotSummary[],
  now: string | Date
): BackupSnapshotSummary[] {
  const latestByDate = new Map<string, BackupSnapshotSummary>();
  const undated: BackupSnapshotSummary[] = [];
  for (const summary of summaries) {
    if (!summary.kstDate) {
      if (summary.legacyUndated) undated.push(summary);
      continue;
    }
    if (!isKstDateInRetention(summary.kstDate, now)) continue;
    const previous = latestByDate.get(summary.kstDate);
    if (!previous || (summary.savedAt ?? "") > (previous.savedAt ?? "")) {
      latestByDate.set(summary.kstDate, summary);
    }
  }
  return [...latestByDate.values()]
    .sort((left, right) => (right.savedAt ?? "").localeCompare(left.savedAt ?? ""))
    .concat(undated.sort((left, right) => left.id.localeCompare(right.id)));
}
```

`planBackupCleanupCandidates`는 active/pending/날짜 불명 항목을 제외하고, 날짜별 유지 대상 이외의 항목을 `same-day-duplicate`, 보존 시작일 이전 항목을 `expired`로 분류한 뒤 해당 순서로 정렬합니다.

- [ ] **Step 4: 요약·보존 테스트를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-sync/src/backupSnapshotSummary.test.ts packages/memo-sync/src/backupRetention.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
git add packages/memo-sync/src/backupTypes.ts packages/memo-sync/src/backupSnapshotSummary.ts packages/memo-sync/src/backupSnapshotSummary.test.ts packages/memo-sync/src/backupRetention.ts packages/memo-sync/src/backupRetention.test.ts
git commit -m "feat: select daily backup retention points"
```

---

### Task 4: Firestore 스키마 v3 작성과 동일 내용 쓰기 생략

**Files:**
- Modify: `packages/memo-sync/src/backup.ts`
- Modify: `packages/memo-sync/src/backupTypes.ts`
- Modify: `packages/memo-sync/src/firestoreBackupWrite.ts`
- Modify: `packages/memo-sync/src/firestoreBackupRead.ts`
- Modify: `packages/memo-sync/src/firestoreBackupGateway.ts`
- Modify: `packages/memo-sync/src/backup.public.test.ts`
- Modify: `packages/memo-sync/src/firestoreBackupGateway.write.test.ts`
- Modify: `packages/memo-sync/src/firestoreBackupGateway.failure.test.ts`

**Interfaces:**
- Consumes: KST 날짜, 콘텐츠 해시, v3 요약 파서입니다.
- Produces: `BackupSaveResult`와 v3 불변 스냅샷입니다.

- [ ] **Step 1: 저장 결과 계약과 실패 테스트를 작성합니다**

```ts
export type BackupWriteOutcome = "created" | "replaced" | "unchanged";

export type BackupSaveResult = {
  path: string;
  snapshotId: string;
  outcome: BackupWriteOutcome;
  cleanupPending: boolean;
};

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<BackupSaveResult>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}
```

다음 테스트를 추가합니다.

```ts
it("skips every remote write for identical content on the same KST date", async () => {
  driver.setServerClock("2026-07-13T01:00:00.000Z");
  const first = await gateway.saveBackup("user-1", payloadAt("2026-07-13T01:00:00.000Z"));
  const commits = driver.transactionCommitCount;
  const second = await gateway.saveBackup("user-1", payloadAt("2026-07-13T10:00:00.000Z"));
  expect(second.outcome).toBe("unchanged");
  expect(second.snapshotId).toBe(first.snapshotId);
  expect(driver.transactionCommitCount).toBe(commits);
});

it("writes a new v3 snapshot when the same-day content changes", async () => {
  driver.setServerClock("2026-07-13T01:00:00.000Z");
  const first = await gateway.saveBackup("user-1", payloadWithText("첫 내용"));
  const second = await gateway.saveBackup("user-1", payloadWithText("바뀐 내용"));
  expect(second.outcome).toBe("replaced");
  expect(second.snapshotId).not.toBe(first.snapshotId);
  expect(driver.read(snapshotPath(second.snapshotId))).toMatchObject({
    schemaVersion: 3,
    state: "complete",
    contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
});

it("writes the same content again on the next KST date", async () => {
  driver.setServerClock("2026-07-12T14:59:00.000Z");
  const first = await gateway.saveBackup("user-1", payloadAt("2026-07-12T14:59:00.000Z"));
  driver.setServerClock("2026-07-12T15:01:00.000Z");
  const second = await gateway.saveBackup("user-1", payloadAt("2026-07-12T15:01:00.000Z"));
  expect(second.outcome).toBe("created");
  expect(second.snapshotId).not.toBe(first.snapshotId);
});
```

- [ ] **Step 2: v3 메타데이터 작성과 활성화를 구현합니다**

`saveFirestoreBackup`은 삭제되지 않은 메모만 저장하고, v3 active summary가 같은 KST 날짜·같은 해시일 때 기존 경로를 반환합니다.

```ts
export async function saveFirestoreBackup(
  context: FirestoreBackupContext,
  userId: string,
  payloadInput: MemoBackupPayload
): Promise<BackupSaveResult> {
  const payload = assertValidNewBackupPayload(payloadInput, userId);
  const activeMemos = payload.memos.filter((memo) => memo.deletedAt === null);
  assertUniqueActiveMemoIds(activeMemos);
  const contentHash = await createBackupContentHash(payload);
  const previewText = createBackupPreviewText(payload);
  const prior = await loadActiveSnapshotSummary(context, userId);
  const requestedDate = toKstDateKey(payload.createdAt);

  if (
    prior?.schemaVersion === 3 &&
    prior.kstDate !== null &&
    prior.kstDate === requestedDate &&
    prior.contentHash === contentHash
  ) {
    return {
      path: snapshotPath(userId, prior.id),
      snapshotId: prior.id,
      outcome: "unchanged",
      cleanupPending: false,
    };
  }

  const written = await writeAndActivateSchemaV3Snapshot(context, {
    userId,
    payload,
    activeMemos,
    contentHash,
    previewText,
  });
  const saved = await loadSnapshotSummaryById(context, userId, written.snapshotId);
  if (!saved?.kstDate) throw new Error("Completed backup is missing server savedAt");

  return {
    path: written.path,
    snapshotId: written.snapshotId,
    outcome: prior?.kstDate === saved.kstDate ? "replaced" : "created",
    cleanupPending: false,
  };
}
```

v3 작성 메타데이터는 정확히 다음 형태를 사용합니다.

```ts
{
  schemaVersion: 3,
  userId,
  clientCreatedAt: payload.createdAt,
  memoCount: activeMemos.length,
  contentHash,
  previewText,
  state: "writing",
  savedAt: null,
}
```

본문은 `backupSnapshots/{snapshotId}/memosV3/{encodedMemoId}`에 생성합니다. 기존 `memosV2` canonical reference staging과 pending lease 검증은 그대로 유지합니다. v3 lease를 만들 때 `backupState/current`에 `pendingSchemaVersion: 3`을 기록하고 기존 `activeSchemaVersion`은 보존합니다. 마지막 트랜잭션에서 메타데이터의 `state`와 `savedAt`만 변경한 뒤 `activeSchemaVersion: 3`, `pendingSchemaVersion: null`과 함께 새 ID를 활성화합니다. 기존 v2 상태 문서에 버전 필드가 없으면 `activeSchemaVersion`은 `null`로 읽습니다.

공개 `backupMemos`는 gateway 결과를 보존해 UI가 저장 결과를 구분할 수 있게 합니다.

```ts
const saved = await gateway.saveBackup(userId, payload);
return { ...saved, payload };
```

- [ ] **Step 3: 실패 원자성과 기존 동시성 테스트를 v3로 맞춥니다**

기존 assertion의 `schemaVersion: 2`, `memosV2` 스냅샷 경로를 새 쓰기에 한해서 `schemaVersion: 3`, `memosV3`로 변경합니다. v1·v2 fixture 경로와 호환성 assertion은 변경하지 않습니다. 실패한 snapshot은 `writing`, 기존 active snapshot은 `complete`로 남는지 확인합니다.

- [ ] **Step 4: 저장·실패 테스트를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-sync/src/backup.public.test.ts packages/memo-sync/src/firestoreBackupGateway.write.test.ts packages/memo-sync/src/firestoreBackupGateway.failure.test.ts packages/memo-sync/src/firestoreBackupGateway.concurrency.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
git add packages/memo-sync/src
git commit -m "feat: write KST-aware schema v3 backups"
```

---

### Task 5: 활성 백업을 보호하는 점진적 Firestore 정리

**Files:**
- Create: `packages/memo-sync/src/firestoreBackupCleanup.ts`
- Create: `packages/memo-sync/src/firestoreBackupCleanup.test.ts`
- Modify: `packages/memo-sync/src/firestoreBackupWrite.ts`
- Modify: `packages/memo-sync/src/firestoreBackupDriver.ts`
- Modify: `packages/memo-sync/src/testing/fakeFirestoreBackupDriver.ts`

**Interfaces:**
- Consumes: 보존 정리 후보, active/pending ID, Firestore driver입니다.
- Produces: `cleanupFirestoreBackups(...): Promise<{ deletedDocuments: number; pending: boolean }>`입니다.

- [ ] **Step 1: 삭제 순서·한도·보호 실패 테스트를 작성합니다**

```ts
it("never schedules active or pending snapshots", async () => {
  const result = await cleanupFirestoreBackups(context, "user-1", {
    now: "2026-07-13T12:00:00.000Z",
    activeSnapshotId: "active",
    pendingSnapshotId: "pending",
    maxDeletes: 400,
  });
  expect(driver.hasPath("users/user-1/backupSnapshots/active")).toBe(true);
  expect(driver.hasPath("users/user-1/backupSnapshots/pending")).toBe(true);
  expect(result.deletedDocuments).toBeGreaterThan(0);
});

it("deletes child memo documents before their parent metadata", async () => {
  seedSnapshotWithMemos(driver, "duplicate", 3);
  await cleanupFirestoreBackups(context, "user-1", cleanupOptions());
  expect(driver.committedDeletePaths).toEqual(expect.arrayContaining([
    "users/user-1/backupSnapshots/duplicate/memosV3/memo~0061",
    "users/user-1/backupSnapshots/duplicate",
  ]));
  expect(driver.committedDeletePaths.indexOf("users/user-1/backupSnapshots/duplicate"))
    .toBeGreaterThan(driver.committedDeletePaths.indexOf(
      "users/user-1/backupSnapshots/duplicate/memosV3/memo~0061"
    ));
});

it("stops at 400 deletes and resumes on the next successful backup", async () => {
  seedExpiredDocuments(driver, 450);
  const first = await cleanupFirestoreBackups(context, "user-1", cleanupOptions());
  expect(first.deletedDocuments).toBe(400);
  expect(first.pending).toBe(true);
  const second = await cleanupFirestoreBackups(context, "user-1", cleanupOptions());
  expect(second.deletedDocuments).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 제한 삭제 실행기를 구현합니다**

```ts
export const MAX_BACKUP_CLEANUP_DELETES = 400;
const SNAPSHOT_MEMO_COLLECTIONS = ["memosV3", "memosV2", "memos"] as const;

export async function cleanupFirestoreBackups(
  context: FirestoreBackupContext,
  userId: string,
  options: {
    now: string | Date;
    activeSnapshotId: string | null;
    pendingSnapshotId: string | null;
    maxDeletes?: number;
  }
): Promise<{ deletedDocuments: number; pending: boolean }> {
  const maxDeletes = Math.min(options.maxDeletes ?? MAX_BACKUP_CLEANUP_DELETES, 400);
  const summaries = await loadAllSnapshotSummaries(context, userId);
  const candidates = planBackupCleanupCandidates(summaries, options);
  const batch = context.driver.writeBatch(context.firestore);
  let deletes = 0;
  let pending = false;

  for (const candidate of candidates) {
    const snapshotRef = snapshotDocument(context, userId, candidate.id);
    const children = [];
    for (const collectionName of SNAPSHOT_MEMO_COLLECTIONS) {
      const docs = await context.driver.getDocs(
        context.driver.collection(snapshotRef, collectionName)
      );
      children.push(...docs.docs);
    }
    const remaining = maxDeletes - deletes;
    if (children.length + 1 > remaining) {
      for (const child of children.slice(0, remaining)) batch.delete(child.ref);
      deletes += Math.min(children.length, remaining);
      pending = true;
      break;
    }
    for (const child of children) batch.delete(child.ref);
    batch.delete(snapshotRef);
    deletes += children.length + 1;
    if (deletes === maxDeletes) {
      pending = candidates.at(-1)?.id !== candidate.id;
      break;
    }
  }

  if (deletes > 0) await batch.commit();
  return { deletedDocuments: deletes, pending };
}
```

실행 직전에 `backupState/current`를 다시 읽고 active/pending ID가 options와 달라졌다면 새 보호 ID로 후보를 다시 계산합니다. 이 재검증은 동시 백업 중 오래된 계획이 새 active를 삭제하는 것을 막습니다.

- [ ] **Step 3: 활성화 후 정리를 연결하고 정리 실패를 비치명적으로 반환합니다**

`saveFirestoreBackup`의 v3 활성화 이후에만 정리를 호출합니다.

```ts
let cleanupPending = false;
try {
  const state = await loadBackupState(context, userId);
  const cleanup = await cleanupFirestoreBackups(context, userId, {
    now: saved.savedAt ?? payload.createdAt,
    activeSnapshotId: state.activeSnapshotId,
    pendingSnapshotId: state.pendingSnapshotId,
  });
  cleanupPending = cleanup.pending;
} catch {
  cleanupPending = true;
}

return { path: written.path, snapshotId: written.snapshotId, outcome, cleanupPending };
```

`unchanged` 결과에서는 삭제를 실행하지 않아 Firestore 쓰기 0회를 보장합니다.

- [ ] **Step 4: 정리 테스트와 저장 회귀 테스트를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-sync/src/firestoreBackupCleanup.test.ts packages/memo-sync/src/firestoreBackupGateway.write.test.ts packages/memo-sync/src/firestoreBackupGateway.failure.test.ts packages/memo-sync/src/firestoreBackupGateway.concurrency.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
git add packages/memo-sync/src
git commit -m "feat: prune duplicate and expired backups safely"
```

---

### Task 6: 메타데이터 목록과 선택 스냅샷 지연 복원

**Files:**
- Modify: `packages/memo-sync/src/backup.ts`
- Modify: `packages/memo-sync/src/backupTypes.ts`
- Modify: `packages/memo-sync/src/firestoreBackupRead.ts`
- Modify: `packages/memo-sync/src/firestoreBackupGateway.ts`
- Modify: `packages/memo-sync/src/backup.public.test.ts`
- Modify: `packages/memo-sync/src/firestoreBackupGateway.compat.test.ts`
- Modify: `packages/memo-sync/src/index.ts`

**Interfaces:**
- Consumes: v1·v2·v3 summary parser와 기존 삭제 표식입니다.
- Produces: `listBackupSnapshotSummaries`와 `loadBackupSnapshot`입니다.

이 작업에서 임시 `loadLatestBackup`/`loadBackups` 계약을 메타데이터 우선 계약으로 교체합니다.

```ts
export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<BackupSaveResult>;
  listBackupSummaries(userId: string): Promise<BackupSnapshotSummary[]>;
  loadBackup(userId: string, snapshotId: string): Promise<unknown | null>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}
```

- [ ] **Step 1: 본문 미조회와 선택 로드 실패 테스트를 작성합니다**

```ts
it("lists v2 and v3 history without reading snapshot memo subcollections", async () => {
  seedV2AndV3Snapshots(driver);
  driver.readCollectionPaths.length = 0;
  const summaries = await listBackupSnapshotSummaries(gateway, "user-1", NOW);
  expect(summaries).toHaveLength(2);
  expect(driver.readCollectionPaths).not.toContainEqual(
    expect.stringMatching(/backupSnapshots\/[^/]+\/memos(V2|V3)?$/)
  );
});

it("loads and validates only the selected snapshot payload", async () => {
  seedV3Snapshot(driver, "selected");
  seedV3Snapshot(driver, "other");
  const payload = await loadBackupSnapshot(gateway, "user-1", "selected");
  expect(payload?.memos[0]?.plainText).toBe("선택 메모");
  expect(driver.readCollectionPaths).toContain(
    "users/user-1/backupSnapshots/selected/memosV3"
  );
  expect(driver.readCollectionPaths).not.toContain(
    "users/user-1/backupSnapshots/other/memosV3"
  );
});
```

- [ ] **Step 2: Gateway 읽기 계약을 구현합니다**

```ts
export async function listBackupSnapshotSummaries(
  gateway: BackupGateway,
  userId: string,
  now = new Date().toISOString()
): Promise<BackupSnapshotSummary[]> {
  return selectDailyBackupSummaries(await gateway.listBackupSummaries(userId), now);
}

export async function loadBackupSnapshot(
  gateway: BackupGateway,
  userId: string,
  snapshotId: string
): Promise<MemoBackupPayload | null> {
  const stored = await gateway.loadBackup(userId, snapshotId);
  if (stored === null) return null;
  const parsed = toStoredBackupSnapshot(stored, userId);
  if (!parsed) return null;
  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  return filterDeletedServerMemos(parsed.payload, deletedMemoIds);
}
```

`restoreLatestBackup`은 summary 목록의 첫 항목 ID를 `loadBackupSnapshot`에 전달합니다. v1은 부모 인라인 payload, v2는 `memosV2`와 legacy `memos`, v3는 `memosV3`를 선택 시점에만 읽습니다. 유효하지 않은 memo wrapper가 하나라도 있으면 부분 payload를 반환하지 않습니다.

- [ ] **Step 3: 공개 export와 호환성 테스트를 갱신합니다**

`index.ts`에서 다음을 export합니다.

```ts
export {
  FirestoreBackupGateway,
  backupMemos,
  deleteBackedUpMemo,
  listBackedUpMemos,
  listBackupSnapshotSummaries,
  loadBackupSnapshot,
  restoreLatestBackup,
} from "./backup";
export type {
  BackupSaveResult,
  BackupSnapshotSummary,
  BackupWriteOutcome,
} from "./backupTypes";
```

v1 malformed timestamp, v1 strict validation, v2 child wrapper 검증, v3 child wrapper 검증을 각각 유지합니다.

- [ ] **Step 4: 공개 API와 호환성 테스트를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-sync/src/backup.public.test.ts packages/memo-sync/src/firestoreBackupGateway.compat.test.ts packages/memo-sync/src/backupSnapshotSummary.test.ts --pool=forks
npm run typecheck -w packages/memo-sync
git add packages/memo-sync/src
git commit -m "feat: load backup history metadata on demand"
```

---

### Task 7: Firestore v3 및 비활성 정리 보안 규칙 검증

**Files:**
- Modify: `firestore.rules`
- Modify: `scripts/firestore-rules-policy.test.ts`
- Create: `scripts/firestore-rules-emulator.test.ts`
- Modify: `firebase.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: v3 metadata shape, `backupState/current` active/pending ID입니다.
- Produces: 소유자만 v3를 작성하고 비활성 스냅샷만 정리할 수 있는 규칙입니다.

- [ ] **Step 1: Rules Emulator 의존성과 실행 스크립트를 추가합니다**

Run:

```bash
npm install --save-dev @firebase/rules-unit-testing firebase-tools
```

`package.json`에 다음 스크립트를 추가합니다.

```json
"test:firestore-rules": "firebase emulators:exec --only firestore \"node scripts/run-vitest.mjs run scripts/firestore-rules-emulator.test.ts --pool=forks\""
```

`firebase.json`에는 로컬 전용 포트를 추가합니다.

```json
{
  "firestore": { "rules": "firestore.rules" },
  "emulators": { "firestore": { "port": 8080 } }
}
```

- [ ] **Step 2: 실제 권한 실패 테스트를 먼저 작성합니다**

`scripts/firestore-rules-emulator.test.ts`는 `initializeTestEnvironment`와 `withSecurityRulesDisabled`를 사용해 다음을 검증합니다.

```ts
it("allows the owner to create and complete a schema-v3 snapshot", async () => {
  const owner = testEnv.authenticatedContext("owner").firestore();
  const ref = doc(owner, "users/owner/backupSnapshots/v3");
  await assertSucceeds(setDoc(ref, validWritingV3("owner")));
  await assertSucceeds(updateDoc(ref, { state: "complete", savedAt: serverTimestamp() }));
});

it("denies deleting active or pending snapshots and their children", async () => {
  await seedActiveAndPendingSnapshots();
  const owner = testEnv.authenticatedContext("owner").firestore();
  await assertFails(deleteDoc(doc(owner, "users/owner/backupSnapshots/active")));
  await assertFails(deleteDoc(doc(owner, "users/owner/backupSnapshots/active/memosV3/memo~0061")));
  await assertFails(deleteDoc(doc(owner, "users/owner/backupSnapshots/pending")));
});

it("allows only the owner to delete an inactive snapshot and child", async () => {
  await seedInactiveSnapshot();
  const owner = testEnv.authenticatedContext("owner").firestore();
  const other = testEnv.authenticatedContext("other").firestore();
  await assertFails(deleteDoc(doc(other, "users/owner/backupSnapshots/old")));
  await assertSucceeds(deleteDoc(doc(owner, "users/owner/backupSnapshots/old/memosV3/memo~0061")));
  await assertSucceeds(deleteDoc(doc(owner, "users/owner/backupSnapshots/old")));
});

it("denies adding a memo document after a v3 snapshot is complete", async () => {
  await seedCompletedSnapshot();
  const owner = testEnv.authenticatedContext("owner").firestore();
  await assertFails(setDoc(
    doc(owner, "users/owner/backupSnapshots/complete/memosV3/memo~0061"),
    validSnapshotMemo("owner", "a")
  ));
});
```

- [ ] **Step 3: v3 shape와 비활성 삭제 규칙을 구현합니다**

규칙에 다음 핵심 함수를 추가합니다.

```text
function hasValidSchemaV3SnapshotShape(uid) {
  return request.resource.data.keys().hasOnly([
      "schemaVersion", "userId", "clientCreatedAt", "memoCount",
      "contentHash", "previewText", "state", "savedAt"
    ])
    && request.resource.data.schemaVersion == 3
    && request.resource.data.userId == uid
    && request.resource.data.clientCreatedAt is string
    && request.resource.data.memoCount is int
    && request.resource.data.memoCount >= 0
    && request.resource.data.contentHash is string
    && request.resource.data.contentHash.matches("^[0-9a-f]{64}$")
    && request.resource.data.previewText is string
    && request.resource.data.previewText.size() <= 240
    && (request.resource.data.state == "writing" || request.resource.data.state == "complete")
    && (request.resource.data.savedAt == null || request.resource.data.savedAt is timestamp);
}

function isInactiveSnapshot(uid, snapshotId) {
  let statePath = /databases/$(database)/documents/users/$(uid)/backupState/current;
  return !exists(statePath) || (
    get(statePath).data.activeSnapshotId != snapshotId
    && get(statePath).data.pendingSnapshotId != snapshotId
  );
}

function isPendingWritingV3Snapshot(uid, snapshotId) {
  let statePath = /databases/$(database)/documents/users/$(uid)/backupState/current;
  let snapshotPath = /databases/$(database)/documents/users/$(uid)/backupSnapshots/$(snapshotId);
  return exists(statePath)
    && get(statePath).data.pendingSnapshotId == snapshotId
    && get(snapshotPath).data.schemaVersion == 3
    && get(snapshotPath).data.state == "writing";
}
```

`backupState/current` shape에는 선택 필드 `activeSchemaVersion`, `pendingSchemaVersion`을 추가합니다. 새 v3 client는 pending lease와 activation에서 이 필드를 반드시 사용하고, 이미 설치된 v2 client의 버전 필드 없는 lease/activation도 계속 허용합니다. `backupSnapshots/{snapshotId}`는 owner의 v2 또는 v3 create/complete를 허용하고, delete는 `isOwner(uid) && isInactiveSnapshot(uid, snapshotId)`만 허용합니다. `memosV3/{memoId}` create는 owner이면서 `isPendingWritingV3Snapshot(uid, snapshotId)`인 경우에만 허용하고, delete는 비활성 snapshot에만 허용합니다. 따라서 활성화된 스냅샷에 새 본문을 덧붙일 수 없습니다. v1·v2 read와 v2 snapshot memo 불변성은 유지합니다. 활성화 검증은 schemaVersion 2 또는 3의 `complete` 스냅샷을 허용합니다.

- [ ] **Step 4: 정적·Emulator 규칙 테스트와 CI를 연결합니다**

`.github/workflows/ci.yml`의 Ubuntu 작업에 일반 테스트 다음 단계를 추가합니다.

```yaml
- name: Test Firestore security rules
  run: npm run test:firestore-rules
```

Run:

```bash
npm test -- scripts/firestore-rules-policy.test.ts --pool=forks
npm run test:firestore-rules
```

Expected: owner v3 create/complete와 inactive delete는 PASS하고 active/pending/다른 UID 삭제는 DENY됩니다.

- [ ] **Step 5: 보안 규칙을 커밋합니다**

```bash
git add firestore.rules scripts/firestore-rules-policy.test.ts scripts/firestore-rules-emulator.test.ts firebase.json package.json package-lock.json .github/workflows/ci.yml
git commit -m "feat: secure schema v3 backup retention"
```

---

### Task 8: 공용 복원 선택 UI와 상태 메시지 추가

**Files:**
- Create: `packages/memo-ui/src/BackupHistoryDialog.tsx`
- Create: `packages/memo-ui/src/BackupHistoryDialog.test.tsx`
- Create: `packages/memo-ui/src/backupStatusText.ts`
- Create: `packages/memo-ui/src/backupStatusText.test.ts`
- Modify: `packages/memo-ui/src/formatDateTime.ts`
- Modify: `packages/memo-ui/src/formatDateTime.test.ts`
- Modify: `packages/memo-ui/src/index.ts`

**Interfaces:**
- Consumes: 구조적으로 `BackupSnapshotSummary`와 `BackupSaveResult`에 맞는 UI props입니다.
- Produces: `BackupHistoryDialog`, `formatBackupSaveStatus`, KST 시간 표기입니다.

- [ ] **Step 1: KST 표기와 다이얼로그 접근성 실패 테스트를 작성합니다**

```tsx
it("renders one KST-dated item and restores by snapshot ID", async () => {
  const onRestore = vi.fn();
  render(
    <BackupHistoryDialog
      isOpen
      isBusy={false}
      items={[{
        id: "snapshot-1",
        savedAt: "2026-07-12T15:30:00.000Z",
        kstDate: "2026-07-13",
        memoCount: 3,
        previewText: "111, 222, 333",
        legacyUndated: false,
      }]}
      onClose={vi.fn()}
      onRestore={onRestore}
    />
  );
  expect(screen.getByText("2026-07-13")).toBeInTheDocument();
  expect(screen.getByText(/오전 12:30/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "2026-07-13 백업 복원" }));
  expect(onRestore).toHaveBeenCalledWith("snapshot-1");
});

it("closes with Escape and disables restore while busy", async () => {
  const onClose = vi.fn();
  render(<BackupHistoryDialog isOpen isBusy items={[item]} onClose={onClose} onRestore={vi.fn()} />);
  expect(screen.getByRole("button", { name: /백업 복원/ })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 공용 컴포넌트와 상태 메시지를 구현합니다**

```ts
export type BackupHistoryItem = {
  id: string;
  savedAt: string | null;
  kstDate: string | null;
  memoCount: number;
  previewText: string;
  legacyUndated: boolean;
};

export type BackupHistoryDialogProps = {
  isOpen: boolean;
  isBusy: boolean;
  items: BackupHistoryItem[];
  onClose: () => void;
  onRestore: (snapshotId: string) => void;
};
```

컴포넌트는 기존 `backup-history-*` class를 그대로 사용해 큰 CSS 파일을 수정하지 않습니다. 날짜는 `item.kstDate ?? "기존 백업"`, 시각은 `formatDateTime(item.savedAt ?? "", "ko-KR", "Asia/Seoul")`, 개수는 `백업 당시 ${item.memoCount}개 메모`로 표시합니다. 닫기 버튼에 초기 focus를 주고 Escape listener를 effect cleanup과 함께 등록합니다.

`formatDateTime`의 호환 가능한 시그니처는 다음과 같습니다.

```ts
const INVALID_DATE_LABEL = "날짜 정보 없음";

function normalizeKoreanDayPeriod(
  part: Intl.DateTimeFormatPart,
  isKoreanLocale: boolean
): string {
  if (!isKoreanLocale || part.type !== "dayPeriod") return part.value;
  if (part.value === "AM") return "오전";
  if (part.value === "PM") return "오후";
  return part.value;
}

export function formatDateTime(
  value: string,
  locale = "ko-KR",
  timeZone?: string
): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) return INVALID_DATE_LABEL;
  const date = new Date(trimmedValue);
  if (Number.isNaN(date.getTime())) return INVALID_DATE_LABEL;
  const isKoreanLocale = locale.toLowerCase().startsWith("ko");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    ...(timeZone ? { timeZone } : {}),
  })
    .formatToParts(date)
    .map((part) => normalizeKoreanDayPeriod(part, isKoreanLocale))
    .join("");
}
```

상태 메시지는 다음과 같이 고정합니다.

```ts
export function formatBackupSaveStatus(result: {
  outcome: "created" | "replaced" | "unchanged";
  cleanupPending: boolean;
}): string {
  if (result.outcome === "unchanged") return "변경된 내용이 없어 백업을 생략했습니다.";
  const base = result.outcome === "replaced"
    ? "오늘 백업을 최신 내용으로 교체했습니다."
    : "새 백업을 저장했습니다.";
  return result.cleanupPending
    ? `${base} 이전 기록 정리는 다음 백업에서 다시 시도합니다.`
    : base;
}
```

- [ ] **Step 3: memo-ui 테스트와 타입 검사를 실행하고 커밋합니다**

```bash
npm test -- packages/memo-ui/src/BackupHistoryDialog.test.tsx packages/memo-ui/src/backupStatusText.test.ts packages/memo-ui/src/formatDateTime.test.ts --pool=forks
npm run typecheck -w packages/memo-ui
git add packages/memo-ui/src
git commit -m "feat: add shared daily backup history dialog"
```

---

### Task 9: Desktop에서 날짜별 목록과 선택 지연 복원 연결

**Files:**
- Modify: `apps/desktop/src/App.tsx:73-91,222-224,286-292,1750-1862,2308-2358`
- Modify: `apps/desktop/src/App.test.tsx:350-400,3290-3760`

**Interfaces:**
- Consumes: `listBackupSnapshotSummaries`, `loadBackupSnapshot`, `BackupHistoryDialog`, `formatBackupSaveStatus`입니다.
- Produces: Desktop의 메타데이터 우선 복원과 기존 멀티윈도우 복원 잠금 결합입니다.

- [ ] **Step 1: Desktop 지연 복원 실패 테스트를 수정합니다**

기존 `listBackupSnapshots` mock을 `listBackupSnapshotSummaries`, `loadBackupSnapshot`으로 분리합니다.

```tsx
vi.mocked(listBackupSnapshotSummaries).mockResolvedValue([summary]);
vi.mocked(loadBackupSnapshot).mockResolvedValue({
  version: 1,
  userId: "user-1",
  createdAt: summary.savedAt!,
  memos: [serverMemo],
});

await userEvent.click(screen.getByRole("button", { name: "서버 복원" }));
expect(listBackupSnapshotSummaries).toHaveBeenCalledOnce();
expect(loadBackupSnapshot).not.toHaveBeenCalled();

await userEvent.click(screen.getByRole("button", { name: "2026-07-13 백업 복원" }));
expect(loadBackupSnapshot).toHaveBeenCalledWith(expect.anything(), "user-1", summary.id);
expect(await repository.listMemos()).toEqual([serverMemo]);
```

선택 payload 로드가 실패하면 `replaceMemosWithSafety`와 restore store apply 이벤트가 호출되지 않고 기존 로컬 메모가 유지되는 테스트도 추가합니다.

- [ ] **Step 2: Desktop App의 중복 JSX를 공용 컴포넌트로 교체합니다**

state는 `BackupSnapshotSummary[]`만 보관합니다. `handleRestore`는 summary 목록만 읽습니다. `handleRestoreBackupSnapshot(snapshotId)`는 summary를 찾아 confirm한 뒤 `loadBackupSnapshot`을 호출하고, payload 검증이 끝난 후에만 기존 `runWithDesktopRestoreLock`과 `replaceMemosWithSafety`를 실행합니다.

```tsx
<BackupHistoryDialog
  isOpen={backupHistoryDialog.isOpen}
  isBusy={isBusy || isRestoreLocked}
  items={backupHistoryDialog.snapshots}
  onClose={handleCloseBackupHistoryDialog}
  onRestore={handleRestoreBackupSnapshot}
/>
```

`runServerBackup` 성공 문구는 `formatBackupSaveStatus(result)`로 설정합니다. 기존 51줄 내장 백업 기록 JSX를 삭제하므로 App 파일에 순증가하는 백업 UI 코드는 없어야 합니다.

- [ ] **Step 3: Desktop 테스트와 타입 검사를 실행하고 커밋합니다**

```bash
npm test -- apps/desktop/src/App.test.tsx packages/memo-ui/src/BackupHistoryDialog.test.tsx --pool=forks
npm run typecheck -w apps/desktop
git add apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx
git commit -m "feat: restore desktop backups by KST date"
```

---

### Task 10: Web에서 날짜별 목록과 선택 지연 복원 연결

**Files:**
- Modify: `apps/web/src/WebApp.tsx:17-35,182-184,205-211,1053-1183,1399-1450`
- Modify: `apps/web/src/WebApp.test.tsx:1-100,1660-1770`

**Interfaces:**
- Consumes: Desktop과 같은 공용 summary, loader, dialog, status formatter입니다.
- Produces: Web mutation barrier와 restore safety point를 유지하는 지연 복원입니다.

- [ ] **Step 1: Web 지연 복원 실패 테스트를 수정합니다**

```tsx
vi.mocked(listBackupSnapshotSummaries).mockResolvedValue([summary]);
vi.mocked(loadBackupSnapshot).mockResolvedValue(serverPayload);

await userEvent.click(screen.getByRole("button", { name: "서버 복원" }));
expect(listBackupSnapshotSummaries).toHaveBeenCalledOnce();
expect(loadBackupSnapshot).not.toHaveBeenCalled();

await userEvent.click(screen.getByRole("button", { name: "2026-07-13 백업 복원" }));
expect(loadBackupSnapshot).toHaveBeenCalledWith(expect.anything(), "user-1", summary.id);
expect(loadRestoreSafetyPoint(window.localStorage)?.source).toBe("server");
```

선택 payload 실패 시 localStorage 메모와 restore safety point가 바뀌지 않는 테스트를 추가합니다.

- [ ] **Step 2: Web App의 중복 JSX와 전체 payload 목록을 제거합니다**

Desktop과 같은 `BackupHistoryDialog`를 렌더링하고, `handleRestoreBackupSnapshot`에서 payload를 지연 로드한 뒤 기존 `runWithWebRestoreLock`과 `replaceMemosWithSafety`를 호출합니다. `handleBackup` 성공 문구는 `formatBackupSaveStatus(result)`를 사용합니다.

- [ ] **Step 3: Web 테스트와 타입 검사를 실행하고 커밋합니다**

```bash
npm test -- apps/web/src/WebApp.test.tsx packages/memo-ui/src/BackupHistoryDialog.test.tsx --pool=forks
npm run typecheck -w apps/web
git add apps/web/src/WebApp.tsx apps/web/src/WebApp.test.tsx
git commit -m "feat: restore web backups by KST date"
```

---

### Task 11: 업데이트 내역, Firebase 문서, 전체 회귀 검증

**Files:**
- Modify: `packages/memo-ui/src/MemoWorkspace.tsx:6-23,138-143`
- Modify: `packages/memo-ui/src/MemoWorkspace.test.tsx`
- Modify: `apps/web/src/landing/LandingPage.tsx:13-77,222-225`
- Modify: `apps/web/src/landing/LandingPage.test.tsx`
- Modify: `docs/firebase-setup.md`
- Modify: `docs/superpowers/specs/2026-07-13-h-memo-kst-daily-backup-retention-design.md` only when implementation details require a factual clarification

**Interfaces:**
- Consumes: 완료된 v3 동작과 배포 명령입니다.
- Produces: 사용자에게 보이는 업데이트 기록과 재현 가능한 운영 문서입니다.

- [ ] **Step 1: 앱과 홍보 페이지 업데이트 기록 테스트를 작성합니다**

다음 문구가 앱 업데이트 내역과 홍보 페이지 기록에 나타나는지 확인합니다.

```text
대한민국 날짜별 최신 백업 1개를 최근 365일 동안 보관하고, 선택한 날짜의 메모만 불러오도록 개선했습니다.
```

같은 날짜의 여러 개선 기록을 허용하도록 React key는 `${entry.date}-${entry.title}` 형식으로 변경합니다.

- [ ] **Step 2: 업데이트 기록과 Firebase 운영 문서를 갱신합니다**

`docs/firebase-setup.md`에 다음을 기록합니다.

```text
신규 쓰기: users/{uid}/backupSnapshots/{snapshotId} (schemaVersion 3)
신규 본문: users/{uid}/backupSnapshots/{snapshotId}/memosV3/{encodedMemoId}
복원 목록: 메타데이터만 조회, 날짜 선택 시 본문 조회
보존 기준: Asia/Seoul 오늘 포함 365일, 날짜별 최신 1개
정리 기준: active/pending 제외, 성공한 신규 백업 뒤 최대 400개 삭제
규칙 배포: npx firebase-tools deploy --only firestore:rules --project h-memo-60c6b
```

배포 명령은 로그인된 Firebase CLI와 정확한 프로젝트 확인 후에만 실행합니다.

- [ ] **Step 3: 업데이트 UI 테스트를 실행합니다**

```bash
npm test -- packages/memo-ui/src/MemoWorkspace.test.tsx apps/web/src/landing/LandingPage.test.tsx --pool=forks
```

Expected: 업데이트 내역 버튼, 2026-07-13 개선 기록, 고유 React key 렌더링이 PASS합니다.

- [ ] **Step 4: 전체 TypeScript 테스트와 타입 검사를 실행합니다**

```bash
npm test -- --pool=forks
npm run typecheck
```

Expected: 전체 Vitest 파일과 모든 workspace 타입 검사가 PASS합니다.

- [ ] **Step 5: Desktop/Web 및 Rust 회귀 검증을 실행합니다**

```bash
npm run build -w apps/desktop
npm run build -w apps/web
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:firestore-rules
```

Expected: 두 프런트엔드 빌드, Rust 테스트, 경고 없는 Clippy, Firestore Emulator 규칙 테스트가 모두 성공합니다. 기존 Vite 청크 크기 경고는 실패로 보지 않되 새 오류는 없어야 합니다.

- [ ] **Step 6: diff와 파일 크기, 사용자 자료 제외를 확인합니다**

```bash
git diff --check
wc -l packages/memo-sync/src/*.ts packages/memo-ui/src/BackupHistoryDialog.tsx packages/memo-ui/src/backupStatusText.ts
git status --short
```

Expected: 새로 분리한 구현 파일은 각각 500줄 미만이고, `h-memo-public-menu-fix.png`와 `img/`만 기존 미추적 사용자 자료로 남습니다.

- [ ] **Step 7: 문서와 최종 검증 변경을 커밋합니다**

```bash
git add packages/memo-ui/src/MemoWorkspace.tsx packages/memo-ui/src/MemoWorkspace.test.tsx apps/web/src/landing/LandingPage.tsx apps/web/src/landing/LandingPage.test.tsx docs/firebase-setup.md docs/superpowers/specs/2026-07-13-h-memo-kst-daily-backup-retention-design.md
git commit -m "docs: record daily backup retention update"
```

---

## Release Gate

기능 구현 완료 후 Firestore 규칙이 배포되기 전에는 v3 생성·완료와 비활성 스냅샷 삭제가 운영 서버에서 거부될 수 있습니다. 다음 순서로 릴리즈합니다.

1. 전체 로컬 테스트와 Rules Emulator를 통과합니다.
2. `firebase use` 또는 명시적 `--project`로 대상 프로젝트가 `h-memo-60c6b`인지 확인합니다.
3. `npx firebase-tools deploy --only firestore:rules --project h-memo-60c6b`를 실행합니다.
4. 테스트 계정으로 같은 날 변경 백업 2회, 동일 내용 백업 1회, 날짜별 복원 1회를 확인합니다.
5. Firestore에서 active snapshot과 날짜별 최신 snapshot이 유지되는지 확인합니다.
6. 규칙과 앱 코드가 확인된 뒤 Windows/macOS/Web 릴리즈 빌드를 시작합니다.

운영 점검에서 문제가 생기면 앱 배포를 중단하고 기존 active v2/v3 스냅샷은 그대로 유지합니다. 정리 코드는 active/pending을 보호하므로 규칙을 이전 버전으로 되돌려도 이미 활성화된 최신 백업은 읽을 수 있어야 합니다.
