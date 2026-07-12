import { invoke } from "@tauri-apps/api/core";

export type RestoreLockRequest = {
  token: string;
};

export type RestoreLockAcknowledgement = {
  token: string;
  windowLabel: string;
  ok: boolean;
  error?: string;
};

export type RestoreLockLease = {
  token: string;
  owner: string;
  expiresAtMs: number;
  operationActive: boolean;
};

export type RestoreLockLeaseAdapter = {
  acquire: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
  current: () => Promise<RestoreLockLease | null>;
  renew: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
  activate: (token: string, owner: string) => Promise<RestoreLockLease>;
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
  notifyLockReleased: (token: string) => Promise<void>;
  listenLockReleased: (
    handler: (payload: RestoreLockRequest) => void
  ) => Promise<() => void>;
  nativeLease?: RestoreLockLeaseAdapter;
  lockLocal: (token: string) => Promise<void>;
  unlockLocal: (token: string) => void;
  timeoutMs?: number;
  leaseTtlMs?: number;
  leaseRenewIntervalMs?: number;
  leasePollIntervalMs?: number;
  cleanupTimeoutMs?: number;
  onProtocolError?: (error: unknown) => void;
};

type PendingAcknowledgements = {
  expectedWindowLabels: Set<string>;
  acknowledgedWindowLabels: Set<string>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const DEFAULT_ACK_TIMEOUT_MS = 5000;
const DEFAULT_LEASE_TTL_MS = 10000;
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 2000;
const DEFAULT_LEASE_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1000;

export function createTauriRestoreLockLeaseAdapter(): RestoreLockLeaseAdapter {
  return {
    acquire: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("acquire_restore_lock_lease", { token, owner, ttlMs }),
    current: () => invoke<RestoreLockLease | null>("current_restore_lock_lease"),
    renew: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("renew_restore_lock_lease", { token, owner, ttlMs }),
    activate: (token, owner) =>
      invoke<RestoreLockLease>("activate_restore_lock_lease", { token, owner }),
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

export function createRestoreLockCoordinator(options: RestoreLockCoordinatorOptions) {
  const pendingAcknowledgements = new Map<string, PendingAcknowledgements>();
  const pendingRemoteAcquires = new Map<string, () => void>();
  const cleanups: Array<() => void> = [];
  const nativeLease = options.nativeLease;
  const owner = options.getCurrentWindowLabel();
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewIntervalMs =
    options.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
  const leasePollIntervalMs = options.leasePollIntervalMs ?? DEFAULT_LEASE_POLL_INTERVAL_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  let startPromise: Promise<void> | null = null;
  let localToken: string | null = null;
  let nextOperationGeneration = 0;
  let localOperationGeneration = 0;
  let remoteToken: string | null = null;
  let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  let leaseRenewalToken: string | null = null;
  let leaseRenewalGeneration = 0;
  let remoteLeasePollTimer: ReturnType<typeof setInterval> | null = null;
  let remoteLeaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeLeaseFailureReject: ((error: unknown) => void) | null = null;
  let activeLeaseFailureToken: string | null = null;
  let activeLeaseFailureGeneration = 0;
  let activeOperation: Promise<unknown> | null = null;
  let runQueue: Promise<void> = Promise.resolve();
  let stopping = false;
  let lifecycleGeneration = 0;
  let nextRemoteRequestGeneration = 0;
  let latestRemoteRequestGeneration = 0;
  let stopPromise: Promise<void> | null = null;

  const reportProtocolError = (error: unknown) => {
    options.onProtocolError?.(error);
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

  const clearPending = (token: string) => {
    pendingAcknowledgements.delete(token);
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

  const unlockRemote = (token: string) => {
    if (remoteToken !== token) {
      return;
    }
    remoteToken = null;
    clearRemoteLeaseWatch();
    const resolveAcquire = pendingRemoteAcquires.get(token);
    pendingRemoteAcquires.delete(token);
    resolveAcquire?.();
    options.unlockLocal(token);
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
      void nativeLease
        .renew(tickToken, owner, leaseTtlMs)
        .then((renewed) => {
          if (
            !isCurrentLocalOperation(tickToken, tickGeneration) ||
            leaseRenewalToken !== tickToken ||
            leaseRenewalGeneration !== tickGeneration
          ) {
            return;
          }
          if (renewed.token !== tickToken || renewed.owner !== owner) {
            throw new Error("복원 잠금 lease 갱신 소유자 확인에 실패했습니다.");
          }
        })
        .catch((error) => {
          if (
            !isCurrentLocalOperation(tickToken, tickGeneration) ||
            leaseRenewalToken !== tickToken ||
            leaseRenewalGeneration !== tickGeneration
          ) {
            return;
          }
          clearLeaseRenewal(tickToken, tickGeneration);
          const failure = toError(error, "복원 잠금 lease 갱신에 실패했습니다.");
          reportProtocolError(failure);
          if (
            activeLeaseFailureToken === tickToken &&
            activeLeaseFailureGeneration === tickGeneration
          ) {
            activeLeaseFailureReject?.(failure);
          }
        });
    }, leaseRenewIntervalMs);
  };

  const checkRemoteLease = async (token: string) => {
    if (!nativeLease || remoteToken !== token) {
      return;
    }

    try {
      const current = await nativeLease.current();
      if (remoteToken !== token) {
        return;
      }
      if (!current || current.token !== token) {
        unlockRemote(token);
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
        const current = await nativeLease.current();
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
          unlockRemote(token);
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
        current = await nativeLease.current();
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
      unlockRemote(remoteToken);
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

  const handleLockReleased = (payload: RestoreLockRequest, generation: number) => {
    if (!isCurrentLifecycle(generation)) {
      return;
    }
    unlockRemote(payload.token);
  };

  const initializeRemoteLease = async (generation: number) => {
    if (!isCurrentLifecycle(generation) || !nativeLease || localToken || remoteToken) {
      return;
    }
    const requestGeneration = ++nextRemoteRequestGeneration;
    latestRemoteRequestGeneration = requestGeneration;
    const current = await nativeLease.current();
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
            cleanup();
          }
        };

        if (!isCurrentLifecycle(generation)) {
          return;
        }
        const requestedCleanup = await options.listenLockRequested((payload) => {
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
        });
        if (!isCurrentLifecycle(generation)) {
          requestedCleanup();
          return;
        }
        registeredCleanups.push(requestedCleanup);

        const acknowledgedCleanup = await options.listenLockAcknowledged((payload) => {
          if (isCurrentLifecycle(generation)) {
            handleLockAcknowledged(payload);
          }
        });
        if (!isCurrentLifecycle(generation)) {
          acknowledgedCleanup();
          disposeRegistered();
          return;
        }
        registeredCleanups.push(acknowledgedCleanup);

        const releasedCleanup = await options.listenLockReleased((payload) => {
          if (isCurrentLifecycle(generation)) {
            handleLockReleased(payload, generation);
          }
        });
        if (!isCurrentLifecycle(generation)) {
          releasedCleanup();
          disposeRegistered();
          return;
        }
        registeredCleanups.push(releasedCleanup);
        cleanups.push(...registeredCleanups.splice(0));
        await initializeRemoteLease(generation);
      });
    }
    await startPromise;
  };

  const runBoundedCleanup = async (
    operation: () => Promise<unknown>,
    timeoutMessage: string
  ) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), cleanupTimeoutMs);
    });

    try {
      await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
    } catch (error) {
      reportProtocolError(error);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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

  const broadcastRelease = async (token: string) => {
    await runBoundedCleanup(
      () => options.notifyLockReleased(token),
      "복원 잠금 해제 공유가 시간 초과되었습니다."
    );
  };

  const releaseNativeLease = async (token: string) => {
    if (!nativeLease) {
      return;
    }
    await runBoundedCleanup(
      () => nativeLease.release(token, owner),
      "복원 잠금 lease 해제가 시간 초과되었습니다."
    );
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
    activeLeaseFailureToken = token;
    activeLeaseFailureGeneration = generation;
    let pending = false;
    let nativeLeaseAcquired = false;

    try {
      // lockLocal synchronously flips the caller's persistence barrier before its queue drain.
      const localDrain = options.lockLocal(token);
      if (nativeLease) {
        const acquired = await nativeLease.acquire(token, owner, leaseTtlMs);
        if (acquired.token !== token || acquired.owner !== owner) {
          throw new Error("복원 잠금 lease 소유자 확인에 실패했습니다.");
        }
        nativeLeaseAcquired = true;
        startLeaseRenewal(token, generation);
      }

      const liveWindowLabels = await options.listLiveWindowLabels();
      const expectedWindowLabels = new Set(liveWindowLabels);
      expectedWindowLabels.add(owner);

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
      if (nativeLeaseAcquired) {
        await releaseNativeLease(token);
      }
      await broadcastRelease(token);
      localToken = null;
      if (activeLeaseFailureToken === token && activeLeaseFailureGeneration === generation) {
        activeLeaseFailureToken = null;
        activeLeaseFailureGeneration = 0;
      }
      options.unlockLocal(token);
      throw error;
    }
  };

  const release = async (token: string) => {
    if (localToken !== token) {
      return;
    }

    try {
      clearPending(token);
      clearLeaseRenewal();
      await releaseNativeLease(token);
      await broadcastRelease(token);
    } finally {
      localToken = null;
      if (activeLeaseFailureToken === token) {
        activeLeaseFailureToken = null;
        activeLeaseFailureGeneration = 0;
      }
      activeLeaseFailureReject = null;
      options.unlockLocal(token);
    }
  };

  const activateNativeLease = async (token: string) => {
    if (!nativeLease) {
      return;
    }

    const activated = await nativeLease.activate(token, owner);
    if (
      activated.token !== token ||
      activated.owner !== owner ||
      !activated.operationActive
    ) {
      throw new Error("복원 잠금 operation lease 활성화에 실패했습니다.");
    }
  };

  const beginRun = async <T,>(operation: (token: string) => Promise<T>) => {
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

    let rejectLeaseFailure!: (error: unknown) => void;
    const leaseFailure = new Promise<never>((_, reject) => {
      rejectLeaseFailure = reject;
    });
    activeLeaseFailureReject = rejectLeaseFailure;

    let token: string | null = null;
    const completion = (async () => {
      try {
        token = await acquire();
        await activateNativeLease(token);
        return await operation(token);
      } finally {
        if (token) {
          await release(token);
        } else if (activeLeaseFailureReject === rejectLeaseFailure) {
          activeLeaseFailureToken = null;
          activeLeaseFailureGeneration = 0;
          activeLeaseFailureReject = null;
        }
      }
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

    return {
      result: Promise.race([completion, leaseFailure]),
      completion,
    };
  };

  const run = <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
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
    if (remoteToken) {
      const token = remoteToken;
      unlockRemote(token);
    }
    stopPromise = (async () => {
      const startupSettled = await waitForStartSettlement();
      if (startupSettled) {
        await runQueue.catch(() => {});
      }
      await activeOperation?.catch(() => {});
      if (localToken) {
        const token = localToken;
        await release(token);
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
    run,
    stop,
  };
}
