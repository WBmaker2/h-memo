const MUTATION_LOCK_NAME = "h-memo:web-mutation-v1";
const RESTORE_LEASE_LOCK_NAME = "h-memo:web-restore-lease-v1";
const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_STORAGE_KEY = "h-memo:web-restore-epoch-v1";
const RESTORE_LEASE_CHANGED_EVENT = "h-memo:web-restore-lease-changed";
const DEFAULT_LEASE_TTL_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_STALE_POLL_MS = 250;

type RestoreLease = {
  version: 1;
  token: string;
  owner: string;
  expiresAtMs: number;
};

type WebMutationBarrierOptions = {
  leaseTtlMs?: number;
  heartbeatMs?: number;
  stalePollMs?: number;
};

type LockRequest = <T>(
  name: string,
  options: { mode: "exclusive" },
  callback: () => Promise<T> | T
) => Promise<T>;

const fallbackLockTails = new Map<string, Promise<void>>();

function createToken(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRestoreLease(value: unknown): value is RestoreLease {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RestoreLease>;
  return (
    candidate.version === 1 &&
    typeof candidate.token === "string" &&
    candidate.token.trim() !== "" &&
    typeof candidate.owner === "string" &&
    candidate.owner.trim() !== "" &&
    typeof candidate.expiresAtMs === "number" &&
    Number.isFinite(candidate.expiresAtMs)
  );
}

function getStorage(): Storage {
  try {
    return window.localStorage;
  } catch (error) {
    throw new Error(`탭 간 복원 잠금 저장소를 사용할 수 없습니다: ${String(error)}`);
  }
}

function getLockRequest(): LockRequest | null {
  const lockManager = navigator.locks;
  if (!lockManager || typeof lockManager.request !== "function") {
    return null;
  }
  return async (name, options, callback) =>
    await lockManager.request(name, options, async () => await callback());
}

function runFallbackExclusive<T>(name: string, operation: () => Promise<T> | T) {
  const previous = fallbackLockTails.get(name) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  fallbackLockTails.set(
    name,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

function runExclusive<T>(name: string, operation: () => Promise<T> | T) {
  const request = getLockRequest();
  if (request) {
    return request(name, { mode: "exclusive" }, operation);
  }
  return runFallbackExclusive(name, operation);
}

export class WebMutationBarrier {
  private readonly owner = createToken("web-tab");
  private readonly leaseTtlMs: number;
  private readonly heartbeatMs: number;
  private readonly stalePollMs: number;

  constructor(options: WebMutationBarrierOptions = {}) {
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.stalePollMs = options.stalePollMs ?? DEFAULT_STALE_POLL_MS;
  }

  getEpoch() {
    const value = Number.parseInt(
      getStorage().getItem(RESTORE_EPOCH_STORAGE_KEY) ?? "0",
      10
    );
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private writeEpoch(value: number) {
    getStorage().setItem(RESTORE_EPOCH_STORAGE_KEY, String(value));
  }

  private dispatchLeaseChanged() {
    window.dispatchEvent(new Event(RESTORE_LEASE_CHANGED_EVENT));
  }

  private readLiveLease(): RestoreLease | null {
    const storage = getStorage();
    const raw = storage.getItem(RESTORE_LEASE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRestoreLease(parsed)) {
        storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
        this.dispatchLeaseChanged();
        return null;
      }
      if (parsed.expiresAtMs <= Date.now()) {
        if (storage.getItem(RESTORE_LEASE_STORAGE_KEY) === raw) {
          storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
          this.dispatchLeaseChanged();
        }
        return null;
      }
      return parsed;
    } catch {
      storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
      this.dispatchLeaseChanged();
      return null;
    }
  }

  private writeLease(lease: RestoreLease) {
    getStorage().setItem(RESTORE_LEASE_STORAGE_KEY, JSON.stringify(lease));
    this.dispatchLeaseChanged();
  }

  private clearLease(token: string) {
    const current = this.readLiveLease();
    if (current?.token !== token || current.owner !== this.owner) {
      return;
    }
    getStorage().removeItem(RESTORE_LEASE_STORAGE_KEY);
    this.dispatchLeaseChanged();
  }

  getRemoteLease(): RestoreLease | null {
    const lease = this.readLiveLease();
    return lease && lease.owner !== this.owner ? lease : null;
  }

  runMutation<T>(expectedEpoch: number, operation: () => Promise<T>) {
    return runExclusive(MUTATION_LOCK_NAME, async () => {
      if (this.getEpoch() !== expectedEpoch) {
        throw new Error(
          "다른 탭의 복원 이후 대기 중이던 오래된 메모 변경을 취소했습니다."
        );
      }
      if (this.getRemoteLease()) {
        throw new Error("다른 탭에서 복원 작업이 진행 중입니다.");
      }
      return operation();
    });
  }

  async runRestore<T>(operation: () => Promise<T>): Promise<T> {
    const token = createToken("web-restore");
    try {
      await runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
        const current = this.readLiveLease();
        if (current) {
          throw new Error("다른 탭에서 복원 작업이 진행 중입니다.");
        }
        this.writeEpoch(this.getEpoch() + 1);
        this.writeLease({
          version: 1,
          token,
          owner: this.owner,
          expiresAtMs: Date.now() + this.leaseTtlMs,
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("다른 탭에서 복원")) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `복원 안전 지점 및 탭 간 잠금을 저장하지 못했습니다. 저장 공간을 확인해 주세요. ${detail}`
      );
    }

    const heartbeatId = window.setInterval(() => {
      const current = this.readLiveLease();
      if (current?.token !== token || current.owner !== this.owner) {
        return;
      }
      this.writeLease({
        ...current,
        expiresAtMs: Date.now() + this.leaseTtlMs,
      });
    }, this.heartbeatMs);

    try {
      return await runExclusive(MUTATION_LOCK_NAME, async () => {
        const current = this.readLiveLease();
        if (current?.token !== token || current.owner !== this.owner) {
          throw new Error("탭 간 복원 잠금 소유권을 잃었습니다.");
        }
        return operation();
      });
    } finally {
      window.clearInterval(heartbeatId);
      await runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
        this.clearLease(token);
      });
    }
  }

  subscribe(listener: (lease: RestoreLease | null) => void) {
    const notify = () => listener(this.getRemoteLease());
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === RESTORE_LEASE_STORAGE_KEY ||
        event.key === RESTORE_EPOCH_STORAGE_KEY
      ) {
        notify();
      }
    };
    const pollId = window.setInterval(notify, this.stalePollMs);
    window.addEventListener(RESTORE_LEASE_CHANGED_EVENT, notify);
    window.addEventListener("storage", handleStorage);
    queueMicrotask(notify);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener(RESTORE_LEASE_CHANGED_EVENT, notify);
      window.removeEventListener("storage", handleStorage);
    };
  }
}
