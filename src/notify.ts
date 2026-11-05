import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Best effort: shows a macOS notification (attributed to Script Editor). */
export async function notify(message: string): Promise<void> {
  const script = ['on run argv', 'display notification (item 1 of argv) with title "wt clean"', 'end run'];
  await run('osascript', [...script.flatMap((line) => ['-e', line]), message]).catch(() => {});
}
