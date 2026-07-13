import {
  DEFAULT_MEMO_STYLE,
  DEFAULT_MEMO_WINDOW_STATE,
  createMemo,
} from "@h-memo/memo-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageMemoRepository } from "./localStorageMemoRepository";

const STORAGE_KEY = "h-memo:web-memo-repository-v1";

type LocalStorageStubOptions = {
  initialEntries?: [string, string][];
  failOnGet?: boolean;
  failOnSet?: boolean;
};

function installLocalStorageStub(options: LocalStorageStubOptions = {}) {
  const store = new Map<string, string>(options.initialEntries ?? []);

  const getItem = vi.fn((key: string) => {
    if (options.failOnGet) {
      throw new Error("storage unavailable");
    }
    return store.has(key) ? store.get(key) ?? null : null;
  });
  const removeItem = vi.fn((key: string) => {
    store.delete(key);
  });
  const setItem = vi.fn((key: string, value: string) => {
    if (options.failOnSet) {
      throw new Error("quota exceeded");
    }
    store.set(String(key), String(value));
  });

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => {
        store.clear();
      },
      getItem,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem,
      setItem,
    },
  });

  return { store, getItem, removeItem, setItem };
}

describe("LocalStorageMemoRepository", () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  it("normalizes compatible legacy memo fields", async () => {
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

  it.each([
    ["invalid JSON", "not-json"],
    [
      "invalid memo schema",
      JSON.stringify([
        {
          title: "id가 없는 메모",
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:05:00.000Z",
        },
      ]),
    ],
  ])("fails closed for %s without overwriting durable data", async (_label, raw) => {
    const storage = installLocalStorageStub({
      initialEntries: [[STORAGE_KEY, raw]],
    });
    const repository = new LocalStorageMemoRepository();
    const memo = createMemo({
      id: "must-not-overwrite-corrupt-storage",
      now: "2026-07-12T21:00:00.000Z",
    });
    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    await expect(repository.listMemos()).rejects.toThrow(
      "로컬 메모 저장소 데이터를 읽을 수 없습니다"
    );
    await expect(repository.saveMemo(memo)).rejects.toThrow(
      "로컬 메모 저장소 데이터를 읽을 수 없습니다"
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.store.get(STORAGE_KEY)).toBe(raw);
  });

  it("does not write or erase records after localStorage getItem fails", async () => {
    const storage = installLocalStorageStub({ failOnGet: true });
    const repository = new LocalStorageMemoRepository();
    const memo = createMemo({
      id: "read-failure",
      now: "2026-07-12T21:10:00.000Z",
    });

    await expect(repository.saveMemo(memo)).rejects.toThrow(
      "로컬 메모 저장소 데이터를 읽을 수 없습니다"
    );
    await expect(
      repository.softDeleteMemo(memo.id, "2026-07-12T21:11:00.000Z")
    ).rejects.toThrow("로컬 메모 저장소 데이터를 읽을 수 없습니다");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
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

  it("refreshes from durable storage across repository instances before reads and writes", async () => {
    const firstRepository = new LocalStorageMemoRepository();
    const secondRepository = new LocalStorageMemoRepository();
    const firstMemo = createMemo({
      id: "cross-tab-first",
      now: "2026-07-12T19:00:00.000Z",
      plainText: "첫 번째 탭 메모",
    });
    const secondMemo = createMemo({
      id: "cross-tab-second",
      now: "2026-07-12T19:01:00.000Z",
      plainText: "두 번째 탭 메모",
    });

    await firstRepository.saveMemo(firstMemo);
    await expect(secondRepository.listMemos()).resolves.toEqual([firstMemo]);

    await secondRepository.saveMemo(secondMemo);
    await expect(firstRepository.listMemos()).resolves.toEqual([
      secondMemo,
      firstMemo,
    ]);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]").map(
        (memo: { id: string }) => memo.id
      )
    ).toEqual([secondMemo.id, firstMemo.id]);
  });
});
