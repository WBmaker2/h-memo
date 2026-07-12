import { describe, expect, it } from "vitest";
import { createBackupPayload, createMemo } from "./index";
import * as restoreSafety from "./index";

const STORAGE_KEY = "h-memo:restore-safety-v1";

function createStorage(initialValue?: string): Storage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(STORAGE_KEY, initialValue);
  }

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createSafetyPoint() {
  const memo = createMemo({
    id: "memo-1",
    now: "2026-07-12T09:00:00.000Z",
    plainText: "복원 전 메모",
  });

  return {
    version: 1 as const,
    source: "server" as const,
    createdAt: "2026-07-12T09:05:00.000Z",
    payload: createBackupPayload({
      userId: "user-1",
      createdAt: "2026-07-12T09:05:00.000Z",
      memos: [memo],
    }),
  };
}

describe("restoreSafety", () => {
  it("round-trips a versioned restore safety point and clears it", () => {
    const storage = createStorage();
    const point = createSafetyPoint();

    expect(restoreSafety.RESTORE_SAFETY_STORAGE_KEY).toBe(STORAGE_KEY);
    restoreSafety.saveRestoreSafetyPoint(storage, point);

    expect(restoreSafety.loadRestoreSafetyPoint(storage)).toEqual(point);

    restoreSafety.clearRestoreSafetyPoint(storage);
    expect(restoreSafety.loadRestoreSafetyPoint(storage)).toBeNull();
  });

  it("rejects malformed persisted safety points without throwing", () => {
    const malformed = JSON.stringify({
      version: 1,
      source: "server",
      createdAt: "2026-07-12T09:05:00.000Z",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: "2026-07-12T09:05:00.000Z",
        memos: [{ id: "missing-memo-fields" }],
      },
    });

    expect(restoreSafety.loadRestoreSafetyPoint(createStorage(malformed))).toBeNull();
    expect(restoreSafety.loadRestoreSafetyPoint(createStorage("not-json"))).toBeNull();
  });

  it("rejects a safety point whose envelope timestamp is not parseable", () => {
    const point = createSafetyPoint();
    point.createdAt = "not-a-date";

    const storage = createStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(point));

    expect(restoreSafety.loadRestoreSafetyPoint(storage)).toBeNull();
  });

  it("rejects a safety point whose nested memo timestamp is not parseable", () => {
    const point = createSafetyPoint();
    point.payload = {
      ...point.payload,
      memos: [{ ...point.payload.memos[0], updatedAt: "not-a-date" }],
    };

    const storage = createStorage(JSON.stringify(point));

    expect(restoreSafety.loadRestoreSafetyPoint(storage)).toBeNull();
  });

  it("reports storage quota errors instead of continuing", () => {
    const storage = createStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };

    expect(() => restoreSafety.saveRestoreSafetyPoint(storage, createSafetyPoint())).toThrow(
      "복원 안전 지점"
    );
  });

  it("reports cyclic rich content without writing a partial safety point", () => {
    const storage = createStorage();
    const point = createSafetyPoint();
    const cyclicRichContent: Record<string, unknown> = { type: "doc" };
    cyclicRichContent.self = cyclicRichContent;
    point.payload.memos[0] = {
      ...point.payload.memos[0],
      richContent: cyclicRichContent,
    };

    expect(() => restoreSafety.saveRestoreSafetyPoint(storage, point)).toThrow(
      "복원 안전 지점을 저장하지 못했습니다"
    );
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
