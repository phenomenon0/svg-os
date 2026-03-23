/**
 * Small concurrency helpers for throughput-heavy studio work.
 *
 * These keep parallelism bounded so export stays responsive on the main thread
 * while still overlapping async work like image decoding, canvas export, and
 * blob conversion.
 */

export function getBoundedConcurrency(preferred: number, fallback: number = 2): number {
  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  if (!hw || !Number.isFinite(hw) || hw <= 1) {
    return Math.max(1, fallback);
  }

  // Leave headroom for UI/input work instead of fully saturating the browser.
  const cap = Math.max(1, hw - 1);
  return Math.max(1, Math.min(preferred, cap));
}

export async function cooperativeYield(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: {
    yieldEvery?: number;
    onSettled?: (completed: number, total: number) => void;
  },
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);

  if (total === 0) return results;

  const concurrency = Math.max(1, Math.min(limit, total));
  const yieldEvery = Math.max(1, options?.yieldEvery ?? 4);
  let nextIndex = 0;
  let completed = 0;
  let failure: unknown;

  async function runLane(): Promise<void> {
    while (failure === undefined) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= total) return;

      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        failure = err;
        return;
      }

      completed += 1;
      options?.onSettled?.(completed, total);

      if (completed % yieldEvery === 0) {
        await cooperativeYield();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runLane()));

  if (failure !== undefined) {
    throw failure;
  }

  return results;
}
