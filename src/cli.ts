import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { program } from 'commander';
import { loadConfig } from './config.js';
import { findGitRepos } from './repos.js';
import { findClosedPullRequests, findMerged, removeAll, type Removal, type Skipped } from './worktrees.js';
import { notify } from './notify.js';
import { step } from './progress.js';

const run = promisify(execFile);

type InRepo<T> = T & { repo: string; repoPath: string };

/** Repos where a dry run or removal failed; reported once at the end of the run. */
const failedRepos = new Set<string>();

program
  .name('wt clean')
  .description('Remove merged or closed-PR worktrees and branches, across all repos')
  .option('--dry-run', 'show what would be removed')
  .action(async ({ dryRun }: { dryRun?: boolean }) => {
    console.log(`=== ${new Date().toISOString()} ===`);
    const { repoDirs, minAgeHours } = await loadConfig();

    const repos = await findGitRepos(repoDirs);
    const fetchFailures = await step(`Fetching ${repos.length} repos`, () => fetchAll(repos));
    for (const repo of fetchFailures) console.log(`fetch failed  ${basename(repo)} — judging merge state from last fetch`);

    const { removals, skipped } = await step('Checking for merged branches and closed PRs', () => findAll(repos, minAgeHours, fetchFailures));
    if (removals.length > 0) {
      console.log(dryRun ? 'Would remove:' : 'Removing:');
      const nameWidth = Math.max(...removals.map((r) => label(r).length));
      for (const r of removals) console.log(`  ${label(r).padEnd(nameWidth)}  — ${r.reason} ${r.target}`);
    } else {
      console.log('Nothing to clean.');
    }
    if (skipped.length > 0) {
      console.log('Kept despite a closed or merged PR:');
      const nameWidth = Math.max(...skipped.map((s) => label(s).length));
      for (const s of skipped) console.log(`  ${label(s).padEnd(nameWidth)}  — ${s.reason}`);
    }
    if (!dryRun) await removeEverywhere(removals);

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

async function findAll(
  repos: string[],
  minAgeHours: number,
  fetchFailures: string[]
): Promise<{ removals: InRepo<Removal>[]; skipped: InRepo<Skipped>[] }> {
  const perRepo = await Promise.all(
    repos.map(async (repoPath) => {
      const repo = basename(repoPath);
      try {
        const merged = await findMerged(repoPath, minAgeHours);
        const exclude = new Set(merged.flatMap((m) => (m.branch ? [m.branch] : [])));
        // Offline: the GitHub check can't run, and the fetch failure is already logged.
        const closed = fetchFailures.includes(repoPath)
          ? { removals: [], skipped: [] }
          : await findClosedPullRequests(repoPath, minAgeHours, exclude);
        const inRepo = <T>(items: T[]) => items.map((item) => ({ ...item, repo, repoPath }));
        return { removals: inRepo([...merged, ...closed.removals]), skipped: inRepo(closed.skipped) };
      } catch (error) {
        failedRepos.add(repo);
        console.log(`check failed  ${repo}\n${indent((error as Error).message)}`);
        return { removals: [], skipped: [] };
      }
    })
  );
  return { removals: perRepo.flatMap((r) => r.removals), skipped: perRepo.flatMap((r) => r.skipped) };
}

async function removeEverywhere(removals: InRepo<Removal>[]): Promise<void> {
  const repoToTargets = new Map<string, string[]>();
  for (const r of removals) repoToTargets.set(r.repoPath, [...(repoToTargets.get(r.repoPath) ?? []), (r.path ?? r.branch) as string]);

  // One repo at a time: deleting many worktrees at once saturates the SSD and slows the machine down.
  for (const [repoPath, targets] of repoToTargets) {
    const repo = basename(repoPath);
    const output = await removeAll(repoPath, targets).catch((error: Error & { stdout?: string; stderr?: string }) => {
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

function label(item: InRepo<{ branch: string | null; path: string | null }>): string {
  const name = `${item.repo}/${item.branch ?? basename(item.path ?? '')}`;
  return item.path ? name : `${name} (branch only)`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

program.parseAsync().catch((error: Error) => fail(error.message));
