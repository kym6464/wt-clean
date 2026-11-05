const SLOW_THRESHOLD_MS = 1000;

/**
 * Runs `task`; if it takes longer than a second, shows `message` on stderr while it runs and
 * replaces the line with `message` plus the elapsed time on completion. Fast tasks log nothing.
 */
export async function step<T>(message: string, task: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const tty = process.stderr.isTTY;
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    if (tty) process.stderr.write(`${message}…`);
  }, SLOW_THRESHOLD_MS);

  try {
    return await task();
  } finally {
    clearTimeout(timer);
    if (shown) {
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      if (tty) process.stderr.write(`\r\x1b[K`);
      process.stderr.write(`${message} (${elapsed}s)\n`);
    }
  }
}
