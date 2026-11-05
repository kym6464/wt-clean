import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type MergedWorktree = {
  /** null when HEAD is detached */
  branch: string | null;
  path: string;
  /** e.g. "all changes in", "ancestor of"; read as `${reason} ${target}` */
  reason: string;
  target: string;
};

type PruneEntry = Omit<MergedWorktree, 'path'> & {
  /** `branch_only` = merged local branch with no worktree */
  kind: 'worktree' | 'branch_only';
  path: string | null;
};

/** Merged, clean worktrees in this repo that are at least `minAgeHours` old, per `wt step prune`. */
export async function findMergedWorktrees(repoPath: string, minAgeHours: number): Promise<MergedWorktree[]> {
  const { stdout } = await run('wt', ['step', 'prune', '--min-age', `${minAgeHours}h`, '--dry-run', '--format=json'], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = JSON.parse(stdout) as PruneEntry[];
  return entries.filter((e): e is PruneEntry & { path: string } => e.kind === 'worktree' && e.path !== null);
}

/**
 * Removes the worktrees one at a time, and their branches when merged. Runs in the foreground so deletions don't pile up
 * concurrently. `wt remove` keeps going past a worktree it can't remove and then exits non-zero, which rejects with its output.
 */
export async function removeWorktrees(repoPath: string, paths: string[]): Promise<string> {
  const { stdout, stderr } = await run('wt', ['remove', '--yes', '--foreground', ...paths], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}
