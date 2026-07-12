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
};

export type RestoreLockLeaseAdapter = {
  acquire: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
  current: () => Promise<RestoreLockLease | null>;
  renew: (token: string, owner: string, ttlMs: number) => Promise<RestoreLockLease>;
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

export function createTauriRestoreLockLeaseAdapter(): RestoreLockLeaseAdapter {
  return {
    acquire: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("acquire_restore_lock_lease", { token, owner, ttlMs }),
    current: () => invoke<RestoreLockLease | null>("current_restore_lock_lease"),
    renew: (token, owner, ttlMs) =>
      invoke<RestoreLockLease>("renew_restore_lock_lease", { token, owner, ttlMs }),
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
  const cleanups: Array<() => void> = [];
  const nativeLease = options.nativeLease;
  const owner = options.getCurrentWindowLabel();
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewIntervalMs =
    options.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
  const leasePollIntervalMs = options.leasePollIntervalMs ?? DEFAULT_LEASE_POLL_INTERVAL_MS;
  let startPromise: Promise<void> | null = null;
  let localToken: string | null = null;
  let remoteToken: string | null = null;
  let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  let remoteLeasePollTimer: ReturnType<typeof setInterval> | null = null;
  let remoteLeaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  const reportProtocolError = (error: unknown) => {
    options.onProtocolError?.(error);
  };

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

  const clearLeaseRenewal = () => {
    if (leaseRenewTimer) {
      clearInterval(leaseRenewTimer);
      leaseRenewTimer = null;
    }
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
    options.unlockLocal(token);
  };

  const startLeaseRenewal = (token: string) => {
    if (!nativeLease || leaseRenewTimer) {
      return;
    }
    leaseRenewTimer = setInterval(() => {
      void nativeLease.renew(token, owner, leaseTtlMs).catch((error) => {
        reportProtocolError(error);
      });
    }, leaseRenewIntervalMs);
  };

  const checkRemoteLease = async (token: string) => {
    if (!nativeLease || remoteToken !== token) {
      return;
    }

    try {
      const current = await nativeLease.current();
      if (!current || current.token !== token) {
        unlockRemote(token);
      } else {
        scheduleRemoteLeaseExpiry(token, current.expiresAtMs);
      }
    } catch (error) {
      reportProtocolError(error);
    }
  };

  const scheduleRemoteLeaseExpiry = (token: string, expiresAtMs = Date.now() + leaseTtlMs) => {
    if (remoteLeaseExpiryTimer) {
      clearTimeout(remoteLeaseExpiryTimer);
    }
    const remainingMs = Math.max(leasePollIntervalMs, expiresAtMs - Date.now());
    remoteLeaseExpiryTimer = setTimeout(() => {
      if (remoteToken === token) {
        reportProtocolError(new Error("복원 잠금 lease가 만료되었습니다."));
        unlockRemote(token);
      }
    }, remainingMs + leasePollIntervalMs);
  };

  const startRemoteLeaseWatch = (token: string, expiresAtMs?: number) => {
    if (!nativeLease) {
      return;
    }
    clearRemoteLeaseWatch();
    remoteLeasePollTimer = setInterval(() => {
      void checkRemoteLease(token);
    }, leasePollIntervalMs);
    scheduleRemoteLeaseExpiry(token, expiresAtMs);
  };

  const acquireRemoteLock = async (token: string, lease?: RestoreLockLease) => {
    remoteToken = token;
    startRemoteLeaseWatch(token, lease?.expiresAtMs);
    try {
      await options.lockLocal(token);
      if (remoteToken !== token) {
        return;
      }
      void options
        .notifyLockAcknowledged({
          token,
          windowLabel: owner,
          ok: true,
        })
        .catch(reportProtocolError);
    } catch (error) {
      if (remoteToken === token) {
        remoteToken = null;
        clearRemoteLeaseWatch();
        options.unlockLocal(token);
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

  const handleLockRequested = async (payload: RestoreLockRequest) => {
    let currentLease: RestoreLockLease | undefined;
    if (nativeLease) {
      let current: RestoreLockLease | null;
      try {
        current = await nativeLease.current();
      } catch (error) {
        reportProtocolError(error);
        return;
      }
      if (!current || current.token !== payload.token) {
        return;
      }
      currentLease = current;
    }

    if (localToken === payload.token || remoteToken === payload.token) {
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel: owner,
        ok: true,
      });
      return;
    }

    if (localToken || remoteToken) {
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel: owner,
        ok: false,
        error: "다른 복원 작업이 이미 진행 중입니다.",
      });
      return;
    }

    await acquireRemoteLock(payload.token, currentLease);
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

  const handleLockReleased = (payload: RestoreLockRequest) => {
    unlockRemote(payload.token);
  };

  const initializeRemoteLease = async () => {
    if (!nativeLease || localToken || remoteToken) {
      return;
    }
    const current = await nativeLease.current();
    if (!current) {
      return;
    }
    await acquireRemoteLock(current.token, current);
  };

  const start = async () => {
    if (!startPromise) {
      startPromise = Promise.all([
        options.listenLockRequested((payload) => {
          void handleLockRequested(payload).catch(reportProtocolError);
        }),
        options.listenLockAcknowledged(handleLockAcknowledged),
        options.listenLockReleased(handleLockReleased),
      ]).then(async (registeredCleanups) => {
        cleanups.push(...registeredCleanups);
        await initializeRemoteLease();
      });
    }
    await startPromise;
  };

  const broadcastRelease = async (token: string) => {
    try {
      await options.notifyLockReleased(token);
    } catch (error) {
      reportProtocolError(error);
    }
  };

  const releaseNativeLease = async (token: string) => {
    if (!nativeLease) {
      return;
    }
    try {
      await nativeLease.release(token, owner);
    } catch (error) {
      reportProtocolError(error);
    }
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
    if (localToken || remoteToken) {
      throw new Error("다른 복원 작업이 이미 진행 중입니다.");
    }

    const token = createToken();
    localToken = token;
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
        startLeaseRenewal(token);
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
      options.unlockLocal(token);
    }
  };

  const stop = async () => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    if (localToken) {
      const token = localToken;
      await release(token);
    }
    if (remoteToken) {
      const token = remoteToken;
      unlockRemote(token);
    }
  };

  return {
    start,
    acquire,
    release,
    stop,
  };
}
