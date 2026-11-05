import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// A freshly created worktree looks merged (its branch points at the default branch's commit) until work starts, e.g. while still planning.
const PRUNE_ARGS = ['step', 'prune', '--min-age', '1d'];

export type PruneEntry = {
  branch: string;
  /** `branch_only` = merged local branch with no worktree */
  kind: 'worktree' | 'branch_only';
  path: string | null;
  /** e.g. "all changes in", "ancestor of"; read as `${reason} ${target}` */
  reason: string;
  target: string;
};

/** What `wt step prune` would remove in this repo. */
export async function pruneDryRun(repoPath: string): Promise<PruneEntry[]> {
  const { stdout } = await run('wt', [...PRUNE_ARGS, '--dry-run', '--format=json'], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as PruneEntry[];
}

/** Runs the prune; file deletion continues in the background per worktrunk's default. Returns wt's output. */
export async function prune(repoPath: string): Promise<string> {
  const { stdout, stderr } = await run('wt', [...PRUNE_ARGS, '--yes'], { cwd: repoPath });
  return `${stdout}${stderr}`.trim();
}
