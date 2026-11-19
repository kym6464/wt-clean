import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Branches per GraphQL query; one alias each. */
const BATCH_SIZE = 50;

export type PullRequest = {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefOid: string;
};

/** "owner/name" of the repo's GitHub `origin`, or null when origin isn't on GitHub. */
export async function githubRepo(repoPath: string): Promise<string | null> {
  const url = await run('git', ['remote', 'get-url', 'origin'], { cwd: repoPath })
    .then(({ stdout }) => stdout.trim())
    .catch(() => '');
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

/** The most recently created same-repo PR for each branch that has one. */
export async function latestPullRequests(repo: string, branches: string[]): Promise<Map<string, PullRequest>> {
  const [owner, name] = repo.split('/');
  const branchToPr = new Map<string, PullRequest>();
  for (let start = 0; start < branches.length; start += BATCH_SIZE) {
    const batch = branches.slice(start, start + BATCH_SIZE);
    const variables = batch.map((_, i) => `$b${i}: String!`).join(', ');
    const fields = batch
      .map(
        (_, i) =>
          `b${i}: pullRequests(headRefName: $b${i}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number state headRefOid isCrossRepository } }`
      )
      .join('\n');
    const query = `query($owner: String!, $name: String!, ${variables}) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
    for (const [i, branch] of batch.entries()) args.push('-f', `b${i}=${branch}`);

    const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024 });
    const repository = JSON.parse(stdout).data.repository as Record<string, { nodes: (PullRequest & { isCrossRepository: boolean })[] }>;
    for (const [i, branch] of batch.entries()) {
      const pr = repository[`b${i}`]?.nodes.find((n) => !n.isCrossRepository);
      if (pr) branchToPr.set(branch, { number: pr.number, state: pr.state, headRefOid: pr.headRefOid });
    }
  }
  return branchToPr;
}
