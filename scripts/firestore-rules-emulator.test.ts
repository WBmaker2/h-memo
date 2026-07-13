import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = "h-memo-60c6b";
const ownerId = "owner";
const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

let testEnv: RulesTestEnvironment;

function snapshotRef(db: Firestore, userId: string, snapshotId: string) {
  return doc(db, `users/${userId}/backupSnapshots/${snapshotId}`);
}

function stateRef(db: Firestore, userId: string) {
  return doc(db, `users/${userId}/backupState/current`);
}

function memoRef(db: Firestore, userId: string, snapshotId: string, collection = "memosV3") {
  return doc(db, `users/${userId}/backupSnapshots/${snapshotId}/${collection}/memo~0061`);
}

function validWritingV3(userId: string) {
  return {
    schemaVersion: 3,
    userId,
    clientCreatedAt: "2026-07-13T12:00:00.000Z",
    memoCount: 1,
    contentHash: "a".repeat(64),
    previewText: "첫 번째 메모",
    state: "writing",
    savedAt: null,
  };
}

function validMemo(userId: string) {
  return { userId, memoId: "a", memo: { id: "a", plainText: "본문" } };
}

async function seed(callback: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (context) => callback(context.firestore()));
}

describeWithEmulator("Firestore security rules emulator", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: readFileSync(path.resolve("firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("allows the owner to create, fill, complete, and activate a schema-v3 snapshot", async () => {
    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const snapshot = snapshotRef(owner, ownerId, "v3");

    const initialLease = writeBatch(owner);
    initialLease.set(snapshot, validWritingV3(ownerId));
    initialLease.set(stateRef(owner, ownerId), {
      userId: ownerId,
      activeSnapshotId: null,
      activeSchemaVersion: null,
      pendingSnapshotId: "v3",
      pendingSchemaVersion: 3,
      activatedAt: null,
    });
    await assertSucceeds(initialLease.commit());
    await assertSucceeds(setDoc(memoRef(owner, ownerId, "v3"), validMemo(ownerId)));
    await assertSucceeds(updateDoc(snapshot, { state: "complete", savedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(stateRef(owner, ownerId), {
      activeSnapshotId: "v3",
      activeSchemaVersion: 3,
      pendingSnapshotId: null,
      pendingSchemaVersion: null,
      activatedAt: serverTimestamp(),
    }));

    const saved = await getDoc(snapshot);
    expect(saved.data()).toMatchObject({ schemaVersion: 3, state: "complete" });
    expect(saved.data()?.savedAt).toBeTruthy();
  });

  it("rejects malformed schema-v3 metadata", async () => {
    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const valid = validWritingV3(ownerId);

    await assertFails(setDoc(snapshotRef(owner, ownerId, "bad-hash"), {
      ...valid,
      contentHash: "A".repeat(64),
    }));
    await assertFails(setDoc(snapshotRef(owner, ownerId, "long-preview"), {
      ...valid,
      previewText: "x".repeat(241),
    }));
    await assertFails(setDoc(snapshotRef(owner, ownerId, "wrong-time"), {
      ...valid,
      savedAt: new Date("2026-07-13T12:00:00.000Z"),
    }));
    await assertFails(setDoc(snapshotRef(owner, ownerId, "extra-field"), {
      ...valid,
      unexpected: true,
    }));
  });

  it("denies deleting active or pending snapshots and their children", async () => {
    await seed(async (db) => {
      for (const [snapshotId, state] of [["active", "complete"], ["pending", "writing"]]) {
        await setDoc(snapshotRef(db, ownerId, snapshotId), {
          ...validWritingV3(ownerId),
          state,
          savedAt: state === "complete" ? new Date("2026-07-13T12:00:00.000Z") : null,
        });
        await setDoc(memoRef(db, ownerId, snapshotId), validMemo(ownerId));
      }
      await setDoc(stateRef(db, ownerId), {
        userId: ownerId,
        activeSnapshotId: "active",
        pendingSnapshotId: "pending",
        activatedAt: null,
      });
    });

    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const other = testEnv.authenticatedContext("other").firestore();
    await assertFails(deleteDoc(snapshotRef(owner, ownerId, "active")));
    await assertFails(deleteDoc(memoRef(owner, ownerId, "active")));
    await assertFails(deleteDoc(snapshotRef(owner, ownerId, "pending")));
    await assertFails(deleteDoc(memoRef(owner, ownerId, "pending")));
    await assertFails(deleteDoc(snapshotRef(other, ownerId, "active")));
  });

  it("allows only the owner to delete an inactive snapshot and child", async () => {
    await seed(async (db) => {
      await setDoc(snapshotRef(db, ownerId, "old"), {
        ...validWritingV3(ownerId),
        state: "complete",
        savedAt: new Date("2026-07-12T12:00:00.000Z"),
      });
      await setDoc(memoRef(db, ownerId, "old"), validMemo(ownerId));
      await setDoc(stateRef(db, ownerId), {
        userId: ownerId,
        activeSnapshotId: "current",
        pendingSnapshotId: null,
        activatedAt: new Date("2026-07-13T12:00:00.000Z"),
      });
    });

    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const other = testEnv.authenticatedContext("other").firestore();
    await assertFails(deleteDoc(memoRef(other, ownerId, "old")));
    await assertFails(deleteDoc(snapshotRef(other, ownerId, "old")));
    await assertSucceeds(deleteDoc(memoRef(owner, ownerId, "old")));
    await assertSucceeds(deleteDoc(snapshotRef(owner, ownerId, "old")));
  });

  it("denies adding a memo document after a v3 snapshot is complete", async () => {
    await seed(async (db) => {
      await setDoc(snapshotRef(db, ownerId, "complete"), {
        ...validWritingV3(ownerId),
        state: "complete",
        savedAt: new Date("2026-07-13T12:00:00.000Z"),
      });
      await setDoc(stateRef(db, ownerId), {
        userId: ownerId,
        activeSnapshotId: null,
        pendingSnapshotId: "complete",
        pendingSchemaVersion: 3,
        activatedAt: null,
      });
    });

    const owner = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(setDoc(memoRef(owner, ownerId, "complete"), validMemo(ownerId)));
  });

  it("denies spoofing a v3 pending lease or changing its prior active version", async () => {
    await seed(async (db) => {
      await setDoc(snapshotRef(db, ownerId, "active"), {
        ...validWritingV3(ownerId),
        state: "complete",
        savedAt: new Date("2026-07-13T12:00:00.000Z"),
      });
      await setDoc(snapshotRef(db, ownerId, "pending"), validWritingV3(ownerId));
      await setDoc(stateRef(db, ownerId), {
        userId: ownerId,
        activeSnapshotId: "active",
        activeSchemaVersion: 3,
        pendingSnapshotId: "pending",
        pendingSchemaVersion: 3,
        activatedAt: new Date("2026-07-13T12:00:00.000Z"),
      });
    });

    const owner = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(stateRef(owner, ownerId), {
      activeSnapshotId: "active",
      activeSchemaVersion: 1,
      pendingSnapshotId: "bogus",
      pendingSchemaVersion: 3,
      activatedAt: new Date("2026-07-13T12:00:00.000Z"),
    }));
    await assertFails(updateDoc(stateRef(owner, ownerId), {
      activeSnapshotId: "active",
      activeSchemaVersion: 3,
      pendingSnapshotId: "bogus",
      pendingSchemaVersion: 3,
      activatedAt: new Date("2026-07-13T12:00:00.000Z"),
    }));
    await assertFails(deleteDoc(snapshotRef(owner, ownerId, "pending")));
  });

  it("denies an initial v3 lease whose pending snapshot is missing", async () => {
    const owner = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(setDoc(stateRef(owner, ownerId), {
      userId: ownerId,
      activeSnapshotId: null,
      activeSchemaVersion: null,
      pendingSnapshotId: "missing",
      pendingSchemaVersion: 3,
      activatedAt: null,
    }));
  });

  it("preserves version-field-free v2 lease and activation compatibility", async () => {
    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const snapshot = snapshotRef(owner, ownerId, "legacy-v2");

    await assertSucceeds(setDoc(snapshot, {
      schemaVersion: 2,
      userId: ownerId,
      createdAt: "2026-07-13T12:00:00.000Z",
      memoCount: 0,
      state: "writing",
    }));
    await assertSucceeds(setDoc(stateRef(owner, ownerId), {
      userId: ownerId,
      activeSnapshotId: null,
      pendingSnapshotId: "legacy-v2",
      activatedAt: null,
    }));
    await assertSucceeds(updateDoc(snapshot, { state: "complete", savedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(stateRef(owner, ownerId), {
      activeSnapshotId: "legacy-v2",
      pendingSnapshotId: null,
      activatedAt: serverTimestamp(),
    }));
  });

  it("preserves schema-v2 completion, reads, and immutability", async () => {
    const owner = testEnv.authenticatedContext(ownerId).firestore();
    const other = testEnv.authenticatedContext("other").firestore();
    const snapshot = snapshotRef(owner, ownerId, "v2");
    const v2Memo = memoRef(owner, ownerId, "v2", "memosV2");

    await assertSucceeds(setDoc(snapshot, {
      schemaVersion: 2,
      userId: ownerId,
      createdAt: "2026-07-13T12:00:00.000Z",
      memoCount: 1,
      state: "writing",
    }));
    await assertSucceeds(updateDoc(snapshot, { state: "complete", savedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(v2Memo, validMemo(ownerId)));
    await assertFails(updateDoc(snapshot, { memoCount: 2 }));
    await assertFails(updateDoc(v2Memo, { memo: { id: "a", plainText: "변경" } }));
    await assertSucceeds(getDoc(snapshot));
    await assertFails(getDoc(doc(other, `users/${ownerId}/backupSnapshots/v2`)));
  });
});
