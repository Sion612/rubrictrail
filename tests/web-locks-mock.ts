type QueuedLockRequest = {
  name: string;
  mode: LockMode;
  callback: LockGrantedCallback<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

export function createFifoLockManager() {
  const queue: QueuedLockRequest[] = [];
  let active: QueuedLockRequest | null = null;

  const drain = () => {
    if (active || queue.length === 0) return;
    active = queue.shift() ?? null;
    if (!active) return;

    const lockRequest = active;
    if (lockRequest.abort && lockRequest.signal) {
      lockRequest.signal.removeEventListener("abort", lockRequest.abort);
    }
    const lock = { name: lockRequest.name, mode: lockRequest.mode } as Lock;
    Promise.resolve()
      .then(() => lockRequest.callback(lock))
      .then(lockRequest.resolve, lockRequest.reject)
      .finally(() => {
        active = null;
        drain();
      });
  };

  const request = <T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> => {
    const options =
      typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    if (!callback) return Promise.reject(new TypeError("Expected a lock callback"));
    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }
    if (options?.ifAvailable && (active !== null || queue.length > 0)) {
      return Promise.resolve(callback(null)) as Promise<Awaited<T>>;
    }

    return new Promise<Awaited<T>>((resolve, reject) => {
      const lockRequest: QueuedLockRequest = {
        name,
        mode: options?.mode ?? "exclusive",
        callback: callback as LockGrantedCallback<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: options?.signal,
      };
      if (options?.signal) {
        lockRequest.abort = () => {
          const index = queue.indexOf(lockRequest);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(options.signal?.reason);
        };
        options.signal.addEventListener("abort", lockRequest.abort, { once: true });
      }
      queue.push(lockRequest);
      drain();
    });
  };

  const manager = {
    request,
    query: async (): Promise<LockManagerSnapshot> => ({
      held: active
        ? [{ name: active.name, mode: active.mode, clientId: "vitest-active" }]
        : [],
      pending: queue.map((item, index) => ({
        name: item.name,
        mode: item.mode,
        clientId: `vitest-pending-${index}`,
      })),
    }),
  } as LockManager;

  return {
    manager,
    pendingCount: () => queue.length,
  };
}

export function installLockManager(manager: LockManager) {
  const previous = Object.getOwnPropertyDescriptor(window.navigator, "locks");
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: manager,
  });
  return () => {
    if (previous) {
      Object.defineProperty(window.navigator, "locks", previous);
    } else {
      Reflect.deleteProperty(window.navigator, "locks");
    }
  };
}

export function removeLockManager() {
  Reflect.deleteProperty(window.navigator, "locks");
}

export function holdLock(manager: LockManager, name: string) {
  let releaseGate: (() => void) | undefined;
  let markEntered: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const done = manager.request(name, async () => {
    markEntered?.();
    await gate;
  });
  return {
    entered,
    done,
    release: () => releaseGate?.(),
  };
}
