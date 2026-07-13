import { createMemo } from "@h-memo/memo-core";
import { describe, expect, it } from "vitest";
import {
  parseBackupSnapshotSummary,
  type BackupSnapshotSummary,
} from "./backupSnapshotSummary";

function payload() {
  return {
    version: 1,
    userId: "user-1",
    createdAt: "2026-07-13T01:00:00.000Z",
    memos: [
      createMemo({ id: "a", now: "2026-07-13T00:00:00.000Z", plainText: "첫 내용" }),
      createMemo({ id: "b", now: "2026-07-13T00:00:00.000Z", plainText: "둘째 내용" }),
    ],
  };
}

function metadata(overrides: Partial<BackupSnapshotSummary> = {}): BackupSnapshotSummary {
  return {
    id: "snapshot",
    savedAt: "2026-07-13T01:00:00.000Z",
    kstDate: "2026-07-13",
    memoCount: 1,
    previewText: "내용",
    contentHash: null,
    schemaVersion: 2,
    state: "complete",
    legacyUndated: false,
    ...overrides,
  };
}

describe("backup snapshot summaries", () => {
  it("parses a complete v3 metadata document and keeps its validated hash", () => {
    expect(
      parseBackupSnapshotSummary("v3", {
        schemaVersion: 3,
        userId: "user-1",
        state: "complete",
        memoCount: 2,
        contentHash: "a".repeat(64),
        previewText: "첫 내용, 둘째 내용",
        clientCreatedAt: "2026-07-13T01:00:00.000Z",
        savedAt: "2026-07-13T01:01:00.000Z",
      })
    ).toEqual({
      id: "v3",
      savedAt: "2026-07-13T01:01:00.000Z",
      kstDate: "2026-07-13",
      memoCount: 2,
      previewText: "첫 내용, 둘째 내용",
      contentHash: "a".repeat(64),
      schemaVersion: 3,
      state: "complete",
      legacyUndated: false,
    });
  });

  it("parses v2 metadata with a null hash and no body read", () => {
    expect(
      parseBackupSnapshotSummary("v2", {
        schemaVersion: 2,
        userId: "user-1",
        state: "complete",
        memoCount: 4,
        savedAt: { toDate: () => new Date("2026-07-12T15:00:00.000Z") },
      })
    ).toMatchObject({
      id: "v2",
      savedAt: "2026-07-12T15:00:00.000Z",
      kstDate: "2026-07-13",
      memoCount: 4,
      previewText: "",
      contentHash: null,
      schemaVersion: 2,
      state: "complete",
      legacyUndated: false,
    });
  });

  it("derives v1 count and preview, while exposing malformed legacy dates separately", () => {
    expect(parseBackupSnapshotSummary("v1", { ...payload(), savedAt: "" })).toMatchObject({
      id: "v1",
      savedAt: "2026-07-13T01:00:00.000Z",
      kstDate: "2026-07-13",
      memoCount: 2,
      previewText: "첫 내용, 둘째 내용",
      contentHash: null,
      schemaVersion: 1,
      legacyUndated: false,
    });

    expect(
      parseBackupSnapshotSummary("legacy", { ...payload(), createdAt: "", savedAt: "" })
    ).toMatchObject({
      id: "legacy",
      savedAt: null,
      kstDate: null,
      memoCount: 2,
      contentHash: null,
      schemaVersion: 1,
      legacyUndated: true,
    });
  });

  it("rejects incomplete v3 metadata and writing snapshots", () => {
    expect(
      parseBackupSnapshotSummary("bad-hash", {
        schemaVersion: 3,
        userId: "user-1",
        state: "complete",
        memoCount: 0,
        contentHash: "not-a-hash",
        previewText: "",
        clientCreatedAt: "2026-07-13T01:00:00.000Z",
        savedAt: "2026-07-13T01:01:00.000Z",
      })
    ).toBeNull();
    expect(
      parseBackupSnapshotSummary("writing", {
        schemaVersion: 3,
        userId: "user-1",
        state: "writing",
        memoCount: 0,
        contentHash: "a".repeat(64),
        previewText: "",
        clientCreatedAt: "2026-07-13T01:00:00.000Z",
        savedAt: null,
      })
    ).toBeNull();
  });

  it("rejects corrupted v1 memo entries without throwing", () => {
    const original = payload();
    expect(() =>
      parseBackupSnapshotSummary("null-memo", { ...original, memos: [null] })
    ).not.toThrow();
    expect(
      parseBackupSnapshotSummary("null-memo", { ...original, memos: [null] })
    ).toBeNull();

    const { title: _title, ...missingTitleMemo } = original.memos[0]!;
    expect(
      parseBackupSnapshotSummary("missing-field", {
        ...original,
        memos: [missingTitleMemo],
      })
    ).toBeNull();
  });
});
