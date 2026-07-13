import { describe, expect, it } from "vitest";
import { createMemo, validateBackupPayload } from "@h-memo/memo-core";
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

    expect(result).toEqual({
      ok: true,
      payload: {
        ...payload,
        createdAt: "1970-01-01T00:00:00.000Z",
        memos: [
          {
            ...payload.memos[0],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
            deletedAt: "1970-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(result.ok && validateBackupPayload(result.payload, "user-1")).toEqual({
      ok: true,
      payload: result.ok ? result.payload : undefined,
    });
  });

  it("preserves meaningful timestamps and applies the documented fallback order", () => {
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00+09:00",
      memos: [
        {
          ...createMemo({ id: "memo-updated-fallback", now: "2026-05-13T09:00:00.000Z" }),
          createdAt: "",
          updatedAt: "2026-05-13T08:00:00+09:00",
        },
        {
          ...createMemo({ id: "memo-preserved", now: "2026-05-13T09:00:00.000Z" }),
          createdAt: "2026-05-13T09:00:00.123Z",
          updatedAt: "2026-05-13T09:10:00+09:00",
        },
      ],
    };

    const result = validateLegacyFirestoreV1Payload(payload, "user-1");

    expect(result).toEqual({
      ok: true,
      payload: {
        ...payload,
        createdAt: "2026-05-13T00:05:00.000Z",
        memos: [
          {
            ...payload.memos[0],
            createdAt: "2026-05-12T23:00:00.000Z",
            updatedAt: "2026-05-12T23:00:00.000Z",
          },
          {
            ...payload.memos[1],
            createdAt: "2026-05-13T09:00:00.123Z",
            updatedAt: "2026-05-13T09:00:00.123Z",
          },
        ],
      },
    });
  });

  it("clamps a normalized updatedAt so createdAt never follows it", () => {
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T12:00:00.000Z",
      memos: [
        {
          ...createMemo({ id: "memo-out-of-order", now: "2026-05-13T09:00:00.000Z" }),
          createdAt: "2026-05-13T12:00:00.000Z",
          updatedAt: "2026-05-13T11:00:00.000Z",
        },
      ],
    };

    const result = validateLegacyFirestoreV1Payload(payload, "user-1");

    expect(result).toEqual({
      ok: true,
      payload: {
        ...payload,
        memos: [
          {
            ...payload.memos[0],
            updatedAt: "2026-05-13T12:00:00.000Z",
          },
        ],
      },
    });
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
