import { invoke } from "@tauri-apps/api/core";

export type RestoreLockRequest = {
  token: string;
};

export type RestoreLockRelease = RestoreLockRequest & {
  finalApplyGeneration?: number;
};

export type RestoreLockAcknowledgement = {
  token: string;
  windowLabel: string;
  ok: boolean;
  error?: string;
};

export type RestoreStoreApplyRequest = {
  token: string;
  generation: number;
};

export type RestoreStoreApplyAcknowledgement = RestoreLockAcknowledgement & {
  generation: number;
};

export type RestoreLockLease = {
  token: string;
  owner: string;
  expiresAtMs: number;
  operationActive: boolean;
};

export type RestoreLockLeaseAdapter = {
  acquire: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
  cancelAcquire?: (token: string) => Promise<void>;
  current: () => Promise<RestoreLockLease | null>;
  renew: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
  activate: (token: string, owner: string) => Promise<RestoreLockLease>;
  finish?: (
    token: string,
    owner: string,
    cleanupTtlMs: number
  ) => Promise<RestoreLockLease>;
  release: (token: string, owner: string) => Promise<boolean>;
};

export type RestoreLockCoordinatorOptions = {
  getCurrentWindowLabel: () => string;
  listLiveWindowLabels: () => Promise<string[]>;
  notifyLockRequested: (token: string) => Promise<void>;
  listenLockRequested: (
    handler: (payload: RestoreLockRequest) => void | Promise<void>
  ) => Promise<() => void>;
  notifyLockAcknowledged: (payload: RestoreLockAcknowledgement) => Promise<void>;
  listenLockAcknowledged: (
    handler: (payload: RestoreLockAcknowledgement) => void
  ) => Promise<() => void>;
  notifyLockReleased: (
    token: string,
    finalApplyGeneration: number
  ) => Promise<void>;
  listenLockReleased: (
    handler: (payload: RestoreLockRelease) => void | Promise<void>
  ) => Promise<() => void>;
  notifyStoreApplyRequested?: (payload: RestoreStoreApplyRequest) => Promise<void>;
  listenStoreApplyRequested?: (
    handler: (payload: RestoreStoreApplyRequest) => void | Promise<void>
  ) => Promise<() => void>;
  notifyStoreApplyAcknowledged?: (
    payload: RestoreStoreApplyAcknowledgement
  ) => Promise<void>;
  listenStoreApplyAcknowledged?: (
    handler: (payload: RestoreStoreApplyAcknowledgement) => void
  ) => Promise<() => void>;
  applyStore?: (payload: RestoreStoreApplyRequest) => Promise<void>;
  nativeLease?: RestoreLockLeaseAdapter;
  lockLocal: (token: string) => Promise<void>;
  unlockLocal: (token: string) => void;
  timeoutMs?: number;
  leaseTtlMs?: number;
  leaseRenewIntervalMs?: number;
  leasePollIntervalMs?: number;
  cleanupTimeoutMs?: number;
  bridgeTimeoutMs?: number;
  cleanupRetryIntervalMs?: number;
  onProtocolError?: (error: unknown) => void;
};

type PendingAcknowledgements = {
  expectedWindowLabels: Set<string>;
  acknowledgedWindowLabels: Set<string>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type PendingStoreApplyAcknowledgements = PendingAcknowledgements & {
  generation: number;
};

const DEFAULT_ACK_TIMEOUT_MS = 5000;
const DEFAULT_LEASE_TTL_MS = 10000;
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 2000;
const DEFAULT_LEASE_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1000;
const DEFAULT_BRIDGE_TIMEOUT_MS = 1000;
const NATIVE_CLEANUP_PENDING_MESSAGE =
  "복원 작업은 완료되었지만 native lease 정리가 보류되었습니다.";

export function createTauriRestoreLockLeaseAdapter(): RestoreLockLeaseAdapter {
  return {
    acquire: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("acquire_restore_lock_lease", { token, owner, ttlMs }),
    cancelAcquire: (token) =>
      invoke<void>("cancel_abandoned_restore_lock_acquire", { token }),
    current: () => invoke<RestoreLockLease | null>("current_restore_lock_lease"),
    renew: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("renew_restore_lock_lease", { token, owner, ttlMs }),
    activate: (token, owner) =>
      invoke<RestoreLockLease>("activate_restore_lock_lease", { token, owner }),
    finish: (token, owner, cleanupTtlMs) =>
      invoke<RestoreLockLease>("finish_restore_lock_lease", {
        token,
        owner,
        cleanupTtlMs,
      }),
    release: (token, owner) =>
      invoke<boolean>("release_restore_lock_lease", { token, owner }),
  };
}

function createToken() {
  return `restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error
      ? error
      : "알 수 없는 오류";
}

function aggregateErrors(context: string, errors: unknown[]) {
  const filtered = errors.filter(
    (error, index) =>
      error !== null && error !== undefined && errors.indexOf(error) === index
  );
  if (filtered.length === 1) {
    return filtered[0];
  }
  return new AggregateError(
    filtered,
    `${context}: ${filtered.map(getErrorMessage).join(" / ")}`
  );
}

export function createRestoreLockCoordinator(options: RestoreLockCoordinatorOptions) {
  const pendingAcknowledgements = new Map<string, PendingAcknowledgements>();
  const pendingStoreApplyAcknowledgements = new Map<
    string,
    PendingStoreApplyAcknowledgements
  >();
  const pendingRemoteAcquires = new Map<string, () => void>();
  const cleanups: Array<() => void> = [];
  const nativeLease = options.nativeLease;
  const owner = options.getCurrentWindowLabel();
  const leaseRenewIntervalMs =
    options.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
  const bridgeTimeoutMs = options.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  const leaseTtlMs = Math.max(
    options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    leaseRenewIntervalMs * 4,
    bridgeTimeoutMs * 2 + leaseRenewIntervalMs * 2
  );
  const leasePollIntervalMs = options.leasePollIntervalMs ?? DEFAULT_LEASE_POLL_INTERVAL_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const cleanupRetryIntervalMs =
    options.cleanupRetryIntervalMs ?? leasePollIntervalMs;
  const cleanupLeaseTtlMs = Math.max(
    cleanupTimeoutMs,
    cleanupRetryIntervalMs * 16,
    (options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS) + bridgeTimeoutMs * 2
  );
  let startPromise: Promise<void> | null = null;
  let localToken: string | null = null;
  let nextOperationGeneration = 0;
  let localOperationGeneration = 0;
  let localOperationActivated = false;
  let localExpectedWindowLabels: Set<string> | null = null;
  let nextStoreApplyGeneration = 0;
  let localFinalApplyGeneration: number | null = null;
  let remoteToken: string | null = null;
  let remoteLatestApplyGeneration = 0;
  let remoteAppliedGeneration = 0;
  let remoteStoreApplyToken: string | null = null;
  let remoteStoreApplyGeneration = 0;
  let remoteStoreApplyPromise: Promise<void> | null = null;
  let remoteFinalApplyGeneration: number | null = null;
  let remoteFinalApplyPromise: Promise<void> | null = null;
  let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  let leaseRenewalToken: string | null = null;
  let leaseRenewalGeneration = 0;
  let leaseRenewInFlight: {
    token: string;
    generation: number;
    promise: Promise<void>;
  } | null = null;
  let remoteLeasePollTimer: ReturnType<typeof setInterval> | null = null;
  let remoteLeaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeLeaseFailureReject: ((error: unknown) => void) | null = null;
  let activeLeaseFailureToken: string | null = null;
  let activeLeaseFailureGeneration = 0;
  let activeLeaseOwnershipFailure: Error | null = null;
  let activeOperation: Promise<unknown> | null = null;
  let runQueue: Promise<void> = Promise.resolve();
  let stopping = false;
  let lifecycleGeneration = 0;
  let nextRemoteRequestGeneration = 0;
  let latestRemoteRequestGeneration = 0;
  let pendingLocalRecovery: {
    token: string;
    finalApplyGeneration: number;
    nativeAcquireCancellationComplete: boolean;
    nativeFinished: boolean;
    applyComplete: boolean;
    notificationComplete: boolean;
    notificationBypassedAfterNativeAbsence: boolean;
    notificationError: unknown | null;
    nativeComplete: boolean;
    postRemovalVerificationComplete: boolean;
    retryAttempt: number;
  } | null = null;
  let nativeCleanupRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let nativeCleanupInFlight: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const reportProtocolError = (error: unknown) => {
    options.onProtocolError?.(error);
  };

  const runWithTimeout = async <T,>(
    operation: () => Promise<T>,
    timeoutMessage: string,
    timeoutMs = bridgeTimeoutMs
  ): Promise<T> => {
    let operationPromise: Promise<T>;
    try {
      operationPromise = operation();
    } catch (error) {
      throw error;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const readNativeLease = () => {
    if (!nativeLease) {
      return Promise.resolve(null);
    }
    return runWithTimeout(
      () => nativeLease.current(),
      "복원 잠금 lease 확인이 시간 초과되었습니다."
    );
  };

  const isCurrentLifecycle = (generation: number) =>
    !stopping && lifecycleGeneration === generation;

  const isCurrentRemoteRequest = (
    requestGeneration: number,
    generation: number
  ) =>
    isCurrentLifecycle(generation) &&
    latestRemoteRequestGeneration === requestGeneration;

  const settlePending = (token: string, windowLabel: string, error?: unknown) => {
    const pending = pendingAcknowledgements.get(token);
    if (!pending || !pending.expectedWindowLabels.has(windowLabel)) {
      return;
    }

    if (error) {
      pending.reject(error);
      return;
    }

    pending.acknowledgedWindowLabels.add(windowLabel);
    if (
      pending.acknowledgedWindowLabels.size === pending.expectedWindowLabels.size
    ) {
      pending.resolve();
    }
  };

  const settleStoreApplyPending = (
    token: string,
    generation: number,
    windowLabel: string,
    error?: unknown
  ) => {
    const pending = pendingStoreApplyAcknowledgements.get(token);
    if (
      !pending ||
      pending.generation !== generation ||
      !pending.expectedWindowLabels.has(windowLabel)
    ) {
      return;
    }

    if (error) {
      pending.reject(error);
      return;
    }

    pending.acknowledgedWindowLabels.add(windowLabel);
    if (
      pending.acknowledgedWindowLabels.size === pending.expectedWindowLabels.size
    ) {
      pending.resolve();
    }
  };

  const clearPending = (token: string) => {
    pendingAcknowledgements.delete(token);
  };

  const clearStoreApplyPending = (token: string) => {
    pendingStoreApplyAcknowledgements.delete(token);
  };

  const isCurrentLocalOperation = (token: string, generation: number) =>
    localToken === token && localOperationGeneration === generation;

  const clearLeaseRenewal = (token?: string, generation?: number) => {
    if (
      token &&
      (leaseRenewalToken !== token || leaseRenewalGeneration !== generation)
    ) {
      return;
    }
    if (leaseRenewTimer) {
      clearInterval(leaseRenewTimer);
      leaseRenewTimer = null;
    }
    leaseRenewalToken = null;
    leaseRenewalGeneration = 0;
  };

  const clearRemoteLeaseWatch = () => {
    if (remoteLeasePollTimer) {
      clearInterval(remoteLeasePollTimer);
      remoteLeasePollTimer = null;
    }
    if (remoteLeaseExpiryTimer) {
      clearTimeout(remoteLeaseExpiryTimer);
      remoteLeaseExpiryTimer = null;
    }
  };

  const finalizeRemoteUnlock = (token: string) => {
    if (remoteToken !== token) {
      return;
    }
    remoteToken = null;
    remoteLatestApplyGeneration = 0;
    remoteAppliedGeneration = 0;
    remoteStoreApplyToken = null;
    remoteStoreApplyGeneration = 0;
    remoteStoreApplyPromise = null;
    remoteFinalApplyGeneration = null;
    remoteFinalApplyPromise = null;
    clearRemoteLeaseWatch();
    const resolveAcquire = pendingRemoteAcquires.get(token);
    pendingRemoteAcquires.delete(token);
    resolveAcquire?.();
    options.unlockLocal(token);
  };

  const applyRemoteStoreForGeneration = async (
    token: string,
    generation: number
  ) => {
    if (!options.applyStore) {
      return;
    }
    if (
      remoteStoreApplyToken === token &&
      remoteStoreApplyGeneration === generation &&
      remoteStoreApplyPromise
    ) {
      return remoteStoreApplyPromise;
    }

    remoteStoreApplyToken = token;
    remoteStoreApplyGeneration = generation;
    const applyPromise = runWithTimeout(
      () => options.applyStore!({ token, generation }),
      "복원된 메모 상태 적용이 시간 초과되었습니다."
    );
    remoteStoreApplyPromise = applyPromise;
    try {
      await applyPromise;
      if (
        remoteToken === token &&
        remoteLatestApplyGeneration === generation
      ) {
        remoteAppliedGeneration = generation;
      }
    } finally {
      if (remoteStoreApplyPromise === applyPromise) {
        remoteStoreApplyToken = null;
        remoteStoreApplyGeneration = 0;
        remoteStoreApplyPromise = null;
      }
    }
  };

  const unlockRemote = (
    token: string,
    requestedFinalGeneration?: number
  ): Promise<void> => {
    if (remoteToken !== token) {
      return Promise.resolve();
    }
    if (!options.applyStore) {
      finalizeRemoteUnlock(token);
      return Promise.resolve();
    }
    if (remoteFinalApplyGeneration === null) {
      remoteFinalApplyGeneration = Math.max(
        requestedFinalGeneration ?? 0,
        remoteLatestApplyGeneration + 1,
        remoteAppliedGeneration + 1
      );
    } else if (
      requestedFinalGeneration !== undefined &&
      requestedFinalGeneration > remoteFinalApplyGeneration
    ) {
      remoteFinalApplyGeneration = requestedFinalGeneration;
    }
    remoteLatestApplyGeneration = Math.max(
      remoteLatestApplyGeneration,
      remoteFinalApplyGeneration
    );

    if (remoteFinalApplyPromise) {
      return remoteFinalApplyPromise;
    }

    const precedingApply = remoteStoreApplyPromise;
    const finalApply = (async () => {
      if (precedingApply) {
        await precedingApply.catch(reportProtocolError);
      }
      while (remoteToken === token && remoteFinalApplyGeneration !== null) {
        const generation: number = remoteFinalApplyGeneration;
        remoteLatestApplyGeneration = Math.max(
          remoteLatestApplyGeneration,
          generation
        );
        try {
          await applyRemoteStoreForGeneration(token, generation);
        } catch (error) {
          reportProtocolError(error);
          if (
            remoteToken === token &&
            remoteFinalApplyGeneration !== generation
          ) {
            continue;
          }
          if (remoteToken === token) {
            remoteFinalApplyGeneration = Math.max(
              generation + 1,
              remoteLatestApplyGeneration + 1
            );
            remoteLatestApplyGeneration = remoteFinalApplyGeneration;
          }
          return;
        }
        if (remoteToken !== token) {
          return;
        }
        if (remoteFinalApplyGeneration !== generation) {
          continue;
        }
        if (remoteAppliedGeneration === generation) {
          finalizeRemoteUnlock(token);
        }
        return;
      }
    })();
    remoteFinalApplyPromise = finalApply;
    void finalApply.finally(() => {
      if (remoteFinalApplyPromise === finalApply) {
        remoteFinalApplyPromise = null;
      }
    });
    return finalApply;
  };

  const markLeaseOwnershipLost = (
    token: string,
    generation: number,
    cause: unknown
  ) => {
    if (
      !isCurrentLocalOperation(token, generation) ||
      leaseRenewalToken !== token ||
      leaseRenewalGeneration !== generation
    ) {
      return;
    }
    const failure = new Error(
      `복원 잠금 lease 소유권을 잃었습니다: ${getErrorMessage(cause)}`,
      { cause }
    );
    activeLeaseOwnershipFailure = failure;
    clearLeaseRenewal(token, generation);
    reportProtocolError(failure);
    if (
      activeLeaseFailureToken === token &&
      activeLeaseFailureGeneration === generation
    ) {
      activeLeaseFailureReject?.(failure);
    }
  };

  const assertLeaseOwnership = (token: string, generation: number) => {
    if (stopping) {
      throw (
        activeLeaseOwnershipFailure ??
        new Error("복원 잠금 coordinator가 종료되어 작업을 계속할 수 없습니다.")
      );
    }
    if (!isCurrentLocalOperation(token, generation)) {
      throw new Error("복원 잠금 lease가 현재 작업과 일치하지 않습니다.");
    }
    if (activeLeaseOwnershipFailure) {
      throw activeLeaseOwnershipFailure;
    }
  };

  const startLeaseRenewal = (token: string, generation: number) => {
    if (!nativeLease || leaseRenewTimer) {
      return;
    }
    leaseRenewalToken = token;
    leaseRenewalGeneration = generation;
    leaseRenewTimer = setInterval(() => {
      const tickToken = localToken;
      const tickGeneration = localOperationGeneration;
      if (
        !tickToken ||
        tickToken !== token ||
        tickGeneration !== generation ||
        leaseRenewalToken !== tickToken ||
        leaseRenewalGeneration !== tickGeneration
      ) {
        return;
      }
      if (
        leaseRenewInFlight?.token === tickToken &&
        leaseRenewInFlight.generation === tickGeneration
      ) {
        return;
      }

      const renewal = (async () => {
        try {
          const renewed = await runWithTimeout(
            () => nativeLease.renew(tickToken, owner, leaseTtlMs),
            "복원 잠금 lease 갱신이 시간 초과되었습니다."
          );
          if (
            !isCurrentLocalOperation(tickToken, tickGeneration) ||
            leaseRenewalToken !== tickToken ||
            leaseRenewalGeneration !== tickGeneration
          ) {
            return;
          }
          if (
            renewed.token !== tickToken ||
            renewed.owner !== owner ||
            (localOperationActivated && !renewed.operationActive) ||
            renewed.expiresAtMs <= Date.now()
          ) {
            markLeaseOwnershipLost(
              tickToken,
              tickGeneration,
              new Error("복원 잠금 lease 갱신 소유자 확인에 실패했습니다.")
            );
          }
        } catch (error) {
          if (
            !isCurrentLocalOperation(tickToken, tickGeneration) ||
            leaseRenewalToken !== tickToken ||
            leaseRenewalGeneration !== tickGeneration
          ) {
            return;
          }

          let current: RestoreLockLease | null;
          try {
            current = await readNativeLease();
          } catch (lookupError) {
            if (
              isCurrentLocalOperation(tickToken, tickGeneration) &&
              leaseRenewalToken === tickToken &&
              leaseRenewalGeneration === tickGeneration
            ) {
              reportProtocolError(
                aggregateErrors("복원 잠금 lease 갱신과 확인에 실패했습니다", [
                  error,
                  lookupError,
                ])
              );
            }
            return;
          }
          if (
            !isCurrentLocalOperation(tickToken, tickGeneration) ||
            leaseRenewalToken !== tickToken ||
            leaseRenewalGeneration !== tickGeneration
          ) {
            return;
          }
          if (
            !current ||
            current.token !== tickToken ||
            current.owner !== owner ||
            (localOperationActivated && !current.operationActive) ||
            current.expiresAtMs <= Date.now()
          ) {
            markLeaseOwnershipLost(tickToken, tickGeneration, error);
            return;
          }
          reportProtocolError(
            toError(error, "복원 잠금 lease 갱신에 일시적으로 실패했습니다.")
          );
        }
      })();
      leaseRenewInFlight = {
        token: tickToken,
        generation: tickGeneration,
        promise: renewal,
      };
      void renewal.finally(() => {
        if (leaseRenewInFlight?.promise === renewal) {
          leaseRenewInFlight = null;
        }
      });
    }, leaseRenewIntervalMs);
  };

  const checkRemoteLease = async (token: string) => {
    if (!nativeLease || remoteToken !== token) {
      return;
    }

    try {
      const current = await readNativeLease();
      if (remoteToken !== token) {
        return;
      }
      if (!current || current.token !== token) {
        await unlockRemote(token);
      } else if (current.operationActive) {
        if (remoteLeaseExpiryTimer) {
          clearTimeout(remoteLeaseExpiryTimer);
          remoteLeaseExpiryTimer = null;
        }
      } else {
        scheduleRemoteLeaseExpiry(token, current.expiresAtMs, current.operationActive);
      }
    } catch (error) {
      reportProtocolError(error);
    }
  };

  const scheduleRemoteLeaseExpiry = (
    token: string,
    expiresAtMs = Date.now() + leaseTtlMs,
    operationActive = false
  ) => {
    if (remoteLeaseExpiryTimer) {
      clearTimeout(remoteLeaseExpiryTimer);
      remoteLeaseExpiryTimer = null;
    }
    if (operationActive) {
      return;
    }
    const remainingMs = Math.max(leasePollIntervalMs, expiresAtMs - Date.now());
    remoteLeaseExpiryTimer = setTimeout(() => {
      if (remoteToken === token) {
        void checkRemoteLease(token);
      }
    }, remainingMs + leasePollIntervalMs);
  };

  const startRemoteLeaseWatch = (
    token: string,
    expiresAtMs?: number,
    operationActive = false
  ) => {
    if (!nativeLease) {
      return;
    }
    clearRemoteLeaseWatch();
    remoteLeasePollTimer = setInterval(() => {
      void checkRemoteLease(token);
    }, leasePollIntervalMs);
    scheduleRemoteLeaseExpiry(token, expiresAtMs, operationActive);
  };

  const acquireRemoteLock = async (
    token: string,
    lease: RestoreLockLease | undefined,
    generation: number,
    requestGeneration: number
  ) => {
    const expectedLeaseOwner = lease?.owner;
    const isCurrentRequest = () =>
      isCurrentRemoteRequest(requestGeneration, generation);

    if (!isCurrentRequest()) {
      return;
    }
    remoteToken = token;
    remoteLatestApplyGeneration = 0;
    remoteAppliedGeneration = 0;
    remoteFinalApplyGeneration = null;
    remoteFinalApplyPromise = null;
    startRemoteLeaseWatch(token, lease?.expiresAtMs, lease?.operationActive ?? false);
    const releaseSignal = new Promise<void>((resolve) => {
      pendingRemoteAcquires.set(token, resolve);
    });
    try {
      await Promise.race([
        Promise.resolve().then(() => options.lockLocal(token)),
        releaseSignal,
      ]);
      if (!isCurrentRequest()) {
        pendingRemoteAcquires.delete(token);
        return;
      }
      if (remoteToken !== token) {
        pendingRemoteAcquires.delete(token);
        return;
      }
      if (nativeLease) {
        const current = await readNativeLease();
        if (!isCurrentRequest()) {
          pendingRemoteAcquires.delete(token);
          return;
        }
        if (
          remoteToken !== token ||
          !current ||
          current.token !== token ||
          (expectedLeaseOwner !== undefined && current.owner !== expectedLeaseOwner)
        ) {
          if (remoteToken !== token) {
            pendingRemoteAcquires.delete(token);
            return;
          }
          await unlockRemote(token);
          return;
        }
      }
      if (!isCurrentRequest() || remoteToken !== token) {
        return;
      }
      pendingRemoteAcquires.delete(token);
      void options
        .notifyLockAcknowledged({
          token,
          windowLabel: owner,
          ok: true,
        })
        .catch(reportProtocolError);
    } catch (error) {
      if (!isCurrentRequest()) {
        pendingRemoteAcquires.delete(token);
        return;
      }
      const ownsToken = remoteToken === token;
      pendingRemoteAcquires.delete(token);
      if (ownsToken) {
        remoteToken = null;
        clearRemoteLeaseWatch();
        options.unlockLocal(token);
      }
      if (!ownsToken) {
        return;
      }
      try {
        await options.notifyLockAcknowledged({
          token,
          windowLabel: owner,
          ok: false,
          error: toError(error, "복원 잠금을 적용하지 못했습니다.").message,
        });
      } catch (ackError) {
        reportProtocolError(ackError);
      }
    }
  };

  const handleLockRequested = async (
    payload: RestoreLockRequest,
    generation: number,
    requestGeneration: number
  ) => {
    const isCurrentRequest = () =>
      isCurrentRemoteRequest(requestGeneration, generation);

    if (!isCurrentRequest()) {
      return;
    }
    let currentLease: RestoreLockLease | undefined;
    if (nativeLease) {
      let current: RestoreLockLease | null;
      try {
        current = await readNativeLease();
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        reportProtocolError(error);
        return;
      }
      if (!isCurrentRequest() || !current || current.token !== payload.token) {
        return;
      }
      currentLease = current;
    }

    if (localToken === payload.token || remoteToken === payload.token) {
      if (!isCurrentRequest()) {
        return;
      }
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel: owner,
        ok: true,
      });
      return;
    }

    if (!isCurrentRequest()) {
      return;
    }
    if (remoteToken && remoteToken !== payload.token) {
      await unlockRemote(remoteToken);
    }

    if (!isCurrentRequest()) {
      return;
    }

    if (localToken || remoteToken) {
      if (!isCurrentRequest()) {
        return;
      }
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel: owner,
        ok: false,
        error: "다른 복원 작업이 이미 진행 중입니다.",
      });
      return;
    }

    await acquireRemoteLock(
      payload.token,
      currentLease,
      generation,
      requestGeneration
    );
  };

  const handleLockAcknowledged = (payload: RestoreLockAcknowledgement) => {
    if (payload.ok) {
      settlePending(payload.token, payload.windowLabel);
      return;
    }
    settlePending(
      payload.token,
      payload.windowLabel,
      new Error(payload.error || "복원 잠금 승인을 받지 못했습니다.")
    );
  };

  const handleStoreApplyAcknowledged = (
    payload: RestoreStoreApplyAcknowledgement
  ) => {
    if (payload.ok) {
      settleStoreApplyPending(
        payload.token,
        payload.generation,
        payload.windowLabel
      );
      return;
    }
    settleStoreApplyPending(
      payload.token,
      payload.generation,
      payload.windowLabel,
      new Error(payload.error || "복원된 메모 상태 적용 승인을 받지 못했습니다.")
    );
  };

  const handleStoreApplyRequested = async (
    payload: RestoreStoreApplyRequest,
    generation: number
  ) => {
    if (!isCurrentLifecycle(generation) || remoteToken !== payload.token) {
      return;
    }
    if (payload.generation < remoteLatestApplyGeneration) {
      return;
    }
    remoteLatestApplyGeneration = payload.generation;
    if (remoteFinalApplyGeneration !== null) {
      remoteFinalApplyGeneration = Math.max(
        remoteFinalApplyGeneration,
        payload.generation
      );
    }

    try {
      await applyRemoteStoreForGeneration(payload.token, payload.generation);
      if (
        !isCurrentLifecycle(generation) ||
        remoteToken !== payload.token ||
        remoteLatestApplyGeneration !== payload.generation ||
        remoteAppliedGeneration !== payload.generation
      ) {
        return;
      }
      if (options.notifyStoreApplyAcknowledged) {
        await runWithTimeout(
          () =>
            options.notifyStoreApplyAcknowledged!({
              token: payload.token,
              generation: payload.generation,
              windowLabel: owner,
              ok: true,
            }),
          "복원된 메모 상태 적용 승인 공유가 시간 초과되었습니다."
        );
      }
    } catch (error) {
      if (
        !isCurrentLifecycle(generation) ||
        remoteToken !== payload.token ||
        remoteLatestApplyGeneration !== payload.generation
      ) {
        return;
      }
      const failure = toError(error, "복원된 메모 상태를 적용하지 못했습니다.");
      reportProtocolError(failure);
      if (options.notifyStoreApplyAcknowledged) {
        try {
          await runWithTimeout(
            () =>
              options.notifyStoreApplyAcknowledged!({
                token: payload.token,
                generation: payload.generation,
                windowLabel: owner,
                ok: false,
                error: failure.message,
              }),
            "복원된 메모 상태 적용 실패 공유가 시간 초과되었습니다."
          );
        } catch (ackError) {
          reportProtocolError(ackError);
        }
      }
    }
  };

  const handleLockReleased = async (
    payload: RestoreLockRelease,
    generation: number
  ) => {
    if (!isCurrentLifecycle(generation) || remoteToken !== payload.token) {
      return;
    }
    if (nativeLease) {
      let current: RestoreLockLease | null;
      try {
        current = await readNativeLease();
      } catch (error) {
        reportProtocolError(error);
        return;
      }
      if (!isCurrentLifecycle(generation) || remoteToken !== payload.token) {
        return;
      }
      if (current?.token === payload.token) {
        const releaseGeneration = payload.finalApplyGeneration;
        if (releaseGeneration !== undefined && options.applyStore) {
          remoteLatestApplyGeneration = Math.max(
            remoteLatestApplyGeneration,
            releaseGeneration
          );
          try {
            await applyRemoteStoreForGeneration(payload.token, releaseGeneration);
          } catch (error) {
            reportProtocolError(error);
          }
        }
        if (remoteToken === payload.token) {
          scheduleRemoteLeaseExpiry(
            payload.token,
            current.expiresAtMs,
            current.operationActive
          );
        }
        return;
      }
    }
    await unlockRemote(payload.token, payload.finalApplyGeneration);
  };

  const initializeRemoteLease = async (generation: number) => {
    if (!isCurrentLifecycle(generation) || !nativeLease || localToken || remoteToken) {
      return;
    }
    const requestGeneration = ++nextRemoteRequestGeneration;
    latestRemoteRequestGeneration = requestGeneration;
    const current = await readNativeLease();
    if (
      !isCurrentRemoteRequest(requestGeneration, generation) ||
      !current
    ) {
      return;
    }
    await acquireRemoteLock(
      current.token,
      current,
      generation,
      requestGeneration
    );
  };

  const callListenerCleanup = (cleanup: () => void) => {
    try {
      cleanup();
    } catch (error) {
      reportProtocolError(error);
    }
  };

  const registerListener = async (
    registration: () => Promise<() => void>,
    generation: number,
    label: string
  ): Promise<(() => void) | null> => {
    const registrationPromise = Promise.resolve().then(registration);
    try {
      const cleanup = await runWithTimeout(
        () => registrationPromise,
        `${label} listener 등록이 시간 초과되었습니다.`
      );
      if (!isCurrentLifecycle(generation)) {
        callListenerCleanup(cleanup);
        return null;
      }
      return cleanup;
    } catch (error) {
      void registrationPromise.then(callListenerCleanup, () => {});
      throw error;
    }
  };

  const start = async () => {
    if (stopping) {
      throw new Error("복원 잠금 coordinator가 종료되었습니다.");
    }
    const generation = lifecycleGeneration;
    if (!startPromise) {
      startPromise = Promise.resolve().then(async () => {
        const registeredCleanups: Array<() => void> = [];
        const disposeRegistered = () => {
          for (const cleanup of registeredCleanups.splice(0)) {
            callListenerCleanup(cleanup);
          }
        };

        try {
          if (!isCurrentLifecycle(generation)) {
            return;
          }
          const requestedCleanup = await registerListener(
            () =>
              options.listenLockRequested((payload) => {
                if (!isCurrentLifecycle(generation)) {
                  return;
                }
                const requestGeneration = ++nextRemoteRequestGeneration;
                latestRemoteRequestGeneration = requestGeneration;
                void handleLockRequested(
                  payload,
                  generation,
                  requestGeneration
                ).catch(reportProtocolError);
              }),
            generation,
            "복원 잠금 요청"
          );
          if (!requestedCleanup) {
            return;
          }
          registeredCleanups.push(requestedCleanup);

          const acknowledgedCleanup = await registerListener(
            () =>
              options.listenLockAcknowledged((payload) => {
                if (isCurrentLifecycle(generation)) {
                  handleLockAcknowledged(payload);
                }
              }),
            generation,
            "복원 잠금 승인"
          );
          if (!acknowledgedCleanup) {
            disposeRegistered();
            return;
          }
          registeredCleanups.push(acknowledgedCleanup);

          const releasedCleanup = await registerListener(
            () =>
              options.listenLockReleased((payload) => {
                if (isCurrentLifecycle(generation)) {
                  return handleLockReleased(payload, generation);
                }
              }),
            generation,
            "복원 잠금 해제"
          );
          if (!releasedCleanup) {
            disposeRegistered();
            return;
          }
          registeredCleanups.push(releasedCleanup);

          if (options.listenStoreApplyRequested) {
            const storeApplyRequestedCleanup = await registerListener(
              () =>
                options.listenStoreApplyRequested!((payload) => {
                  if (isCurrentLifecycle(generation)) {
                    return handleStoreApplyRequested(payload, generation);
                  }
                }),
              generation,
              "복원 저장소 적용 요청"
            );
            if (!storeApplyRequestedCleanup) {
              disposeRegistered();
              return;
            }
            registeredCleanups.push(storeApplyRequestedCleanup);
          }

          if (options.listenStoreApplyAcknowledged) {
            const storeApplyAcknowledgedCleanup = await registerListener(
              () =>
                options.listenStoreApplyAcknowledged!((payload) => {
                  if (isCurrentLifecycle(generation)) {
                    handleStoreApplyAcknowledged(payload);
                  }
                }),
              generation,
              "복원 저장소 적용 승인"
            );
            if (!storeApplyAcknowledgedCleanup) {
              disposeRegistered();
              return;
            }
            registeredCleanups.push(storeApplyAcknowledgedCleanup);
          }

          await initializeRemoteLease(generation);
          if (!isCurrentLifecycle(generation)) {
            disposeRegistered();
            return;
          }
          cleanups.push(...registeredCleanups.splice(0));
        } catch (error) {
          disposeRegistered();
          throw error;
        }
      });
    }
    await startPromise;
  };

  const runBoundedCleanup = async (
    operation: () => Promise<unknown>,
    timeoutMessage: string
  ): Promise<Error | null> => {
    try {
      await runWithTimeout(operation, timeoutMessage, cleanupTimeoutMs);
      return null;
    } catch (error) {
      const failure = toError(error, timeoutMessage);
      reportProtocolError(failure);
      return failure;
    }
  };

  const waitForStartSettlement = async () => {
    const startup = startPromise;
    if (!startup) {
      return true;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), cleanupTimeoutMs);
    });
    try {
      const settled = await Promise.race([
        startup.then(
          () => true,
          (error) => {
            reportProtocolError(error);
            return true;
          }
        ),
        timeoutPromise,
      ]);
      if (!settled) {
        reportProtocolError(new Error("복원 잠금 초기화 종료 대기가 시간 초과되었습니다."));
      }
      return settled;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const waitForOperationSettlement = async () => {
    const queue = runQueue;
    const operation = activeOperation;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), cleanupTimeoutMs);
    });
    try {
      const settled = await Promise.race([
        Promise.all([
          queue.catch(() => {}),
          operation?.catch(() => {}) ?? Promise.resolve(),
        ]).then(() => true),
        timeoutPromise,
      ]);
      if (!settled) {
        reportProtocolError(
          new Error("활성 복원 작업 종료 대기가 시간 초과되었습니다.")
        );
      }
      return settled;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const broadcastRelease = (token: string, finalApplyGeneration: number) =>
    runBoundedCleanup(
      () => options.notifyLockReleased(token, finalApplyGeneration),
      "복원 잠금 해제 공유가 시간 초과되었습니다."
    );

  const isNativeLeaseGone = async (token: string) => {
    const current = await readNativeLease();
    return !current || current.token !== token || current.owner !== owner;
  };

  const finalizeLocalRelease = (token: string) => {
    if (localToken !== token) {
      return;
    }
    if (nativeCleanupRetryTimer && pendingLocalRecovery?.token === token) {
      clearTimeout(nativeCleanupRetryTimer);
      nativeCleanupRetryTimer = null;
    }
    pendingLocalRecovery = null;
    localToken = null;
    localOperationActivated = false;
    localExpectedWindowLabels = null;
    localFinalApplyGeneration = null;
    clearStoreApplyPending(token);
    if (activeLeaseFailureToken === token) {
      activeLeaseFailureToken = null;
      activeLeaseFailureGeneration = 0;
    }
    activeLeaseOwnershipFailure = null;
    activeLeaseFailureReject = null;
    options.unlockLocal(token);
  };

  const wrapNativeCleanupError = (error: unknown) =>
    new Error(`${NATIVE_CLEANUP_PENDING_MESSAGE} ${getErrorMessage(error)}`, {
      cause: error,
    });

  const attemptCancelAbandonedAcquire = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (recovery.nativeAcquireCancellationComplete) {
      return null;
    }
    if (!nativeLease?.cancelAcquire) {
      return wrapNativeCleanupError(
        new Error("복원 잠금 acquire 취소 bridge를 사용할 수 없습니다.")
      );
    }
    const error = await runBoundedCleanup(
      () => nativeLease.cancelAcquire!(recovery.token),
      "복원 잠금 acquire 취소 확인이 시간 초과되었습니다."
    );
    if (!error) {
      recovery.nativeAcquireCancellationComplete = true;
      recovery.nativeFinished = true;
      recovery.nativeComplete = true;
      recovery.postRemovalVerificationComplete = !options.applyStore;
    }
    return error ? wrapNativeCleanupError(error) : null;
  };

  const attemptFinishNativeLease = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (recovery.nativeFinished) {
      return null;
    }
    if (!nativeLease || !nativeLease.finish) {
      recovery.nativeFinished = true;
      return null;
    }
    try {
      const finished = await runWithTimeout(
        () => nativeLease.finish!(recovery.token, owner, cleanupLeaseTtlMs),
        "복원 잠금 lease 종료 전환이 시간 초과되었습니다."
      );
      if (
        finished.token !== recovery.token ||
        finished.owner !== owner ||
        finished.operationActive
      ) {
        throw new Error("복원 잠금 lease 종료 상태 확인에 실패했습니다.");
      }
      recovery.nativeFinished = true;
      return null;
    } catch (error) {
      try {
        if (await isNativeLeaseGone(recovery.token)) {
          recovery.nativeFinished = true;
          recovery.nativeComplete = true;
          recovery.applyComplete = true;
          recovery.postRemovalVerificationComplete = !options.applyStore;
          return null;
        }
      } catch (lookupError) {
        return wrapNativeCleanupError(
          aggregateErrors("복원 잠금 lease 종료와 확인에 실패했습니다", [
            error,
            lookupError,
          ])
        );
      }
      return wrapNativeCleanupError(error);
    }
  };

  const attemptFinalLocalApply = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (recovery.applyComplete || !options.applyStore) {
      recovery.applyComplete = true;
      return null;
    }
    const error = await runBoundedCleanup(
      async () => {
        recovery.finalApplyGeneration = await synchronize(recovery.token);
      },
      "최종 복원 메모 상태 적용이 시간 초과되었습니다."
    );
    if (!error) {
      recovery.applyComplete = true;
    } else if (localFinalApplyGeneration !== null) {
      recovery.finalApplyGeneration = localFinalApplyGeneration;
    }
    return error;
  };

  const attemptReleaseNotification = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (
      recovery.notificationComplete ||
      recovery.notificationBypassedAfterNativeAbsence
    ) {
      return null;
    }
    const error = await broadcastRelease(
      recovery.token,
      recovery.finalApplyGeneration
    );
    if (!error) {
      recovery.notificationComplete = true;
      recovery.notificationError = null;
    } else {
      recovery.notificationError = error;
    }
    return error;
  };

  const attemptConfirmNativeAbsenceAfterNotificationFailure = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (
      !recovery.notificationError ||
      recovery.notificationComplete ||
      recovery.notificationBypassedAfterNativeAbsence ||
      !nativeLease
    ) {
      return null;
    }
    try {
      if (recovery.nativeComplete || (await isNativeLeaseGone(recovery.token))) {
        recovery.nativeFinished = true;
        recovery.nativeComplete = true;
        recovery.notificationBypassedAfterNativeAbsence = true;
        recovery.postRemovalVerificationComplete = !options.applyStore;
      }
      return null;
    } catch (error) {
      return wrapNativeCleanupError(
        new Error(
          `복원 잠금 해제 공유 실패 후 native lease 확인에 실패했습니다. ${getErrorMessage(error)}`,
          { cause: error }
        )
      );
    }
  };

  const attemptRemoveNativeLease = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (recovery.nativeComplete) {
      return null;
    }
    if (!nativeLease) {
      recovery.nativeComplete = true;
      return null;
    }
    try {
      const released = await runWithTimeout(
        () => nativeLease.release(recovery.token, owner),
        "복원 잠금 lease 해제가 시간 초과되었습니다."
      );
      if (released) {
        recovery.nativeComplete = true;
        recovery.postRemovalVerificationComplete = !options.applyStore;
        return null;
      }
      if (await isNativeLeaseGone(recovery.token)) {
        recovery.nativeComplete = true;
        recovery.postRemovalVerificationComplete = !options.applyStore;
        return null;
      }
      return wrapNativeCleanupError(
        new Error("복원 잠금 native lease가 정리되지 않았습니다.")
      );
    } catch (error) {
      try {
        if (await isNativeLeaseGone(recovery.token)) {
          recovery.nativeComplete = true;
          recovery.postRemovalVerificationComplete = !options.applyStore;
          return null;
        }
      } catch (lookupError) {
        return wrapNativeCleanupError(
          aggregateErrors("복원 잠금 lease 해제와 확인에 실패했습니다", [
            error,
            lookupError,
          ])
        );
      }
      return wrapNativeCleanupError(error);
    }
  };

  const attemptPostRemovalVerification = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    if (recovery.postRemovalVerificationComplete || !options.applyStore) {
      recovery.postRemovalVerificationComplete = true;
      return null;
    }
    const generation = ++nextStoreApplyGeneration;
    localFinalApplyGeneration = generation;
    recovery.finalApplyGeneration = generation;
    const error = await runBoundedCleanup(
      () => options.applyStore!({ token: recovery.token, generation }),
      "native lease 제거 후 최종 메모 상태 적용이 시간 초과되었습니다."
    );
    if (!error) {
      recovery.postRemovalVerificationComplete = true;
    }
    return error;
  };

  const isRecoveryComplete = (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) =>
    recovery.nativeAcquireCancellationComplete &&
    recovery.nativeFinished &&
    recovery.applyComplete &&
    (recovery.notificationComplete ||
      recovery.notificationBypassedAfterNativeAbsence) &&
    recovery.nativeComplete &&
    recovery.postRemovalVerificationComplete;

  const attemptRecoveryCleanup = async (
    recovery: NonNullable<typeof pendingLocalRecovery>
  ) => {
    const errors: unknown[] = [];
    const cancellationError = await attemptCancelAbandonedAcquire(recovery);
    if (cancellationError) {
      errors.push(cancellationError);
      return errors;
    }
    const finishError = await attemptFinishNativeLease(recovery);
    if (finishError) {
      errors.push(finishError);
      return errors;
    }
    const applyError = await attemptFinalLocalApply(recovery);
    if (applyError) {
      errors.push(applyError);
      return errors;
    }
    const notificationError = await attemptReleaseNotification(recovery);
    if (notificationError) {
      errors.push(notificationError);
      const lookupError =
        await attemptConfirmNativeAbsenceAfterNotificationFailure(recovery);
      if (lookupError) {
        errors.push(lookupError);
      }
      if (!recovery.notificationBypassedAfterNativeAbsence) {
        return errors;
      }
    }
    if (!recovery.notificationBypassedAfterNativeAbsence) {
      const nativeError = await attemptRemoveNativeLease(recovery);
      if (nativeError) {
        errors.push(nativeError);
        return errors;
      }
    }
    const verificationError = await attemptPostRemovalVerification(recovery);
    if (verificationError) {
      errors.push(verificationError);
    }
    return errors;
  };

  const scheduleNativeCleanupRetry = (token: string) => {
    const recovery = pendingLocalRecovery;
    if (!recovery || recovery.token !== token || stopping) {
      return;
    }
    if (nativeCleanupRetryTimer || nativeCleanupInFlight) {
      return;
    }
    const retryLifecycleGeneration = lifecycleGeneration;
    const retryDelay = Math.min(
      cleanupRetryIntervalMs * 2 ** Math.min(recovery.retryAttempt, 3),
      cleanupRetryIntervalMs * 8
    );
    recovery.retryAttempt += 1;
    nativeCleanupRetryTimer = setTimeout(() => {
      nativeCleanupRetryTimer = null;
      if (
        stopping ||
        lifecycleGeneration !== retryLifecycleGeneration ||
        pendingLocalRecovery !== recovery ||
        localToken !== token
      ) {
        return;
      }
      nativeCleanupInFlight = (async () => {
        const retryErrors = await attemptRecoveryCleanup(recovery);
        for (const error of retryErrors) {
          reportProtocolError(error);
        }
        if (
          isRecoveryComplete(recovery) &&
          pendingLocalRecovery === recovery &&
          localToken === token &&
          !stopping
        ) {
          finalizeLocalRelease(token);
        }
      })();
      void nativeCleanupInFlight
        .catch(reportProtocolError)
        .finally(() => {
          nativeCleanupInFlight = null;
          if (
            pendingLocalRecovery === recovery &&
            localToken === token &&
            !stopping
          ) {
            scheduleNativeCleanupRetry(token);
          }
        });
    }, retryDelay);
  };

  const waitForNotificationAndAcknowledgements = async (
    token: string,
    acknowledgementPromise: Promise<void>
  ) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("복원 잠금 승인을 기다리는 시간이 초과되었습니다."));
      }, options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        Promise.all([
          Promise.resolve().then(() => options.notifyLockRequested(token)),
          acknowledgementPromise,
        ]),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const synchronize = async (token: string) => {
    if (localToken !== token) {
      throw new Error("복원 잠금 token이 현재 작업과 일치하지 않습니다.");
    }
    const expectedWindowLabels = new Set(
      localExpectedWindowLabels ?? [owner]
    );
    expectedWindowLabels.add(owner);
    const generation = ++nextStoreApplyGeneration;
    localFinalApplyGeneration = generation;
    if (
      expectedWindowLabels.size > 1 &&
      (!options.notifyStoreApplyRequested ||
        !options.listenStoreApplyAcknowledged)
    ) {
      throw new Error("복원된 메모 상태 적용 공유를 초기화하지 못했습니다.");
    }

    let resolvePending!: () => void;
    let rejectPending!: (error: unknown) => void;
    const acknowledgementPromise = new Promise<void>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    pendingStoreApplyAcknowledgements.set(token, {
      generation,
      expectedWindowLabels,
      acknowledgedWindowLabels: new Set(),
      resolve: resolvePending,
      reject: rejectPending,
    });

    const localApply = options.applyStore
      ? runWithTimeout(
          () => options.applyStore!({ token, generation }),
          "복원된 메모 상태의 로컬 적용이 시간 초과되었습니다."
        )
      : Promise.resolve();
    void localApply.then(
      () => settleStoreApplyPending(token, generation, owner),
      (error) => settleStoreApplyPending(token, generation, owner, error)
    );

    try {
      await runWithTimeout(
        () =>
          Promise.all([
            options.notifyStoreApplyRequested?.({ token, generation }) ??
              Promise.resolve(),
            acknowledgementPromise,
          ]).then(() => undefined),
        "복원된 메모 상태 적용 승인을 기다리는 시간이 초과되었습니다.",
        options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS
      );
    } finally {
      clearStoreApplyPending(token);
    }
    return generation;
  };

  const acquire = async () => {
    await start();
    if (stopping) {
      throw new Error("복원 잠금 coordinator가 종료되었습니다.");
    }
    if (localToken || remoteToken) {
      throw new Error("다른 복원 작업이 이미 진행 중입니다.");
    }

    const token = createToken();
    const generation = ++nextOperationGeneration;
    localToken = token;
    localOperationGeneration = generation;
    localOperationActivated = false;
    localFinalApplyGeneration = null;
    activeLeaseOwnershipFailure = null;
    pendingLocalRecovery = null;
    activeLeaseFailureToken = token;
    activeLeaseFailureGeneration = generation;
    let nativeAcquireConfirmed = !nativeLease;
    let pending = false;

    try {
      // lockLocal synchronously flips the caller's persistence barrier before its queue drain.
      const localDrain = options.lockLocal(token);
      void Promise.resolve(localDrain).catch(() => {});
      if (nativeLease) {
        const nativeAcquirePromise = nativeLease.acquire(token, owner, leaseTtlMs);
        // Late settlement is owned by the native cancellation tombstone, never coordinator state.
        void nativeAcquirePromise.then(
          () => {},
          () => {}
        );
        const acquired = await runWithTimeout(
          () => nativeAcquirePromise,
          "복원 잠금 lease 획득이 시간 초과되었습니다."
        );
        if (acquired.token !== token || acquired.owner !== owner) {
          throw new Error("복원 잠금 lease 소유자 확인에 실패했습니다.");
        }
        nativeAcquireConfirmed = true;
        startLeaseRenewal(token, generation);
      }

      const liveWindowLabels = await runWithTimeout(
        options.listLiveWindowLabels,
        "활성 메모 창 조회가 시간 초과되었습니다."
      );
      const expectedWindowLabels = new Set(liveWindowLabels);
      expectedWindowLabels.add(owner);
      localExpectedWindowLabels = new Set(expectedWindowLabels);

      let resolvePending!: () => void;
      let rejectPending!: (error: unknown) => void;
      const acknowledgementPromise = new Promise<void>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      pendingAcknowledgements.set(token, {
        expectedWindowLabels,
        acknowledgedWindowLabels: new Set(),
        resolve: resolvePending,
        reject: rejectPending,
      });
      pending = true;

      void Promise.resolve(localDrain).then(
        () => settlePending(token, owner),
        (error) => settlePending(token, owner, error)
      );

      await waitForNotificationAndAcknowledgements(token, acknowledgementPromise);
      clearPending(token);
      pending = false;
      return token;
    } catch (error) {
      if (pending) {
        clearPending(token);
      }
      clearLeaseRenewal();
      const failedAcquireGeneration = ++nextStoreApplyGeneration;
      localFinalApplyGeneration = failedAcquireGeneration;
      const recovery = {
        token,
        finalApplyGeneration: failedAcquireGeneration,
        nativeAcquireCancellationComplete: nativeAcquireConfirmed,
        nativeFinished: !nativeLease?.finish,
        applyComplete: true,
        notificationComplete: false,
        notificationBypassedAfterNativeAbsence: false,
        notificationError: null,
        nativeComplete: !nativeLease,
        postRemovalVerificationComplete: !options.applyStore,
        retryAttempt: 0,
      };
      pendingLocalRecovery = recovery;
      const cleanupErrors = await attemptRecoveryCleanup(recovery);
      for (const cleanupError of cleanupErrors) {
        reportProtocolError(cleanupError);
      }
      const acquireFailure =
        cleanupErrors.length > 0
          ? aggregateErrors(
              "복원 잠금 획득 실패와 정리 실패가 함께 발생했습니다",
              [error, ...cleanupErrors]
            )
          : error;
      if (!isRecoveryComplete(recovery)) {
        scheduleNativeCleanupRetry(token);
        throw acquireFailure;
      }
      finalizeLocalRelease(token);
      throw acquireFailure;
    }
  };

  const release = async (token: string) => {
    if (localToken !== token) {
      return;
    }

    clearPending(token);
    clearLeaseRenewal();
    const finalApplyGeneration =
      localFinalApplyGeneration ?? ++nextStoreApplyGeneration;
    localFinalApplyGeneration = finalApplyGeneration;
    const recovery =
      pendingLocalRecovery?.token === token
        ? pendingLocalRecovery
        : {
            token,
            finalApplyGeneration,
            nativeAcquireCancellationComplete: true,
            nativeFinished: !nativeLease || !nativeLease.finish,
            applyComplete: !options.applyStore,
            notificationComplete: false,
            notificationBypassedAfterNativeAbsence: false,
            notificationError: null,
            nativeComplete: !nativeLease,
            postRemovalVerificationComplete: !nativeLease || !options.applyStore,
            retryAttempt: 0,
          };
    pendingLocalRecovery = recovery;
    const cleanupErrors = await attemptRecoveryCleanup(recovery);
    for (const error of cleanupErrors) {
      reportProtocolError(error);
    }
    if (!isRecoveryComplete(recovery)) {
      scheduleNativeCleanupRetry(token);
      throw aggregateErrors("복원 잠금 정리에 실패했습니다", cleanupErrors);
    }
    finalizeLocalRelease(token);
    if (cleanupErrors.length > 0) {
      throw aggregateErrors("복원 잠금 정리에 실패했습니다", cleanupErrors);
    }
  };

  const activateNativeLease = async (token: string) => {
    if (!nativeLease) {
      return;
    }

    const activated = await runWithTimeout(
      () => nativeLease.activate(token, owner),
      "복원 잠금 operation lease 활성화가 시간 초과되었습니다."
    );
    if (
      activated.token !== token ||
      activated.owner !== owner ||
      !activated.operationActive
    ) {
      throw new Error("복원 잠금 operation lease 활성화에 실패했습니다.");
    }
  };

  const beginRun = async <T,>(
    operation: (token: string, assertActive: () => void) => Promise<T>
  ) => {
    await start();
    if (stopping) {
      throw new Error("복원 잠금 coordinator가 종료되었습니다.");
    }
    if (localToken && activeOperation) {
      await activeOperation.catch(() => {});
    }
    if (stopping) {
      throw new Error("복원 잠금 coordinator가 종료되었습니다.");
    }
    if (remoteToken) {
      throw new Error("다른 복원 작업이 이미 진행 중입니다.");
    }

    let leaseFailure: Error | null = null;
    const recordLeaseFailure = (error: unknown) => {
      leaseFailure ??= toError(error, "복원 잠금 lease 갱신에 실패했습니다.");
    };
    activeLeaseFailureReject = recordLeaseFailure;

    let token: string | null = null;
    const completion = (async () => {
      let value: T | undefined;
      let primaryError: unknown = null;
      try {
        token = await acquire();
        const operationGeneration = localOperationGeneration;
        await activateNativeLease(token);
        if (isCurrentLocalOperation(token, operationGeneration)) {
          localOperationActivated = true;
        }
        const assertActive = () =>
          assertLeaseOwnership(token!, operationGeneration);
        assertActive();
        value = await operation(token, assertActive);
        assertActive();
      } catch (error) {
        primaryError = error;
      }

      let cleanupError: unknown = null;
      if (token) {
        try {
          await release(token);
        } catch (error) {
          cleanupError = error;
        }
      } else if (activeLeaseFailureReject === recordLeaseFailure) {
        activeLeaseFailureToken = null;
        activeLeaseFailureGeneration = 0;
        activeLeaseFailureReject = null;
      }

      if (primaryError && cleanupError) {
        throw aggregateErrors(
          "복원 작업과 잠금 정리에 모두 실패했습니다",
          [primaryError, cleanupError]
        );
      }
      if (primaryError) {
        throw primaryError;
      }
      if (cleanupError) {
        throw cleanupError;
      }
      return value as T;
    })();
    activeOperation = completion;
    void completion.then(
      () => {
        if (activeOperation === completion) {
          activeOperation = null;
        }
      },
      () => {
        if (activeOperation === completion) {
          activeOperation = null;
        }
      }
    );
    void completion.catch(() => {});

    const result = completion.then(
      (value) => {
        if (leaseFailure) {
          throw new Error(
            `복원 작업은 완료되었지만 잠금 lease 갱신에 실패했습니다: ${leaseFailure.message}`,
            { cause: leaseFailure }
          );
        }
        return value;
      },
      (error) => {
        if (leaseFailure) {
          throw aggregateErrors(
            "복원 작업 실패와 잠금 lease 갱신 실패가 함께 발생했습니다",
            [error, leaseFailure]
          );
        }
        throw error;
      }
    );

    return {
      result,
      completion,
    };
  };

  const run = <T,>(
    operation: (token: string, assertActive: () => void) => Promise<T>
  ): Promise<T> => {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const previousRun = runQueue;
    const lifecycle = previousRun.then(async () => {
      try {
        const started = await beginRun(operation);
        started.result.then(resolveResult, rejectResult);
        await started.completion.catch(() => {});
      } catch (error) {
        rejectResult(error);
      }
    });
    runQueue = lifecycle.catch(() => {});
    return result;
  };

  const stop = async () => {
    if (stopPromise) {
      return stopPromise;
    }

    stopping = true;
    lifecycleGeneration += 1;
    if (localToken) {
      const stopFailure = new Error(
        "복원 잠금 coordinator가 종료되어 작업을 계속할 수 없습니다."
      );
      activeLeaseOwnershipFailure = stopFailure;
      if (
        activeLeaseFailureToken === localToken &&
        activeLeaseFailureGeneration === localOperationGeneration
      ) {
        activeLeaseFailureReject?.(stopFailure);
      }
    }
    clearLeaseRenewal();
    if (nativeCleanupRetryTimer) {
      clearTimeout(nativeCleanupRetryTimer);
      nativeCleanupRetryTimer = null;
    }
    clearRemoteLeaseWatch();
    const remoteTokenAtStop = remoteToken;
    stopPromise = (async () => {
      if (remoteTokenAtStop) {
        await unlockRemote(remoteTokenAtStop);
      }
      const startupSettled = await waitForStartSettlement();
      const operationsSettled = startupSettled
        ? await waitForOperationSettlement()
        : false;
      if (operationsSettled && localToken) {
        const token = localToken;
        await release(token).catch(reportProtocolError);
      }
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    })();

    return stopPromise;
  };

  return {
    start,
    acquire,
    release,
    synchronize,
    run,
    stop,
  };
}
