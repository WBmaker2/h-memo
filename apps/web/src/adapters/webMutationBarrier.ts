const MUTATION_LOCK_NAME = "h-memo:web-mutation-v1";
const RESTORE_LEASE_LOCK_NAME = "h-memo:web-restore-lease-v1";
const RESTORE_LEASE_STORAGE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_STORAGE_KEY = "h-memo:web-restore-epoch-v1";
const RESTORE_LEASE_CHANGED_EVENT = "h-memo:web-restore-lease-changed";
const FALLBACK_LOCK_STORAGE_PREFIX = "h-memo:web-fallback-lock-v1:";
const DEFAULT_LEASE_TTL_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_STALE_POLL_MS = 250;
const DEFAULT_FALLBACK_LOCK_TTL_MS = 5000;
const DEFAULT_FALLBACK_POLL_MS = 25;

type RestoreLease = {
  version: 1;
  token: string;
  owner: string;
  expiresAtMs: number;
};

type FallbackContender = {
  version: 1;
  owner: string;
  requestId: string;
  choosing: boolean;
  ticket: number;
  expiresAtMs: number;
};

export type WebMutationBarrierOptions = {
  leaseTtlMs?: number;
  heartbeatMs?: number;
  stalePollMs?: number;
  fallbackLockTtlMs?: number;
  fallbackPollMs?: number;
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

function isFallbackContender(value: unknown): value is FallbackContender {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<FallbackContender>;
  return (
    candidate.version === 1 &&
    typeof candidate.owner === "string" &&
    candidate.owner.trim() !== "" &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.trim() !== "" &&
    typeof candidate.choosing === "boolean" &&
    typeof candidate.ticket === "number" &&
    Number.isSafeInteger(candidate.ticket) &&
    candidate.ticket >= 0 &&
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

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getFallbackPrefix(name: string) {
  return `${FALLBACK_LOCK_STORAGE_PREFIX}${encodeURIComponent(name)}:`;
}

function compareContenders(left: FallbackContender, right: FallbackContender) {
  if (left.ticket !== right.ticket) {
    return left.ticket - right.ticket;
  }
  if (left.requestId === right.requestId) {
    return 0;
  }
  return left.requestId < right.requestId ? -1 : 1;
}

export class WebMutationBarrier {
  private readonly owner: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatMs: number;
  private readonly stalePollMs: number;
  private readonly fallbackLockTtlMs: number;
  private readonly fallbackPollMs: number;
  private readonly activeFallbackLocks = new Map<string, FallbackContender>();
  private readonly activeWebLocks = new Map<string, number>();
  private observedEpoch: number | null = null;

  constructor(options: WebMutationBarrierOptions = {}) {
    this.owner = options.ownerId ?? createToken("web-tab");
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.stalePollMs = options.stalePollMs ?? DEFAULT_STALE_POLL_MS;
    this.fallbackLockTtlMs =
      options.fallbackLockTtlMs ?? DEFAULT_FALLBACK_LOCK_TTL_MS;
    this.fallbackPollMs = options.fallbackPollMs ?? DEFAULT_FALLBACK_POLL_MS;
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

  private readLiveLease(): RestoreLease | null {
    const storage = getStorage();
    const raw = storage.getItem(RESTORE_LEASE_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = this.parseStoredLease(raw);
    if (parsed.expiresAtMs <= Date.now()) {
      if (storage.getItem(RESTORE_LEASE_STORAGE_KEY) === raw) {
        storage.removeItem(RESTORE_LEASE_STORAGE_KEY);
        this.dispatchLeaseChanged();
      }
      return null;
    }
    return parsed;
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

  private readFallbackContenders(name: string): FallbackContender[] {
    const storage = getStorage();
    const prefix = getFallbackPrefix(name);
    const records: FallbackContender[] = [];
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(prefix) === true);

    for (const key of keys) {
      const raw = storage.getItem(key);
      if (raw === null) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(
          `탭 간 변경 잠금 데이터가 손상되었습니다: ${getErrorMessage(error)}`
        );
      }
      if (!isFallbackContender(parsed) || key !== `${prefix}${parsed.requestId}`) {
        throw new Error("탭 간 변경 잠금 데이터가 손상되었습니다.");
      }
      if (parsed.expiresAtMs <= Date.now()) {
        if (storage.getItem(key) === raw) {
          storage.removeItem(key);
        }
        continue;
      }
      records.push(parsed);
    }
    return records;
  }

  private writeFallbackContender(name: string, contender: FallbackContender) {
    getStorage().setItem(
      `${getFallbackPrefix(name)}${contender.requestId}`,
      JSON.stringify(contender)
    );
  }

  private clearFallbackContender(name: string, requestId: string) {
    const storage = getStorage();
    const key = `${getFallbackPrefix(name)}${requestId}`;
    const raw = storage.getItem(key);
    if (raw === null) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `탭 간 변경 잠금 정리 데이터가 손상되었습니다: ${getErrorMessage(error)}`
      );
    }
    if (!isFallbackContender(parsed)) {
      throw new Error("탭 간 변경 잠금 정리 데이터가 손상되었습니다.");
    }
    if (parsed.requestId === requestId) {
      storage.removeItem(key);
    }
  }

  private assertFallbackOwnership(name: string, contender: FallbackContender) {
    const records = this.readFallbackContenders(name);
    const current = records.find(
      (record) => record.requestId === contender.requestId && record.owner === this.owner
    );
    if (!current || current.choosing || current.ticket !== contender.ticket) {
      throw new Error("탭 간 변경 잠금 소유권을 잃었습니다.");
    }
    const blocker = records.some(
      (record) =>
        record.requestId !== current.requestId &&
        (record.choosing || compareContenders(record, current) < 0)
    );
    if (blocker) {
      throw new Error("더 앞선 탭 간 변경 잠금 소유자가 있습니다.");
    }
  }

  private async runFallbackExclusive<T>(
    name: string,
    operation: () => Promise<T> | T
  ): Promise<T> {
    const requestId = createToken(`${this.owner}-request`);
    let contender: FallbackContender = {
      version: 1,
      owner: this.owner,
      requestId,
      choosing: true,
      ticket: 0,
      expiresAtMs: Date.now() + this.fallbackLockTtlMs,
    };
    let heartbeatError: unknown;
    let heartbeatId: number | null = null;
    let contenderWritten = false;
    let contenderReady = false;
    const errors: unknown[] = [];
    let result!: T;
    try {
      this.writeFallbackContender(name, contender);
      contenderWritten = true;
      const maxTicket = this.readFallbackContenders(name).reduce(
        (maximum, record) => Math.max(maximum, record.ticket),
        0
      );
      contender = {
        ...contender,
        choosing: false,
        ticket: maxTicket + 1,
        expiresAtMs: Date.now() + this.fallbackLockTtlMs,
      };
      this.writeFallbackContender(name, contender);
      contenderReady = true;

      const heartbeatMs = Math.max(
        1,
        Math.min(this.heartbeatMs, Math.floor(this.fallbackLockTtlMs / 3))
      );
      heartbeatId = window.setInterval(() => {
        if (heartbeatError) {
          return;
        }
        try {
          const records = this.readFallbackContenders(name);
          if (!records.some((record) => record.requestId === requestId)) {
            heartbeatError = new Error(
              "탭 간 변경 잠금 갱신 전에 소유권을 잃었습니다."
            );
            return;
          }
          contender = {
            ...contender,
            expiresAtMs: Date.now() + this.fallbackLockTtlMs,
          };
          this.writeFallbackContender(name, contender);
        } catch (error) {
          heartbeatError = error;
        }
      }, heartbeatMs);

      while (true) {
        if (heartbeatError) {
          throw heartbeatError;
        }
        const records = this.readFallbackContenders(name);
        const current = records.find((record) => record.requestId === requestId);
        if (!current) {
          throw new Error("탭 간 변경 잠금 대기 중 소유권을 잃었습니다.");
        }
        const blocked = records.some(
          (record) =>
            record.requestId !== requestId &&
            (record.choosing || compareContenders(record, current) < 0)
        );
        if (!blocked) {
          break;
        }
        await delay(this.fallbackPollMs);
      }

      this.activeFallbackLocks.set(name, contender);
      try {
        result = await operation();
      } catch (error) {
        errors.push(error);
      }
      if (heartbeatError) {
        errors.push(heartbeatError);
      }
      try {
        this.assertFallbackOwnership(name, contender);
      } catch (error) {
        errors.push(error);
      }
    } catch (error) {
      errors.push(
        contenderReady
          ? error
          : new Error(`탭 간 변경 잠금을 준비하지 못했습니다: ${getErrorMessage(error)}`)
      );
    } finally {
      const active = this.activeFallbackLocks.get(name);
      if (active?.requestId === requestId) {
        this.activeFallbackLocks.delete(name);
      }
      if (heartbeatId !== null) {
        window.clearInterval(heartbeatId);
      }
      if (contenderWritten) {
        try {
          this.clearFallbackContender(name, requestId);
        } catch (error) {
          errors.push(error);
        }
      }
    }

    const combined = combineErrors(errors, "탭 간 변경 작업 및 잠금 정리에 실패했습니다");
    if (combined !== undefined) {
      throw combined;
    }
    return result;
  }

  private runExclusive<T>(name: string, operation: () => Promise<T> | T) {
    const request = getLockRequest();
    if (!request) {
      return this.runFallbackExclusive(name, operation);
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
    if ((this.activeWebLocks.get(MUTATION_LOCK_NAME) ?? 0) > 0) {
      return;
    }
    const contender = this.activeFallbackLocks.get(MUTATION_LOCK_NAME);
    if (!contender) {
      throw new Error("탭 간 변경 잠금 밖에서는 메모 저장소를 변경할 수 없습니다.");
    }
    this.assertFallbackOwnership(MUTATION_LOCK_NAME, contender);
  }

  getRemoteLease(): RestoreLease | null {
    const lease = this.readLiveLease();
    return lease && lease.owner !== this.owner ? lease : null;
  }

  runMutation<T>(expectedEpoch: number, operation: () => Promise<T>) {
    return this.runExclusive(MUTATION_LOCK_NAME, async () => {
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
    let leaseAcquired = false;
    try {
      await this.runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
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
        leaseAcquired = true;
      });
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (leaseAcquired) {
        try {
          this.clearLease(token);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (error instanceof Error && error.message.includes("다른 탭에서 복원")) {
        const combined = combineErrors(
          [error, ...cleanupErrors],
          "복원 잠금 거부와 정리가 함께 실패했습니다"
        );
        throw combined ?? error;
      }
      const contextual = new Error(
        `복원 안전 지점 및 탭 간 잠금을 저장하지 못했습니다. 저장 공간을 확인해 주세요. ${getErrorMessage(error)}`
      );
      const combined = combineErrors(
        [contextual, error, ...cleanupErrors],
        "복원 잠금 준비 및 정리에 실패했습니다"
      );
      throw combined ?? contextual;
    }

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

    const errors: unknown[] = [];
    let result!: T;
    try {
      result = await this.runExclusive(MUTATION_LOCK_NAME, async () => {
        const current = this.readLiveLease();
        if (current?.token !== token || current.owner !== this.owner) {
          throw new Error("탭 간 복원 잠금 소유권을 잃었습니다.");
        }
        return operation();
      });
    } catch (error) {
      errors.push(error);
    } finally {
      window.clearInterval(heartbeatId);
      if (heartbeatError) {
        errors.push(heartbeatError);
      }
      try {
        await this.runExclusive(RESTORE_LEASE_LOCK_NAME, async () => {
          this.clearLease(token);
        });
      } catch (error) {
        errors.push(error);
      }
    }

    const combined = combineErrors(errors, "웹 복원 작업 및 잠금 정리에 실패했습니다");
    if (combined !== undefined) {
      throw combined;
    }
    return result;
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
