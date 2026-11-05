# wt-clean

A [worktrunk](https://github.com/max-sixty/worktrunk) custom subcommand (`wt clean`) that cleans up every repo under `~/repos` at once: `git fetch` each repo, then run `wt step prune --min-age 1d` in each. That removes every worktree and local branch merged into its default branch, skipping worktrees created less than a day ago (they look merged until work starts on them).

## Install

```sh
brew install kym6464/tap/wt-clean
brew services start wt-clean  # run now, at login, and daily at 10am
```

If the Mac was asleep at 10am, the run happens on wake; if it was off, the login run covers it. Output goes to `$(brew --prefix)/var/log/wt-clean.log`.

To keep a worktree regardless of its merge state, run `git worktree lock <path>`.

## Usage

```sh
wt clean            # remove merged worktrees and branches
wt clean --dry-run  # show what would be removed
```

## Development

```sh
bun install
bun run dev -- --dry-run
```

Release by running the Release workflow, which builds the darwin-arm64 binary and publishes the formula to [kym6464/homebrew-tap](https://github.com/kym6464/homebrew-tap).
