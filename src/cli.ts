import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { program } from 'commander';
import { findGitRepos } from './repos.js';
import { pruneDryRun, prune, type PruneEntry } from './prune.js';
import { step } from './progress.js';

const run = promisify(execFile);

type RepoEntry = PruneEntry & { repo: string; repoPath: string };

program
  .name('wt clean')
  .description('Remove worktrees and local branches that are merged into their default branch, across all repos')
  .option('--dry-run', 'show what would be removed')
  .action(async ({ dryRun }: { dryRun?: boolean }) => {
    console.log(`=== ${new Date().toISOString()} ===`);

    const repos = await findGitRepos();
    const fetchFailures = await step(`Fetching ${repos.length} repos`, () => fetchAll(repos));
    for (const repo of fetchFailures) console.log(`fetch failed  ${basename(repo)} — judging merge state from last fetch`);

    const entries = await step('Checking for merged worktrees', () => dryRunAll(repos));
    if (entries.length === 0) {
      console.log('Nothing to clean.');
      return;
    }

    console.log(dryRun ? 'Would remove:' : 'Removing:');
    const nameWidth = Math.max(...entries.map((e) => label(e).length));
    for (const entry of entries) console.log(`  ${label(entry).padEnd(nameWidth)}  — ${entry.reason} ${entry.target}`);
    if (dryRun) return;

    const affected = [...new Set(entries.map((e) => e.repoPath))];
    await Promise.all(
      affected.map(async (repoPath) => {
        const output = await prune(repoPath).catch((error: Error) => {
          process.exitCode = 1;
          return `failed\n${error.message}`;
        });
        console.log(`${basename(repoPath)}\n${indent(output)}`);
      })
    );
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

async function dryRunAll(repos: string[]): Promise<RepoEntry[]> {
  const perRepo = await Promise.all(
    repos.map(async (repoPath) => {
      const entries = await pruneDryRun(repoPath).catch(() => []);
      return entries.map((entry) => ({ ...entry, repo: basename(repoPath), repoPath }));
    })
  );
  return perRepo.flat();
}

function label(entry: RepoEntry): string {
  const suffix = entry.kind === 'branch_only' ? ' (branch only)' : '';
  return `${entry.repo}/${entry.branch}${suffix}`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
