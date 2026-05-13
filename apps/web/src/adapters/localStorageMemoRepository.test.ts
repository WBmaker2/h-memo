import {
  DEFAULT_MEMO_STYLE,
  DEFAULT_MEMO_WINDOW_STATE,
  createMemo,
} from "@h-memo/memo-core";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageMemoRepository } from "./localStorageMemoRepository";

const STORAGE_KEY = "h-memo:web-memo-repository-v1";

type LocalStorageStubOptions = {
  initialEntries?: [string, string][];
  failOnSet?: boolean;
};

function installLocalStorageStub(options: LocalStorageStubOptions = {}) {
  const store = new Map<string, string>(options.initialEntries ?? []);

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => {
        store.clear();
      },
      getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        if (options.failOnSet) {
          throw new Error("quota exceeded");
        }
        store.set(String(key), String(value));
      },
    },
  });

  return store;
}

describe("LocalStorageMemoRepository", () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  it("normalizes corrupt memo records and ignores invalid records", async () => {
    installLocalStorageStub({
      initialEntries: [
        [
          STORAGE_KEY,
          JSON.stringify([
            {
              id: "legacy-memo",
              title: 42,
              plainText: "복구된 본문",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
              deletedAt: 123,
              syncState: "not-a-sync-state",
              style: {
                backgroundColor: 42,
                fontSize: -1,
              },
              windowState: {
                visible: "yes",
                width: 0,
                height: "wide",
              },
            },
            {
              title: "id가 없어 무시될 메모",
              plainText: "ignored",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
            },
          ]),
        ],
      ],
    });

    const repository = new LocalStorageMemoRepository();
    const memos = await repository.listMemos();

    expect(memos).toHaveLength(1);
    expect(memos[0]).toMatchObject({
      id: "legacy-memo",
      title: "새 메모",
      plainText: "복구된 본문",
      style: DEFAULT_MEMO_STYLE,
      windowState: DEFAULT_MEMO_WINDOW_STATE,
      deletedAt: null,
      syncState: "local-only",
    });
  });

  it("throws and keeps repository state unchanged when localStorage write fails", async () => {
    installLocalStorageStub({ failOnSet: true });
    const repository = new LocalStorageMemoRepository();
    const memo = createMemo({
      id: "write-failure",
      now: "2026-05-13T10:00:00.000Z",
    });

    await expect(repository.saveMemo(memo)).rejects.toThrow("localStorage 저장 실패");
    await expect(repository.listMemos()).resolves.toHaveLength(0);
  });
});
