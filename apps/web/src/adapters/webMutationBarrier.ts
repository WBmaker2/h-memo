const MUTATION_LOCK_NAME = "h-memo:web-mutation-v1";
const RESTORE_LEASE_LOCK_NAME = "h-memo:web-restore-lease-v1";
const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_STORAGE_KEY = "h-memo:web-restore-epoch-v1";
const RESTORE_LEASE_CHANGED_EVENT = "h-memo:web-restore-lease-changed";
const DEFAULT_LEASE_TTL_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_STALE_POLL_MS = 250;

export const WEB_LOCKS_REQUIRED_MESSAGE =
  "이 브라우저에서는 안전한 탭 간 저장을 지원하지 않습니다. Web Locks API를 지원하는 최신 브라우저를 사용해 주세요.";

type RestoreLease = {
  version: 1;
  token: string;
  owner: string;
  expiresAtMs: number;
};

export type WebMutationBarrierOptions = {
  leaseTtlMs?: number;
  heartbeatMs?: number;
  stalePollMs?: number;
  ownerId?: string;
};

type LockRequest = <T>(
  name: string,
  options: { mode: "exclusive" },
  callback: () => Promise<T> | T
) => Promise<T>;

function createToken(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "알 수 없는 오류";
}

function combineErrors(errors: unknown[], context: string): unknown {
  const distinct = errors.filter(
    (error, index) => error !== undefined && errors.indexOf(error) === index
  );
  if (distinct.length === 0) {
    return undefined;
  }
  if (distinct.length === 1) {
    return distinct[0];
  }
  return new AggregateError(
    distinct,
    `${context}: ${distinct.map(getErrorMessage).join(" / ")}`
  );
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

export class WebMutationBarrier {
  private readonly owner: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatMs: number;
  private readonly stalePollMs: number;
  private readonly activeWebLocks = new Map<string, number>();
  private observedEpoch: number | null = null;

  constructor(options: WebMutationBarrierOptions = {}) {
    this.owner = options.ownerId ?? createToken("web-tab");
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.stalePollMs = options.stalePollMs ?? DEFAULT_STALE_POLL_MS;
  }

  getEpoch() {
    const raw = getStorage().getItem(RESTORE_EPOCH_STORAGE_KEY);
    if (raw === null) {
      return 0;
    }
    if (!/^\d+$/.test(raw)) {
      throw new Error("탭 간 복원 리비전 데이터가 손상되었습니다.");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("탭 간 복원 리비전 데이터가 손상되었습니다.");
    }
    return value;
  }

  markObservedEpoch(epoch: number) {
    if ((this.activeWebLocks.get(MUTATION_LOCK_NAME) ?? 0) === 0) {
      throw new Error("탭 간 변경 잠금 안에서만 메모 리비전을 확정할 수 있습니다.");
    }
    if (!Number.isSafeInteger(epoch) || epoch < 0 || this.getEpoch() !== epoch) {
      throw new Error("메모를 읽는 동안 다른 탭의 복원 리비전이 변경되었습니다.");
    }
    this.observedEpoch = epoch;
  }

  getObservedEpoch() {
    if (this.observedEpoch === null) {
      throw new Error("최신 메모 저장소 상태를 아직 확인하지 못했습니다.");
    }
    return this.observedEpoch;
  }

  private writeEpoch(value: number) {
    getStorage().setItem(RESTORE_EPOCH_STORAGE_KEY, String(value));
  }

  private dispatchLeaseChanged() {
    window.dispatchEvent(new Event(RESTORE_LEASE_CHANGED_EVENT));
  }

  private parseStoredLease(raw: string): RestoreLease {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`탭 간 복원 잠금 데이터가 손상되었습니다: ${getErrorMessage(error)}`);
    }
    if (!isRestoreLease(parsed)) {
      throw new Error("탭 간 복원 잠금 데이터가 손상되었습니다.");
    }
    return parsed;
  }

  private readStoredLease(): RestoreLease | null {
    const raw = getStorage().getItem(RESTORE_LEASE_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    return this.parseStoredLease(raw);
  }

  private readLiveLease(): RestoreLease | null {
    const stored = this.readStoredLease();
    return stored && stored.expiresAtMs > Date.now() ? stored : null;
  }

  private clearExpiredLeaseWhileMutationLocked() {
    if ((this.activeWebLocks.get(MUTATION_LOCK_NAME) ?? 0) === 0) {
      throw new Error("만료된 복원 알림은 탭 간 변경 잠금 안에서만 정리할 수 있습니다.");
    }
    const storage = getStorage();
    const raw = storage.getItem(RESTORE_LEASE_STORAGE_KEY);
    if (raw === null) {
      return;
    }
    const current = this.parseStoredLease(raw);
    if (current.owner === this.owner || current.expiresAtMs > Date.now()) {
      return;
    }
    if (storage.getItem(RESTORE_LEASE_STORAGE_KEY) === raw) {
      storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
      this.dispatchLeaseChanged();
    }
  }

  private writeLease(lease: RestoreLease) {
    getStorage().setItem(RESTORE_LEASE_STORAGE_KEY, JSON.stringify(lease));
    this.dispatchLeaseChanged();
  }

  private clearLease(token: string) {
    const storage = getStorage();
    const raw = storage.getItem(RESTORE_LEASE_STORAGE_KEY);
    if (raw === null) {
      return;
    }
    const current = this.parseStoredLease(raw);
    if (current.token !== token || current.owner !== this.owner) {
      return;
    }
    storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
    this.dispatchLeaseChanged();
  }

  private runExclusive<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
    const request = getLockRequest();
    if (!request) {
      return Promise.reject(new Error(WEB_LOCKS_REQUIRED_MESSAGE));
    }
    return request(name, { mode: "exclusive" }, async () => {
      this.activeWebLocks.set(name, (this.activeWebLocks.get(name) ?? 0) + 1);
      try {
        return await operation();
      } finally {
        const depth = (this.activeWebLocks.get(name) ?? 1) - 1;
        if (depth === 0) {
          this.activeWebLocks.delete(name);
        } else {
          this.activeWebLocks.set(name, depth);
        }
      }
    });
  }

  assertMutationWriteAllowed() {
    this.assertSupported();
    if ((this.activeWebLocks.get(MUTATION_LOCK_NAME) ?? 0) > 0) {
      return;
    }
    throw new Error("탭 간 변경 잠금 밖에서는 메모 저장소를 변경할 수 없습니다.");
  }

  isSupported() {
    return getLockRequest() !== null;
  }

  assertSupported() {
    if (!this.isSupported()) {
      throw new Error(WEB_LOCKS_REQUIRED_MESSAGE);
    }
  }

  getRemoteLease(): RestoreLease | null {
    const lease = this.readLiveLease();
    return lease && lease.owner !== this.owner ? lease : null;
  }

  runMutation<T>(expectedEpoch: number, operation: () => Promise<T>) {
    return this.runExclusive(MUTATION_LOCK_NAME, async () => {
      this.clearExpiredLeaseWhileMutationLocked();
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

  runReconciliation<T>(operation: () => Promise<T>) {
    const reconcileWhileLocked = async () => {
      this.clearExpiredLeaseWhileMutationLocked();
      const epochBeforeRead = this.getEpoch();
      const result = await operation();
      const epochAfterRead = this.getEpoch();
      if (epochBeforeRead !== epochAfterRead) {
        throw new Error("메모를 읽는 동안 다른 탭의 복원 리비전이 변경되었습니다.");
      }
      this.markObservedEpoch(epochAfterRead);
      return result;
    };
    if ((this.activeWebLocks.get(MUTATION_LOCK_NAME) ?? 0) > 0) {
      return reconcileWhileLocked();
    }
    return this.runExclusive(MUTATION_LOCK_NAME, reconcileWhileLocked);
  }

  async runRestore<T>(operation: () => Promise<T>): Promise<T> {
    const token = createToken("web-restore");
    let leaseAcquired = false;

    const preparationFailure = (error: unknown, cleanupErrors: unknown[] = []) => {
      if (error instanceof Error && error.message.includes("다른 탭에서 복원")) {
        return (
          combineErrors(
            [error, ...cleanupErrors],
            "복원 잠금 거부와 정리가 함께 실패했습니다"
          ) ?? error
        );
      }
      const contextual = new Error(
        `복원 안전 지점 및 탭 간 잠금을 저장하지 못했습니다. 저장 공간을 확인해 주세요. ${getErrorMessage(error)}`
      );
      return (
        combineErrors(
          [contextual, error, ...cleanupErrors],
          "복원 잠금 준비 및 정리에 실패했습니다"
        ) ?? contextual
      );
    };

    const prepareLease = (replaceExpired: boolean) =>
      this.runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
        const stored = this.readStoredLease();
        if (stored && stored.expiresAtMs > Date.now()) {
          throw new Error("다른 탭에서 복원 작업이 진행 중입니다.");
        }
        if (stored && !replaceExpired) {
          return false;
        }
        this.writeEpoch(this.getEpoch() + 1);
        this.writeLease({
          version: 1,
          token,
          owner: this.owner,
          expiresAtMs: Date.now() + this.leaseTtlMs,
        });
        leaseAcquired = true;
        return true;
      });

    const startHeartbeat = () => {
      let heartbeatError: unknown;
      const heartbeatId = window.setInterval(() => {
        if (heartbeatError) {
          return;
        }
        try {
          const current = this.readLiveLease();
          if (current?.token !== token || current.owner !== this.owner) {
            heartbeatError = new Error("탭 간 복원 잠금 소유권을 잃었습니다.");
            return;
          }
          this.writeLease({
            ...current,
            expiresAtMs: Date.now() + this.leaseTtlMs,
          });
        } catch (error) {
          heartbeatError = error;
        }
      }, this.heartbeatMs);
      return () => {
        window.clearInterval(heartbeatId);
        return heartbeatError;
      };
    };

    const executeOwnedRestore = async (stopHeartbeat: () => unknown) => {
      const errors: unknown[] = [];
      let result!: T;
      try {
        const current = this.readLiveLease();
        if (current?.token !== token || current.owner !== this.owner) {
          throw new Error("탭 간 복원 잠금 소유권을 잃었습니다.");
        }
        result = await operation();
      } catch (error) {
        errors.push(error);
      } finally {
        const heartbeatError = stopHeartbeat();
        if (heartbeatError) {
          errors.push(heartbeatError);
        }
        try {
          await this.runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
            this.clearLease(token);
          });
          leaseAcquired = false;
        } catch (error) {
          errors.push(error);
        }
      }
      const combined = combineErrors(errors, "웹 복원 작업 및 잠금 정리에 실패했습니다");
      if (combined !== undefined) {
        throw combined;
      }
      return result;
    };

    let preparedEarly: boolean;
    try {
      preparedEarly = await prepareLease(false);
    } catch (error) {
      throw preparationFailure(error);
    }

    if (!preparedEarly) {
      return this.runExclusive(MUTATION_LOCK_NAME, async () => {
        try {
          await prepareLease(true);
        } catch (error) {
          throw preparationFailure(error);
        }
        return executeOwnedRestore(startHeartbeat());
      });
    }

    const stopHeartbeat = startHeartbeat();
    let enteredMutationLock = false;
    try {
      return await this.runExclusive(MUTATION_LOCK_NAME, async () => {
        enteredMutationLock = true;
        return executeOwnedRestore(stopHeartbeat);
      });
    } catch (error) {
      if (enteredMutationLock) {
        throw error;
      }
      const cleanupErrors: unknown[] = [];
      const heartbeatError = stopHeartbeat();
      if (heartbeatError) {
        cleanupErrors.push(heartbeatError);
      }
      if (leaseAcquired) {
        try {
          await this.runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
            this.clearLease(token);
          });
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      throw combineErrors(
        [error, ...cleanupErrors],
        "웹 복원 잠금 진입 및 정리에 실패했습니다"
      );
    }
  }

  subscribe(listener: (lease: RestoreLease | null, epoch: number) => void) {
    const notify = () => listener(this.getRemoteLease(), this.getEpoch());
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
