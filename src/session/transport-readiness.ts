export type ReadyWaiter = {
  generation: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

export function waitUntilReady(
  waiters: ReadyWaiter[],
  generation: number,
  currentGeneration: number,
  phase: "starting" | "ready" | "running" | "dead",
  resolve: () => void,
  reject: (error: Error) => void,
): void {
  if (generation !== currentGeneration || phase === "dead") {
    reject(new Error("Agda process generation is no longer active"));
  } else if (phase === "ready") {
    resolve();
  } else {
    waiters.push({ generation, resolve, reject });
  }
}

export function rejectReadyWaiters(
  waiters: ReadyWaiter[],
  error: Error | undefined,
  generation: number,
): void {
  const pending = waiters.splice(0);
  for (const waiter of pending) {
    if (waiter.generation === generation) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    } else {
      waiters.push(waiter);
    }
  }
}

export function removeReadyWaiter(
  waiters: ReadyWaiter[],
  resolve: () => void,
  reject: (error: Error) => void,
  generation: number,
): void {
  const index = waiters.findIndex((waiter) =>
    waiter.generation === generation && waiter.resolve === resolve && waiter.reject === reject,
  );
  if (index >= 0) waiters.splice(index, 1);
}
