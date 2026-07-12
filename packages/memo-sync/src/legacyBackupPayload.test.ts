import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import { validateLegacyFirestoreV1Payload } from "./legacyBackupPayload";

describe("legacy Firestore version-1 backup payloads", () => {
  it("accepts the pre-hardening inline shape with empty and non-ISO timestamps", () => {
    const memo = createMemo({
      id: "legacy-memo",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "보존할 레거시 메모",
    });
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "",
      memos: [
        {
          ...memo,
          createdAt: "",
          updatedAt: "before ISO timestamps",
          deletedAt: "legacy deletion metadata",
        },
      ],
    };

    const result = validateLegacyFirestoreV1Payload(payload, "user-1");

    expect(result).toEqual({ ok: true, payload });
  });

  it("still rejects a legacy payload whose usable shape is broken", () => {
    const result = validateLegacyFirestoreV1Payload(
      {
        version: 1,
        userId: "user-1",
        createdAt: "legacy",
        memos: [{ id: "missing-fields" }],
      },
      "user-1"
    );

    expect(result).toEqual({
      ok: false,
      reason: "잘못된 메모 데이터가 포함되어 있습니다.",
    });
  });
});
