import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Firestore backup rules", () => {
  it("permits owner-only schema-v2 metadata writes while keeping legacy version-1 snapshot reads", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidSchemaV2SnapshotShape(uid)");
    expect(rules).toContain("request.resource.data.schemaVersion == 2");
    expect(rules).toContain('request.resource.data.state == "writing"');
    expect(rules).toContain('request.resource.data.state == "complete"');
    expect(rules).toContain("allow read: if isOwner(uid);");
    expect(rules).toContain("allow create: if isOwner(uid) && isWritingSchemaV2Snapshot(uid);");
    expect(rules).not.toContain("hasValidLegacyBackupSnapshotShape");
    expect(rules).toContain("allow delete: if false;");
  });

  it("allows owners to maintain canonical current memos with an owner-safe shape", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidCanonicalMemoShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/memos/{memoId}");
    expect(rules).toContain("request.resource.data.userId == uid");
    expect(rules).toContain("request.resource.data.memoId == memoId");
    expect(rules).toContain("request.resource.data.memo.id == memoId");
    expect(rules).toContain("request.resource.data.savedAt is timestamp");
  });

  it("allows immutable owner-created schema-v2 snapshot memo documents", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidSnapshotMemoShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}");
    expect(rules).toContain("allow create: if isOwner(uid)");
    expect(rules).toContain("&& hasValidSnapshotMemoShape(uid, memoId)");
    expect(rules).toContain("request.resource.data.memo.id == memoId");
    expect(rules).toContain("allow update, delete: if false;");
  });

  it("allows owners to manage server memo delete markers", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidServerMemoDeleteShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/serverMemoDeletes/{memoId}");
    expect(rules).toContain("request.resource.data.memoId == memoId");
    expect(rules).toContain("allow create, update: if isOwner(uid)");
    expect(rules).toContain("allow delete: if isOwner(uid);");
  });
});
