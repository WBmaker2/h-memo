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
    expect(rules).toContain("isWritingSchemaV2Snapshot(uid)");
    expect(rules).not.toContain("hasValidLegacyBackupSnapshotShape");
    expect(rules).toContain("allow delete: if false;");
    expect(rules).toContain("resource.data.state == \"writing\"");
    expect(rules).toContain("affectedKeys().hasOnly([\"state\", \"savedAt\"])");
  });

  it("validates exact schema-v3 metadata and only permits the writing-to-complete transition", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");
    const snapshotRules = rules.slice(
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}"),
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}")
    );

    expect(rules).toContain("function hasValidSchemaV3SnapshotShape(uid)");
    expect(rules).toContain("request.resource.data.clientCreatedAt is string");
    expect(rules).toContain('request.resource.data.contentHash.matches("^[0-9a-f]{64}$")');
    expect(rules).toContain("request.resource.data.previewText.size() <= 240");
    expect(rules).toContain("request.resource.data.savedAt == null");
    expect(snapshotRules).toContain("isWritingSchemaV3Snapshot(uid)");
    expect(snapshotRules).toContain("isCompletingSchemaV3Snapshot(uid)");
    expect(snapshotRules).toContain("allow delete: if isOwner(uid) && isInactiveSnapshot(uid, snapshotId);");
  });

  it("allows owners to maintain canonical current memos with an owner-safe shape", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");
    const canonicalRules = rules.slice(
      rules.indexOf("function hasValidCanonicalReference(reference)"),
      rules.indexOf("function hasValidSnapshotMemoShape(uid, memoId)")
    );

    expect(rules).toContain("function hasValidCanonicalMemoShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/memos/{memoId}");
    expect(rules).toContain("request.resource.data.userId == uid");
    expect(rules).toContain("request.resource.data.memoId == memoId");
    expect(rules).toContain("function hasValidCanonicalReference(reference)");
    expect(rules).toContain("request.resource.data.active");
    expect(rules).toContain("request.resource.data.pending");
    expect(rules).toContain("reference.snapshotId is string");
    expect(rules).toContain("reference.savedAt is timestamp");
    expect(rules).toContain("allow delete: if false;");
    expect(canonicalRules).toContain('"active", "pending"');
    expect(canonicalRules).toContain('affectedKeys().hasOnly(["active", "pending"])');
    expect(canonicalRules).not.toContain('"memo"');
    expect(canonicalRules).not.toContain('"generations"');
    expect(rules).not.toContain('"generations"');
  });

  it("isolates new memo writes in versioned namespaces while retaining legacy reads", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");
    const legacyCanonicalRules = rules.slice(
      rules.indexOf("match /users/{uid}/memos/{memoId}"),
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}")
    );
    const legacySnapshotRules = rules.slice(
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}"),
      rules.indexOf("match /users/{uid}/backupState/current")
    );

    expect(rules).toContain("match /users/{uid}/memosV2/{memoId}");
    expect(rules).toContain(
      "match /users/{uid}/backupSnapshots/{snapshotId}/memosV2/{memoId}"
    );
    expect(rules).toContain("match /users/{uid}/serverMemoDeletesV2/{memoId}");
    expect(legacyCanonicalRules).toContain("allow read: if isOwner(uid);");
    expect(legacyCanonicalRules).not.toContain("allow create: if isOwner(uid)");
    expect(legacyCanonicalRules).not.toContain("allow update: if isOwner(uid)");
    expect(legacySnapshotRules).toContain("allow read: if isOwner(uid);");
    expect(legacySnapshotRules).not.toContain("allow create: if isOwner(uid)");
  });

  it("allows immutable owner-created schema-v2 snapshot memo documents", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidSnapshotMemoShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}");
    expect(rules).toContain("allow create: if isOwner(uid)");
    expect(rules).toContain("&& hasValidSnapshotMemoShape(uid, memoId)");
    expect(rules).toContain("request.resource.data.memo.id == request.resource.data.memoId");
    expect(rules).toContain("allow update: if false;");
    expect(rules).toContain("allow delete: if isOwner(uid) && isInactiveSnapshot(uid, snapshotId);");
    const nestedMemoRules = rules.slice(
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}"),
      rules.indexOf("match /users/{uid}/serverMemoDeletes/{memoId}")
    );
    expect(nestedMemoRules).not.toContain("get(");
  });

  it("allows owners to manage server memo delete markers", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidServerMemoDeleteShape(uid, memoId)");
    expect(rules).toContain("match /users/{uid}/serverMemoDeletes/{memoId}");
    expect(rules).toContain("request.resource.data.memoId == memoId");
    expect(rules).toContain("allow create, update: if isOwner(uid)");
    expect(rules).toContain("allow delete: if isOwner(uid);");
    expect(rules).toContain('"snapshotId"');
    expect(rules).toContain("request.resource.data.snapshotId is string");
    expect(rules).toContain("function hasValidEncodedMemoDocumentId(pathMemoId, originalMemoId)");
    expect(rules).toContain(
      "pathMemoId.matches(\"memo~[0-9a-fA-F]{4}([0-9a-fA-F]{4})*\")"
    );
    expect(rules).toContain(
      "!memoId.matches(\"memo~[0-9a-fA-F]{4}([0-9a-fA-F]{4})*\")"
    );
  });

  it("binds the active generation to a complete v2 snapshot without permitting legacy writes", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("match /users/{uid}/backupState/current");
    expect(rules).toContain("function hasValidBackupActivationShape(uid)");
    expect(rules).toContain("getAfter(/databases/$(database)/documents/users/$(uid)/backupSnapshots/$(request.resource.data.activeSnapshotId))");
    expect(rules).toContain(".data.state == \"complete\"");
    expect(rules).not.toContain("hasValidLegacyBackupSnapshotShape");
  });

  it("requires a bounded per-user pending lease before staging or activation", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function hasValidBackupStateShape(uid)");
    expect(rules).toContain('"pendingSnapshotId"');
    expect(rules).toContain("request.resource.data.pendingSnapshotId is string");
    expect(rules).toContain("request.resource.data.activeSnapshotId == resource.data.activeSnapshotId");
    expect(rules).toContain("resource.data.pendingSnapshotId is string");
    expect(rules).toContain("request.resource.data.activeSnapshotId == resource.data.pendingSnapshotId");
    expect(rules).toContain("request.resource.data.pendingSnapshotId == null");
    expect(rules).toContain('request.resource.data.pendingSchemaVersion == 3');
    expect(rules).toContain('request.resource.data.activeSchemaVersion == 3');
    expect(rules).toContain("function hasValidV3PendingSnapshotAfter(uid, snapshotId)");
    expect(rules).toContain("existsAfter(snapshotPath)");
    expect(rules).toContain("getAfter(snapshotPath).data.state == \"writing\"");
    expect(rules).toContain("request.resource.data.activeSchemaVersion == resource.data.activeSchemaVersion");
  });

  it("limits v3 memo creation to the current pending writing snapshot", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");
    const v3MemoRules = rules.slice(
      rules.indexOf("match /users/{uid}/backupSnapshots/{snapshotId}/memosV3/{memoId}"),
      rules.indexOf("match /users/{uid}/serverMemoDeletesV2/{memoId}")
    );

    expect(rules).toContain("function isInactiveSnapshot(uid, snapshotId)");
    expect(rules).toContain("function isPendingWritingV3Snapshot(uid, snapshotId)");
    expect(v3MemoRules).toContain("isPendingWritingV3Snapshot(uid, snapshotId)");
    expect(v3MemoRules).toContain("allow update: if false;");
    expect(v3MemoRules).toContain("allow delete: if isOwner(uid) && isInactiveSnapshot(uid, snapshotId);");
  });
});
