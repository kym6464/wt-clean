import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { githubRepo, latestPullRequests, type PullRequest } from './github.js';

const run = promisify(execFile);

export type Removal = {
  /** null when HEAD is detached */
  branch: string | null;
  /** null for a branch without a worktree */
  path: string | null;
  /** e.g. "ancestor of", "closed PR"; read as `${reason} ${target}` */
  reason: string;
  target: string;
};

/** A branch whose PR is closed or merged but which can't be removed safely, e.g. because it has local changes. */
export type Skipped = {
  branch: string;
  path: string | null;
  reason: string;
};

type PruneEntry = Removal & {
  kind: 'worktree' | 'branch_only';
};

type Worktree = {
  path: string;
  branch: string | null;
  locked: boolean;
};

/** Merged, clean worktrees and merged branches at least `minAgeHours` old, per `wt step prune`. */
export async function findMerged(repoPath: string, minAgeHours: number): Promise<Removal[]> {
  const { stdout } = await run('wt', ['step', 'prune', '--min-age', `${minAgeHours}h`, '--dry-run', '--format=json'], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = JSON.parse(stdout) as PruneEntry[];
  return entries.map(({ branch, path, reason, target }) => ({ branch, path, reason, target }));
}

/**
 * Branches, with or without a worktree, whose latest PR is closed or merged and whose tip is the PR's head commit, i.e. nothing
 * would be lost. Catches squash merges that `wt step prune` can't detect and abandoned PRs. Branches in `exclude` are ignored.
 */
export async function findClosedPullRequests(
  repoPath: string,
  minAgeHours: number,
  exclude: Set<string>
): Promise<{ removals: Removal[]; skipped: Skipped[] }> {
  const repo = await githubRepo(repoPath);
  if (!repo) return { removals: [], skipped: [] };

  const [worktrees, branchToTip, protectedBranches] = await Promise.all([
    listWorktrees(repoPath),
    listBranches(repoPath),
    protectedBranchNames(repoPath),
  ]);
  const branchToWorktree = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch as string, w]));
  const mainBranch = worktrees[0]?.branch;
  const branches = [...branchToTip.keys()].filter((b) => !exclude.has(b) && !protectedBranches.has(b));
  const branchToPr = await latestPullRequests(repo, branches);

  const closed = [...branchToPr].filter(([branch, pr]) => pr.state !== 'OPEN' && !branchToWorktree.get(branch)?.locked);
  await fetchMissingHeads(
    repoPath,
    closed.filter(([branch, pr]) => branchToTip.get(branch) !== pr.headRefOid).map(([, pr]) => pr)
  );

  const removals: Removal[] = [];
  const skipped: Skipped[] = [];
  for (const [branch, pr] of closed) {
    const worktree = branchToWorktree.get(branch);
    const path = worktree?.path ?? null;
    const prLabel = `${pr.state.toLowerCase()} PR #${pr.number}`;
    const pushed = await isPushed(repoPath, branchToTip.get(branch) as string, pr.headRefOid);
    const problem = await removalProblem(branch, worktree, pushed, mainBranch, minAgeHours);
    if (problem) {
      skipped.push({ branch, path, reason: `${prLabel}, ${problem}` });
      continue;
    }
    removals.push({ branch, path, reason: `${pr.state.toLowerCase()} PR`, target: `#${pr.number}` });
  }
  return { removals, skipped };
}

async function removalProblem(
  branch: string,
  worktree: Worktree | undefined,
  pushed: boolean,
  mainBranch: string | null | undefined,
  minAgeHours: number
): Promise<string | null> {
  if (branch === mainBranch) return 'checked out in the main worktree';
  if (!pushed) return 'has commits that are not in the PR';
  if (!worktree) return null;
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: worktree.path });
  if (stdout.trim()) return 'uncommitted changes';
  const { birthtimeMs } = await stat(worktree.path);
  if (Date.now() - birthtimeMs < minAgeHours * 3_600_000) return `younger than ${minAgeHours}h`;
  return null;
}

/**
 * Whether nothing on `tip` would be lost: every commit is in the PR, or the tree is identical to the PR head's (the same content
 * under different hashes, e.g. after the repo's history was rewritten).
 */
async function isPushed(repoPath: string, tip: string, head: string): Promise<boolean> {
  if (tip === head) return true;
  const ancestor = await run('git', ['merge-base', '--is-ancestor', tip, head], { cwd: repoPath })
    .then(() => true)
    .catch(() => false);
  if (ancestor) return true;
  const trees = await run('git', ['rev-parse', `${tip}^{tree}`, `${head}^{tree}`], { cwd: repoPath })
    .then(({ stdout }) => stdout.trim().split('\n'))
    .catch(() => []);
  return trees.length === 2 && trees[0] === trees[1];
}

/** Fetches PR heads that aren't local, e.g. after the PR's branch was force-pushed or deleted on GitHub. */
async function fetchMissingHeads(repoPath: string, prs: PullRequest[]): Promise<void> {
  const missing = [];
  for (const pr of prs) {
    const present = await run('git', ['cat-file', '-e', `${pr.headRefOid}^{commit}`], { cwd: repoPath })
      .then(() => true)
      .catch(() => false);
    if (!present) missing.push(pr);
  }
  if (missing.length === 0) return;
  await run('git', ['fetch', '--quiet', '--no-tags', 'origin', ...missing.map((pr) => `pull/${pr.number}/head`)], { cwd: repoPath });
}

/** The first entry is the main worktree. */
async function listWorktrees(repoPath: string): Promise<Worktree[]> {
  const { stdout } = await run('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
  return stdout
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      const value = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      const ref = value('branch');
      return {
        path: value('worktree') as string,
        branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
        locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      };
    });
}

async function listBranches(repoPath: string): Promise<Map<string, string>> {
  const { stdout } = await run('git', ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Map(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ') as [string, string])
  );
}

/** The default branch, which a PR could have used as its head. */
async function protectedBranchNames(repoPath: string): Promise<Set<string>> {
  const { stdout } = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoPath }).catch(() => ({ stdout: '' }));
  const defaultBranch = stdout.trim().replace(/^origin\//, '');
  return new Set(defaultBranch ? [defaultBranch] : ['main', 'master']);
}

/**
 * Removes the worktrees and branches one at a time. `-D` deletes branches that git doesn't consider merged, which is safe because
 * every target is either merged per `wt step prune` or matches a closed PR's head. Runs in the foreground so deletions don't pile up
 * concurrently. `wt remove` keeps going past a target it can't remove and then exits non-zero, which rejects with its output.
 */
export async function removeAll(repoPath: string, targets: string[]): Promise<string> {
  const { stdout, stderr } = await run('wt', ['remove', '--yes', '--foreground', '--force-delete', ...targets], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}
