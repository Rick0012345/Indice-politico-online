import {setTimeout as sleepTimer} from 'node:timers/promises';

export function createHttpRateLimiter({
  intervalMs,
  now = Date.now,
  sleep = async (ms: number) => {await sleepTimer(ms);},
}: {
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Intervalo HTTP deve ser finito e positivo.');
  let nextAllowedAt = -Infinity;
  let queue = Promise.resolve();

  const waitForSlot = (): Promise<void> => {
    const waiting = queue.then(async () => {
      // Another in-flight request can extend the cooldown while this slot sleeps.
      for (;;) {
        const timestamp = now();
        const remaining = nextAllowedAt - timestamp;
        if (remaining > 0) {
          await sleep(Math.min(remaining,2147483647));
          continue;
        }
        nextAllowedAt = timestamp + intervalMs;
        return;
      }
    });
    // Preserve the caller's rejection without preventing subsequent slots from running.
    queue = waiting.catch(() => undefined);
    return waiting;
  };

  const cooldown = (ms: number): void => {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Cooldown HTTP deve ser finito e não negativo.');
    const deadline = now() + ms;
    if (!Number.isFinite(deadline)) throw new RangeError('Prazo de cooldown HTTP fora do limite.');
    nextAllowedAt = Math.max(nextAllowedAt,deadline);
  };

  return {waitForSlot,cooldown};
}
