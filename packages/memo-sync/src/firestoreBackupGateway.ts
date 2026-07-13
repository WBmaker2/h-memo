import type { Firestore } from "firebase/firestore";
import type { MemoBackupPayload, BackupGateway, StoredCurrentMemo } from "./backupTypes";
import { firebaseBackupDriver, type FirestoreBackupDriver } from "./firestoreBackupDriver";
import {
  listFirestoreBackupSummaries,
  loadFirestoreBackup,
} from "./firestoreBackupRead";
import { saveFirestoreBackup } from "./firestoreBackupWrite";
import {
  deleteFirestoreCurrentMemo,
  loadFirestoreCurrentMemos,
  loadFirestoreDeletedMemoIds,
} from "./firestoreCurrentMemoStore";
import type { FirestoreBackupContext } from "./firestoreBackupShared";

export class FirestoreBackupGateway implements BackupGateway {
  readonly context: FirestoreBackupContext;

  constructor(
    firestore: Firestore,
    driver: FirestoreBackupDriver = firebaseBackupDriver
  ) {
    this.context = { firestore, driver };
  }

  saveBackup(userId: string, payload: MemoBackupPayload) {
    return saveFirestoreBackup(this.context, userId, payload);
  }

  listBackupSummaries(userId: string) {
    return listFirestoreBackupSummaries(this.context, userId);
  }

  loadBackup(userId: string, snapshotId: string) {
    return loadFirestoreBackup(this.context, userId, snapshotId);
  }

  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]> {
    return loadFirestoreCurrentMemos(this.context, userId);
  }

  loadDeletedMemoIds(userId: string) {
    return loadFirestoreDeletedMemoIds(this.context, userId);
  }

  deleteCurrentMemo(userId: string, memoId: string) {
    return deleteFirestoreCurrentMemo(this.context, userId, memoId);
  }
}
