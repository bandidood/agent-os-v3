---
name: rtk
description: "Rust Token Killer — high-performance CLI proxy that reduces LLM token consumption by 60-90% via smart output filtering and compression. 100+ supported commands."
version: 0.39.0
binary: ~/.local/bin/rtk
repo: https://github.com/rtk-ai/rtk
---

# rtk (Rust Token Killer)

rtk wraps CLI commands and compresses their output before it hits your LLM context. Single Rust binary, <10ms overhead.

## Setup

Binary at `~/.local/bin/rtk`. PATH must include `~/.local/bin`. Aliases configured in `~/.rtk_aliases.sh` (sourced by `.bashrc`).

**IMPORTANT**: When using `terminal()` tool, aliases are NOT automatically loaded. Either:
1. Prefix command with `rtk` explicitly: `rtk git status`
2. Or source aliases first: `source ~/.rtk_aliases.sh && git status`

```bash
export PATH="$HOME/.local/bin:$PATH"
rtk --version  # Should show 0.39.0+

# Load aliases for interactive use
source ~/.rtk_aliases.sh
```

## Core Usage

Prefix any command with `rtk`:

```bash
rtk git status          # compressed git status
rtk git log -10         # truncated git log
rtk cargo test          # filtered test output
rtk npm install          # deduped npm output
rtk docker ps            # compact container list
rtk kubectl get pods     # compressed pod info
```

### Proxy Mode (passthrough, no filtering)

```bash
rtk proxy git log --oneline -20    # full output, just tracked
rtk proxy curl https://api.example.com/data
```

### Metrics

```bash
rtk gain               # total token savings
rtk gain --history     # per-command savings breakdown
```

## Supported Commands (100+)

Key ecosystems:
- **git/gh/gt**: status, log, diff, add, commit, push, blame, stash
- **cargo/rust**: build, test, clippy, fmt, check
- **npm/pnpm/npx**: install, test, run, list, audit
- **docker/kubectl/aws**: ps, logs, get, describe
- **go**: test, build, vet, mod
- **ruff/pytest/pip/mypy**: lint, test, install, check
- **rspec/rubocop/rake**: test, lint, exec
- **dotnet**: build, test, run
- **playwright/vitest/jest**: test runs

If a command isn't specifically filtered, rtk falls back to passthrough (raw output, no compression).

## Filter System

Filters are TOML config files in `src/filters/`. Each filter defines:
- Regex patterns to match/mask/truncate lines
- Grouping rules to collapse similar output
- Deduplication of repeated lines
- Truncation limits

Custom filters can be placed in `.rtk/filters.toml` in project root.

## Aliases (automatic wrapping)

All commands auto-wrapped via `~/.rtk_aliases.sh`:

- **Git**: git, gh, gt
- **FS**: ls, tree, find, grep, diff, wc, read (via rtk read)
- **Docker/K8s**: docker, kubectl
- **Dev**: cargo, npm, npx, pnpm, pip, pytest, ruff, mypy, go
- **Web**: curl, wget
- **DB**: psql
- **JS**: jest, vitest, next, tsc, lint, playwright, prisma
- **Ruby**: rspec, rubocop, rake
- **Cloud**: aws, dotnet, env

**For `terminal()` calls**: use explicit `rtk <cmd>` prefix since aliases don't persist across non-interactive shells:
```bash
rtk git status    # instead of: git status
rtk docker ps     # instead of: docker ps
```

See `templates/rtk_aliases.sh` for the full alias file sourced by `.bashrc`.

## Key Pitfalls

- **Name collision**: Another project called "rtk" (Rust Type Kit) exists. Verify with `rtk gain` — if it fails, wrong package.
- **PATH required**: Must have `~/.local/bin` in PATH, or use full path `~/.local/bin/rtk`.
- **Proxy fallback**: If filtering breaks output, use `rtk proxy <cmd>` for unfiltered passthrough.
- **Not a replacement**: rtk wraps commands — it doesn't replace them. The underlying tool must still be installed.
- **`rtk rewrite` is for hooks only** — exits code 3 with no output for most commands. It's designed to be called by Claude Code/Gemini/Copilot shell hooks (`REWRITTEN=$(rtk rewrite "$CMD") || exit 0`), NOT for direct command testing. Use `rtk hook check <cmd>` to dry-run rewrites instead, or just prefix with `rtk` directly.
- **Aliases don't persist in `terminal()` tool** — shell aliases from `~/.rtk_aliases.sh` only work in interactive sessions. The `terminal()` tool runs non-interactive shells, so always use explicit `rtk <cmd>` prefix there.

## Install/Update

```bash
# Quick install
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# Homebrew (macOS)
brew install rtk

# Cargo
cargo install --git https://github.com/rtk-ai/rtk
```