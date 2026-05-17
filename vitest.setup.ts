function createStorageShim(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

function isUsableStorage(value: unknown): value is Storage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Storage).clear === "function" &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function"
  );
}

function readWindowLocalStorage(): unknown {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined" && !isUsableStorage(readWindowLocalStorage())) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageShim(),
    writable: true,
  });
}

if (typeof window !== "undefined" && isUsableStorage(window.localStorage)) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
    writable: true,
  });
}
