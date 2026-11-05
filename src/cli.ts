import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { program } from 'commander';
import { loadConfig } from './config.js';
import { findGitRepos } from './repos.js';
import { findMergedWorktrees, removeWorktrees, type MergedWorktree } from './worktrees.js';
import { notify } from './notify.js';
import { step } from './progress.js';

const run = promisify(execFile);

type RepoWorktree = MergedWorktree & { repo: string; repoPath: string };

/** Repos where a dry run or removal failed; reported once at the end of the run. */
const failedRepos = new Set<string>();

program
  .name('wt clean')
  .description('Remove worktrees that are merged into their default branch, across all repos')
  .option('--dry-run', 'show what would be removed')
  .action(async ({ dryRun }: { dryRun?: boolean }) => {
    console.log(`=== ${new Date().toISOString()} ===`);
    const { repoDirs, minAgeHours } = await loadConfig();

    const repos = await findGitRepos(repoDirs);
    const fetchFailures = await step(`Fetching ${repos.length} repos`, () => fetchAll(repos));
    for (const repo of fetchFailures) console.log(`fetch failed  ${basename(repo)} — judging merge state from last fetch`);

    const worktrees = await step('Checking for merged worktrees', () => findAll(repos, minAgeHours));
    if (worktrees.length > 0) {
      console.log(dryRun ? 'Would remove:' : 'Removing:');
      const nameWidth = Math.max(...worktrees.map((w) => label(w).length));
      for (const w of worktrees) console.log(`  ${label(w).padEnd(nameWidth)}  — ${w.reason} ${w.target}`);
    } else {
      console.log('Nothing to clean.');
    }
    if (!dryRun) await removeAll(worktrees);

    if (failedRepos.size > 0) await fail(`Failed in ${[...failedRepos].join(', ')}; see the log`);
  });

/** Returns the repos whose fetch failed (offline, missing remote, ...). */
async function fetchAll(repos: string[]): Promise<string[]> {
  const results = await Promise.all(
    repos.map((repoPath) =>
      run('git', ['fetch', '--quiet'], { cwd: repoPath })
        .then(() => null)
        .catch(() => repoPath)
    )
  );
  return results.filter((r) => r !== null);
}

async function findAll(repos: string[], minAgeHours: number): Promise<RepoWorktree[]> {
  const perRepo = await Promise.all(
    repos.map(async (repoPath) => {
      const repo = basename(repoPath);
      const worktrees = await findMergedWorktrees(repoPath, minAgeHours).catch((error: Error) => {
        failedRepos.add(repo);
        console.log(`check failed  ${repo}\n${indent(error.message)}`);
        return [];
      });
      return worktrees.map((w) => ({ ...w, repo, repoPath }));
    })
  );
  return perRepo.flat();
}

async function removeAll(worktrees: RepoWorktree[]): Promise<void> {
  const repoToPaths = new Map<string, string[]>();
  for (const w of worktrees) repoToPaths.set(w.repoPath, [...(repoToPaths.get(w.repoPath) ?? []), w.path]);

  // One repo at a time: deleting many worktrees at once saturates the SSD and slows the machine down.
  for (const [repoPath, paths] of repoToPaths) {
    const repo = basename(repoPath);
    const output = await removeWorktrees(repoPath, paths).catch((error: Error & { stdout?: string; stderr?: string }) => {
      failedRepos.add(repo);
      return `failed\n${`${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message}`;
    });
    console.log(`${repo}\n${indent(output)}`);
  }
}

async function fail(message: string): Promise<void> {
  console.error(message);
  process.exitCode = 1;
  await notify(message);
}

function label(w: RepoWorktree): string {
  return `${w.repo}/${w.branch ?? basename(w.path)}`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

program.parseAsync().catch((error: Error) => fail(error.message));
