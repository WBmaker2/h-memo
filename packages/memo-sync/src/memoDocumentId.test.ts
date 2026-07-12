import { describe, expect, it } from "vitest";
import {
  canUseLegacyRawMemoDocumentId,
  decodeMemoDocumentId,
  encodeMemoDocumentId,
  isMemoDocumentIdFor,
} from "./memoDocumentId";

describe("memo Firestore document-id codec", () => {
  it("round-trips unsafe, reserved, and Unicode IDs without collisions", () => {
    const memoIds = ["a/b", "a?b", "a#b", "유니코드", "memo~legacy", ".", "..", "memo-raw"];
    const documentIds = memoIds.map(encodeMemoDocumentId);

    expect(new Set(documentIds).size).toBe(memoIds.length);
    expect(documentIds.map(decodeMemoDocumentId)).toEqual(memoIds);
    expect(encodeMemoDocumentId("memo-raw")).toBe("memo-raw");
    expect(documentIds.every((documentId) => /^[A-Za-z0-9_~-]+$/.test(documentId))).toBe(true);
  });

  it("recognizes both compatible raw IDs and the current encoded ID", () => {
    expect(isMemoDocumentIdFor("memo-raw", "memo-raw")).toBe(true);
    expect(isMemoDocumentIdFor(encodeMemoDocumentId("a?b"), "a?b")).toBe(true);
    expect(isMemoDocumentIdFor("a?b", "a?b")).toBe(true);
    expect(isMemoDocumentIdFor(encodeMemoDocumentId("a?b"), "a#b")).toBe(false);
  });

  it("does not reinterpret a reserved encoded path as a colliding raw ID", () => {
    const encodedNul = encodeMemoDocumentId("\u0000");

    expect(encodedNul).toBe("memo~0000");
    expect(isMemoDocumentIdFor(encodedNul, "\u0000")).toBe(true);
    expect(isMemoDocumentIdFor(encodedNul, "memo~0000")).toBe(false);
    expect(isMemoDocumentIdFor("memo~legacy", "memo~legacy")).toBe(true);
    expect(canUseLegacyRawMemoDocumentId("memo~0000")).toBe(false);
    expect(canUseLegacyRawMemoDocumentId("memo~legacy")).toBe(true);
  });
});
