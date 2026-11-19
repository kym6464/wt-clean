# wt-clean

A [worktrunk](https://github.com/max-sixty/worktrunk) [custom subcommand](https://worktrunk.dev/extending/#custom-subcommands) (`wt clean`) that cleans up every repo under `~/repos` at once. It runs `git fetch` in each repo, then removes, one at a time to avoid saturating the disk:

- every clean worktree and every branch merged into its default branch, per `wt step prune`
- every clean worktree and every branch whose latest GitHub PR is merged or closed, as long as nothing on the branch would be lost: its tip is in the PR, or has the same tree as the PR head. This catches squash merges that `wt step prune` misses, and abandoned PRs.

Worktrees younger than a day are skipped (they look merged until work starts on them). Branches with a closed or merged PR that can't be removed safely (uncommitted changes, commits not in the PR, checked out in the main worktree) are listed under "Kept despite a closed or merged PR" so you can deal with them.

## Install

```sh
brew install kym6464/tap/wt-clean
brew services start wt-clean  # run now, at login, and daily at 10am
```

One-time setup: ignore Finder's `.DS_Store` files globally. Otherwise a `.DS_Store` counts as an uncommitted change and keeps the worktree around.

```sh
echo .DS_Store >> ~/.config/git/ignore
```

The GitHub check uses `gh`, so `gh auth login` must have been run.

If the Mac was asleep at 10am, the run happens on wake; if it was off, the login run covers it. Output goes to `$(brew --prefix)/var/log/wt-clean.log`. If anything fails, the run shows one macOS notification (from Script Editor) and exits 1.

To keep a worktree regardless of its merge or PR state, run `git worktree lock <path>`.

## Usage

```sh
wt clean            # remove merged and closed-PR worktrees and branches
wt clean --dry-run  # show what would be removed
```

## Configuration

Optional, in `~/.config/wt-clean/config.toml`:

```toml
repo-dirs = ["~/repos", "~/repos_te"]  # directories whose direct children are repos; default ["~/repos"]
min-age-hours = 12                     # skip worktrees younger than this; default 24
```

## Potential enhancements

- **Sweep orphaned trash.** A background `wt remove` (the default outside this tool) renames the worktree into `<repo>/.git/wt/trash/` and deletes it with a detached `rm -rf`. When that process is killed the worktree stays there at full size, and worktrunk only sweeps trash entries older than 24 hours on the next `wt remove` in the same repo, which may be weeks away. `wt clean` could delete such entries in every repo it visits, one at a time like its other removals.

## Development

```sh
bun install
bun run dev -- --dry-run
```

Release by running the Release workflow, which builds the darwin-arm64 binary and publishes the formula to [kym6464/homebrew-tap](https://github.com/kym6464/homebrew-tap).
