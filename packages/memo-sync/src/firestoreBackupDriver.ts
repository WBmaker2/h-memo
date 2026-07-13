import {
  collection as firestoreCollection,
  doc as firestoreDoc,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  runTransaction as firestoreRunTransaction,
  serverTimestamp as firestoreServerTimestamp,
  setDoc as firestoreSetDoc,
  writeBatch as firestoreWriteBatch,
  type Firestore,
} from "firebase/firestore";

export type DriverDocumentSnapshot = {
  id: string;
  ref: unknown;
  exists(): boolean;
  data(): Record<string, unknown>;
};

export type DriverQuerySnapshot = {
  docs: DriverDocumentSnapshot[];
  empty: boolean;
};

export type DriverWriteBatch = {
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  update(ref: unknown, data: Record<string, unknown>): void;
  delete(ref: unknown): void;
  commit(): Promise<void>;
};

export type DriverTransaction = {
  get(ref: unknown): Promise<DriverDocumentSnapshot>;
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  update(ref: unknown, data: Record<string, unknown>): void;
  delete(ref: unknown): void;
};

export type FirestoreBackupDriver = {
  collection(parent: unknown, ...segments: string[]): unknown;
  doc(parent: unknown, ...segments: string[]): unknown;
  id(ref: unknown): string;
  getDoc(ref: unknown): Promise<DriverDocumentSnapshot>;
  getDocs(ref: unknown): Promise<DriverQuerySnapshot>;
  setDoc(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  writeBatch(firestore: unknown): DriverWriteBatch;
  runTransaction<T>(
    firestore: unknown,
    updater: (transaction: DriverTransaction) => Promise<T>
  ): Promise<T>;
  serverTimestamp(): unknown;
};

export const firebaseBackupDriver: FirestoreBackupDriver = {
  collection: (parent, ...segments) =>
    (firestoreCollection as unknown as (parent: unknown, ...paths: string[]) => unknown)(
      parent,
      ...segments
    ),
  doc: (parent, ...segments) =>
    (firestoreDoc as unknown as (parent: unknown, ...paths: string[]) => unknown)(parent, ...segments),
  id: (ref) => (ref as { id: string }).id,
  getDoc: async (ref) => (await firestoreGetDoc(ref as never)) as unknown as DriverDocumentSnapshot,
  getDocs: async (ref) => (await firestoreGetDocs(ref as never)) as unknown as DriverQuerySnapshot,
  setDoc: async (ref, data, options) => {
    await firestoreSetDoc(ref as never, data as never, options as never);
  },
  writeBatch: (firestore) => {
    const batch = firestoreWriteBatch(firestore as Firestore);
    return {
      set: (ref, data, options) => batch.set(ref as never, data as never, options as never),
      update: (ref, data) => batch.update(ref as never, data as never),
      delete: (ref) => batch.delete(ref as never),
      commit: () => batch.commit(),
    };
  },
  runTransaction: (firestore, updater) =>
    firestoreRunTransaction(firestore as Firestore, async (transaction) =>
      updater({
        get: async (ref) =>
          (await transaction.get(ref as never)) as unknown as DriverDocumentSnapshot,
        set: (ref, data, options) => transaction.set(ref as never, data as never, options as never),
        update: (ref, data) => transaction.update(ref as never, data as never),
        delete: (ref) => transaction.delete(ref as never),
      })
    ),
  serverTimestamp: () => firestoreServerTimestamp(),
};
