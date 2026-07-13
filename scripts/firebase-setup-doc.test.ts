import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Firebase setup operational documentation", () => {
  it("keeps the v3 write and v1/v2 compatibility contract explicit", () => {
    const document = readFileSync(path.resolve("docs", "firebase-setup.md"), "utf8");

    expect(document).toContain(
      "기존 inline 배열 기반 v1 스냅샷과 schema v2 스냅샷은 읽기와 복원을 계속 지원합니다. 새 백업은 schema v3 메타데이터와 `memosV3` 본문으로만 작성합니다."
    );
    expect(document).toContain("### 기존 v2 canonical 규약 (호환 기준)");
    expect(document).not.toContain("새 백업은 v2만 작성합니다.");
  });

  it("documents safe cleanup, date selection, current statuses, and emulator coverage", () => {
    const document = readFileSync(path.resolve("docs", "firebase-setup.md"), "utf8");

    expect(document).toContain(
      "정리 작업은 inactive snapshot과 그 하위 문서를 안전하게 삭제할 수 있지만, 현재 `activeSnapshotId` 또는 `pendingSnapshotId`인 snapshot과 그 하위 문서는 보호합니다."
    );
    expect(document).toContain("pending을 active로 전환하는 작업은 activation transaction에서 수행");
    expect(document).not.toContain("정리 작업은 `pending`을 `active`로 옮길 수");
    expect(document).toContain("날짜별 목록에서 특정 날짜를 선택하고, 선택한 백업의 메모만 반영");
    expect(document).toContain("새 백업을 저장했습니다.");
    expect(document).toContain("오늘 백업을 최신 내용으로 교체했습니다.");
    expect(document).toContain("변경된 내용이 없어 백업을 생략했습니다.");
    expect(document).toContain("실제 Firebase Rules Emulator test");
    expect(document).toContain("`npm run test:firestore-rules`로 실행하며, CI도 같은 명령을 실행합니다.");
    expect(document).not.toContain("emulator 수준의 rules 실행 검증은 배포 전 별도 작업입니다.");
  });
});
