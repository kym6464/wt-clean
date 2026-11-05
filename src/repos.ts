import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Main worktrees under ~/repos (symlinked entries excluded to avoid double-counting). */
export async function findGitRepos(): Promise<string[]> {
  const reposDir = join(homedir(), 'repos');
  const dirents = await readdir(reposDir, { withFileTypes: true });
  const repoNames = dirents.filter((d) => d.isDirectory()).map((d) => d.name);

  const repos: string[] = [];
  for (const name of repoNames) {
    const repoPath = join(reposDir, name);
    if (await isSymlinkedRepo(repoPath)) continue;
    if (!(await stat(join(repoPath, '.git')).catch(() => null))) continue;
    repos.push(repoPath);
  }
  return repos;
}

async function isSymlinkedRepo(repoPath: string): Promise<boolean> {
  const real = await realpath(repoPath).catch(() => repoPath);
  return real !== repoPath;
}
