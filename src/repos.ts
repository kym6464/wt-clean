import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Main worktrees directly under `dirs` (symlinked entries excluded to avoid double-counting). */
export async function findGitRepos(dirs: string[]): Promise<string[]> {
  const repos: string[] = [];
  for (const dir of await Promise.all(dirs.map((d) => realpath(d)))) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents.filter((d) => d.isDirectory())) {
      const repoPath = join(dir, dirent.name);
      if (await isSymlinkedRepo(repoPath)) continue;
      if (!(await stat(join(repoPath, '.git')).catch(() => null))) continue;
      repos.push(repoPath);
    }
  }
  return repos;
}

async function isSymlinkedRepo(repoPath: string): Promise<boolean> {
  const real = await realpath(repoPath).catch(() => repoPath);
  return real !== repoPath;
}
