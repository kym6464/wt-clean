# wt-clean

A [worktrunk](https://github.com/max-sixty/worktrunk) [custom subcommand](https://worktrunk.dev/extending/#custom-subcommands) (`wt clean`) that cleans up every repo under `~/repos` at once: `git fetch` each repo, then remove every clean worktree merged into its default branch, along with its branch. Worktrees are removed one at a time to avoid saturating the disk. Merged branches without a worktree are left alone. Worktrees younger than a day are skipped (they look merged until work starts on them).

## Install

```sh
brew install kym6464/tap/wt-clean
brew services start wt-clean  # run now, at login, and daily at 10am
```

If the Mac was asleep at 10am, the run happens on wake; if it was off, the login run covers it. Output goes to `$(brew --prefix)/var/log/wt-clean.log`. If anything fails, the run shows one macOS notification (from Script Editor) and exits 1.

To keep a worktree regardless of its merge state, run `git worktree lock <path>`.

## Usage

```sh
wt clean            # remove merged worktrees
wt clean --dry-run  # show what would be removed
```

## Configuration

Optional, in `~/.config/wt-clean/config.toml`:

```toml
repo-dirs = ["~/repos", "~/repos_te"]  # directories whose direct children are repos; default ["~/repos"]
min-age-hours = 12                     # skip worktrees younger than this; default 24
```

## Development

```sh
bun install
bun run dev -- --dry-run
```

Release by running the Release workflow, which builds the darwin-arm64 binary and publishes the formula to [kym6464/homebrew-tap](https://github.com/kym6464/homebrew-tap).
