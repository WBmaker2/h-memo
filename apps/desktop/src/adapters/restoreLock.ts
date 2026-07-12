export type RestoreLockRequest = {
  token: string;
};

export type RestoreLockAcknowledgement = {
  token: string;
  windowLabel: string;
  ok: boolean;
  error?: string;
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
  lockLocal: (token: string) => Promise<void>;
  unlockLocal: (token: string) => void;
  timeoutMs?: number;
  onProtocolError?: (error: unknown) => void;
};

type PendingAcknowledgements = {
  expectedWindowLabels: Set<string>;
  acknowledgedWindowLabels: Set<string>;
  resolve: () => void;
  reject: (error: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const DEFAULT_ACK_TIMEOUT_MS = 5000;

function createToken() {
  return `restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

export function createRestoreLockCoordinator(options: RestoreLockCoordinatorOptions) {
  const pendingAcknowledgements = new Map<string, PendingAcknowledgements>();
  const cleanups: Array<() => void> = [];
  let startPromise: Promise<void> | null = null;
  let localToken: string | null = null;
  let remoteToken: string | null = null;

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
    const pending = pendingAcknowledgements.get(token);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutId);
    pendingAcknowledgements.delete(token);
  };

  const handleLockRequested = async (payload: RestoreLockRequest) => {
    const windowLabel = options.getCurrentWindowLabel();

    if (localToken === payload.token || remoteToken === payload.token) {
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel,
        ok: true,
      });
      return;
    }

    if (localToken || remoteToken) {
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel,
        ok: false,
        error: "다른 복원 작업이 이미 진행 중입니다.",
      });
      return;
    }

    remoteToken = payload.token;
    try {
      await options.lockLocal(payload.token);
      await options.notifyLockAcknowledged({
        token: payload.token,
        windowLabel,
        ok: true,
      });
    } catch (error) {
      remoteToken = null;
      options.unlockLocal(payload.token);
      try {
        await options.notifyLockAcknowledged({
          token: payload.token,
          windowLabel,
          ok: false,
          error: toError(error, "복원 잠금을 적용하지 못했습니다.").message,
        });
      } catch (ackError) {
        reportProtocolError(ackError);
      }
    }
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
    if (remoteToken !== payload.token) {
      return;
    }
    remoteToken = null;
    options.unlockLocal(payload.token);
  };

  const start = async () => {
    if (!startPromise) {
      startPromise = Promise.all([
        options.listenLockRequested((payload) => {
          void handleLockRequested(payload).catch(reportProtocolError);
        }),
        options.listenLockAcknowledged(handleLockAcknowledged),
        options.listenLockReleased(handleLockReleased),
      ]).then((registeredCleanups) => {
        cleanups.push(...registeredCleanups);
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

  const acquire = async () => {
    await start();
    if (localToken || remoteToken) {
      throw new Error("다른 복원 작업이 이미 진행 중입니다.");
    }

    const token = createToken();
    localToken = token;
    let localDrain: Promise<void>;
    let pending: PendingAcknowledgements | null = null;

    try {
      // lockLocal synchronously flips the caller's persistence barrier before its queue drain.
      localDrain = options.lockLocal(token);
      const liveWindowLabels = await options.listLiveWindowLabels();
      const expectedWindowLabels = new Set(liveWindowLabels);
      expectedWindowLabels.add(options.getCurrentWindowLabel());

      let resolvePending!: () => void;
      let rejectPending!: (error: unknown) => void;
      const acknowledgementPromise = new Promise<void>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      pending = {
        expectedWindowLabels,
        acknowledgedWindowLabels: new Set(),
        resolve: resolvePending,
        reject: rejectPending,
        timeoutId: setTimeout(() => {
          rejectPending(new Error("복원 잠금 승인을 기다리는 시간이 초과되었습니다."));
        }, options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS),
      };
      pendingAcknowledgements.set(token, pending);

      void Promise.resolve(localDrain).then(
        () => settlePending(token, options.getCurrentWindowLabel()),
        (error) => settlePending(token, options.getCurrentWindowLabel(), error)
      );

      await options.notifyLockRequested(token);
      await acknowledgementPromise;
      clearPending(token);
      return token;
    } catch (error) {
      if (pending) {
        clearPending(token);
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
      await options.notifyLockReleased(token);
    } catch (error) {
      reportProtocolError(error);
    } finally {
      clearPending(token);
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
      remoteToken = null;
      options.unlockLocal(token);
    }
  };

  return {
    start,
    acquire,
    release,
    stop,
  };
}
