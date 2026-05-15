import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Firestore backup rules", () => {
  it("allows owner memo-list reductions but keeps snapshot document deletes blocked", () => {
    const rules = readFileSync(path.resolve("firestore.rules"), "utf8");

    expect(rules).toContain("function onlyReducesSnapshotMemos()");
    expect(rules).toContain(
      'request.resource.data.diff(resource.data).affectedKeys().hasOnly(["memos"])'
    );
    expect(rules).toContain("request.resource.data.memos.size() <= resource.data.memos.size()");
    expect(rules).toContain("allow update: if isOwner(uid)");
    expect(rules).toContain("allow delete: if false;");
  });
});
