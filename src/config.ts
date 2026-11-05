import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_PATH = join(homedir(), '.config', 'wt-clean', 'config.toml');

export type Config = {
  /** Directories whose direct children are scanned for git repos */
  repoDirs: string[];
  /** A freshly created worktree looks merged (its branch points at the default branch's commit) until work starts, e.g. while still planning. */
  minAgeHours: number;
};

const DEFAULTS = { 'repo-dirs': ['~/repos'], 'min-age-hours': 24 };

export async function loadConfig(): Promise<Config> {
  const text = await readFile(CONFIG_PATH, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const parsed = (() => {
    try {
      return Bun.TOML.parse(text);
    } catch (error) {
      throw new Error(`${CONFIG_PATH} is not valid TOML: ${(error as Error).message}`);
    }
  })();
  const raw: Record<string, unknown> = { ...DEFAULTS, ...parsed };

  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown key "${key}" in ${CONFIG_PATH}; supported keys: ${Object.keys(DEFAULTS).join(', ')}`);
  }

  const repoDirs = raw['repo-dirs'];
  if (!Array.isArray(repoDirs) || repoDirs.length === 0 || !repoDirs.every((d) => typeof d === 'string')) {
    throw new Error(`"repo-dirs" in ${CONFIG_PATH} must be a non-empty list of paths, e.g. ["~/repos"]`);
  }
  const resolvedDirs = repoDirs.map(expandHome);
  for (const [i, dir] of resolvedDirs.entries()) {
    const isDir = await stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (!isDir) throw new Error(`"repo-dirs" entry "${repoDirs[i]}" in ${CONFIG_PATH} is not a directory; fix or remove it`);
  }

  const minAgeHours = raw['min-age-hours'];
  if (!Number.isInteger(minAgeHours) || (minAgeHours as number) < 0) {
    throw new Error(`"min-age-hours" in ${CONFIG_PATH} must be a whole number of hours, 0 or more`);
  }

  return { repoDirs: resolvedDirs, minAgeHours: minAgeHours as number };
}

function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  return path;
}
