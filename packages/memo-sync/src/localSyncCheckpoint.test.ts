import { describe, expect, it } from "vitest";

import {
  clearLocalSyncCheckpoint,
  createLocalSyncCheckpoint,
  readLocalSyncCheckpoint,
  writeLocalSyncCheckpoint,
} from "./localSyncCheckpoint";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const checkpoint = createLocalSyncCheckpoint({
  userId: "user/1",
  snapshotId: "snapshot-1",
  contentHash: "a".repeat(64),
  serverSavedAt: "2026-08-28T01:00:00.000Z",
  recordedAt: "2026-08-28T01:05:00.000Z",
});

describe("local sync checkpoint storage", () => {
  it("round-trips a checkpoint by user", () => {
    const target = storage();
    expect(writeLocalSyncCheckpoint(target, checkpoint)).toBe(true);
    expect(readLocalSyncCheckpoint(target, "user/1")).toEqual(checkpoint);
    expect(readLocalSyncCheckpoint(target, "another-user")).toBeNull();
  });

  it("rejects malformed checkpoints without throwing", () => {
    const target = storage();
    target.setItem("h-memo:local-sync-checkpoint:user-1", "{not-json");
    expect(readLocalSyncCheckpoint(target, "user-1")).toBeNull();
    target.setItem(
      "h-memo:local-sync-checkpoint:user-1",
      JSON.stringify({ ...checkpoint, userId: "user-1", contentHash: "bad" })
    );
    expect(readLocalSyncCheckpoint(target, "user-1")).toBeNull();
  });

  it("clears only the selected user's checkpoint", () => {
    const target = storage();
    writeLocalSyncCheckpoint(target, checkpoint);
    const other = { ...checkpoint, userId: "another-user" };
    writeLocalSyncCheckpoint(target, other);
    clearLocalSyncCheckpoint(target, checkpoint.userId);
    expect(readLocalSyncCheckpoint(target, checkpoint.userId)).toBeNull();
    expect(readLocalSyncCheckpoint(target, other.userId)).toEqual(other);
  });
});
