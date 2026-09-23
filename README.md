# hop

Hand off an in-progress task between **Codex** and **Claude Code** without losing context.

```bash
hop cc       # Codex → Claude Code
hop codex    # Claude Code → Codex
```

One command reads the session you were just working in, writes a handoff document, and opens a new terminal tab where the other agent picks up the task in the same directory (worktree included).

[中文文档](README.zh-CN.md)

## Why

You're halfway through a task in Codex and it hits a rate limit, runs out of quota, or gets stuck in a loop. You want Claude Code to carry on, or the other way round.

Doing that by hand is tedious. You re-explain the goal, paste the last few messages, tell the new agent which branch and worktree you're on, which files were edited, what was already tried and failed, and which dev server is already running. Most of that information already exists on disk in the two tools' session logs. `hop` collects it for you.

It also has to work **when the current agent can't**. An agent that is rate-limited can't write its own handoff note. So `hop` doesn't need the source agent at all. It's a plain CLI that reads the session files directly. Inside a stuck Claude Code session you can type:

```
! hop codex
```

The `!` prefix runs a shell command without calling the model, so it works even when you're out of quota.

## Requirements

- macOS, with iTerm2 or Terminal.app (only needed to open the new tab; `--here` and `--dry-run` work anywhere)
- Node.js ≥ 20
- [Codex CLI](https://github.com/openai/codex) and/or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and on `PATH`

There are no npm dependencies.

## Install

```bash
git clone https://github.com/0genlab/hop.git ~/code/hop
ln -s ~/code/hop/bin/hop.mjs ~/.local/bin/hop   # any directory on your PATH
hop --help
```

Or install globally with npm:

```bash
npm install -g github:0genlab/hop
```

## Usage

### Switch

Run it from the project directory you were working in:

```bash
hop cc        # continue the latest Codex session here in Claude Code
hop codex     # continue the latest Claude Code session here in Codex
```

`hop` prints what it picked: the source session, working directory and branch, the path to the handoff document (turn count and size), and the command to resume the original session. For example:

```
Source    Codex 019a… (current dir /Users/you/code/app)
Workdir   /Users/you/code/app/.worktrees/fix-login  [fix-login]
Handoff   ~/.hop/handoffs/20260923-101500-codex-to-claude.md (12 turns, 31.8 KB)
Go back   codex resume 019a…
```

Then it opens a new tab and starts the target agent with this prompt:

> Read `<handoff file>` and take over this task: following "Notes for the receiving agent" in that file, first restate the current state in 5 lines or fewer, then wait for my confirmation before continuing.

Always check the recap before you let the agent continue.

### Pick a specific session

`hop` matches sessions by the current directory, using the git root, so any session started anywhere in the repo counts. If several sessions were active in the last 10 minutes, it prints a warning. In that case, choose one explicitly:

```bash
hop cc --list                  # show candidate source sessions
hop cc --session 019a1b2c-…    # by session ID, or pass a path to the .jsonl file
hop cc --latest                # ignore the directory; take the newest session anywhere
```

If no session matches the current directory, `hop` falls back to the newest session anywhere.

### Other options

| Option | Effect |
|---|---|
| `--list` | List candidate source sessions and exit |
| `--session <id>` | Use this source session (ID or `.jsonl` path) |
| `--latest` | Ignore the current directory and take the newest session globally |
| `--dry-run` | Write the handoff document only, don't launch anything |
| `--here` | Launch in the current terminal instead of a new tab |
| `--days <n>` | How far back to search, default 14 |
| `--budget <KB>` | Max size of the handoff document, default 48 |
| `-- <args>` | Pass the remaining args to the target CLI, e.g. `hop cc -- --model opus` |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HOP_TERMINAL` | `iterm` if iTerm is installed, else `terminal` | `iterm` or `terminal` (Terminal.app) |
| `HOP_CLAUDE_BIN` | `claude` | Claude Code executable |
| `HOP_CODEX_BIN` | `codex` | Codex executable |
| `HOP_DIR` | `~/.hop` | Where handoffs, launch scripts, and the link log go |
| `HOP_LANG` | from `LC_ALL` / `LC_MESSAGES` / `LANG` | `en` or `zh`: language of CLI output, handoff document and launch prompt |
| `CODEX_HOME` | `~/.codex` | Respected when locating Codex sessions |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Respected when locating Claude Code sessions |

### Going back

The original session is left untouched. `hop` prints its resume command (`codex resume <id>` / `claude --resume <id>`), and every hop is appended to `~/.hop/links.jsonl`, so you can see which session continued which.

## What gets carried over

The handoff document is Markdown and contains:

- **Instructions for the receiving agent**: recap first and wait; grep the raw transcript for details; don't reset uncommitted changes; earlier constraints still apply.
- **Source session**: tool, session ID, model, permission/sandbox mode, and the path to the raw JSONL transcript.
- **Environment snapshot**: working directory, branch, HEAD, upstream ahead/behind, `git status`, diff stat, recent commits, worktrees, stashes, and processes listening on TCP ports whose cwd is inside the project (so the new agent doesn't start a second dev server).
- **Conversation**: your instructions, messages you sent mid-task (often course corrections, so they're highlighted), the assistant's replies, tool calls with truncated output, and plaintext reasoning when it exists. If the session was compacted, the compaction summary is included too.

It stays within the size budget. The most recent turns are kept in full detail, and older turns are compressed step by step down to one-line summaries. The last turn is always kept.

The worktree and uncommitted changes aren't copied anywhere. They're already on disk, and the new agent starts in the same directory.

> CLI messages, the handoff document and the launch prompt follow your locale: Chinese when `LANG`/`LC_ALL` is `zh_*`, English otherwise. Set `HOP_LANG=en` or `HOP_LANG=zh` to override.

## What doesn't carry over

- **Full reasoning.** Codex sessions on OpenAI models store reasoning encrypted, with only a short summary title. Claude Code usually stores thinking blocks as a signature with empty text. Codex sessions that run through a third-party provider do have plaintext reasoning, and that gets included.
- **Running processes.** Dev servers and watchers can't be moved. They're listed so the new agent knows about them.
- **Shell state.** Variables you `export`ed inside the session, activated virtualenvs, and so on.
- **Non-interactive sessions.** `codex exec`, `claude -p` / SDK sessions, and subagent sessions are deliberately skipped when looking for the source.

## How it works

1. **Find the source session.**
   - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Only sessions whose `source` is `cli` (TUI) or `vscode` (desktop app) count.
   - Claude Code: `~/.claude/projects/<slug>/<id>.jsonl`. Only sessions with `entrypoint: cli` count. Both the starting cwd and the latest cwd are matched, because the agent's cwd drifts when it `cd`s or enters a worktree.
2. **Parse the transcript.**
   - Codex: `response_item` records are grouped into turns. Content Codex injects into the user role (`<environment_context>`, AGENTS.md, and similar) is dropped. Tool calls are paired with their outputs by `call_id`. A `compacted` record resets the history.
   - Claude Code: `hop` walks `parentUuid` back from the latest non-sidechain message, so branches you rewound past are excluded. It restores slash commands and filters system reminders and notifications.
3. **Snapshot the environment** with `git` and `lsof`.
4. **Render** the handoff to `~/.hop/handoffs/`, compressing down through 6 levels of detail until it fits the budget.
5. **Launch** the target CLI through a small script in `~/.hop/run/`, opened in a new iTerm2 or Terminal tab via AppleScript.

Both session formats are private and undocumented, and either tool may change them in any release. If parsing breaks after an upgrade, look at `lib/codex.mjs` and `lib/claude.mjs` first.

## Troubleshooting

- **The wrong session was picked.** Run `hop cc --list`, then `--session <id>`.
- **"No session found".** Try `--latest` or `--days 60`. Also check that `CODEX_HOME` / `CLAUDE_CONFIG_DIR` point to where your sessions actually live.
- **No new tab opens.** macOS may be blocking automation. Allow your terminal under *System Settings → Privacy & Security → Automation*, or use `--here`.
- **Codex starts in the wrong directory.** `hop` passes `-C <cwd>` to Codex and `cd`s into the directory before starting Claude Code. Check the `Workdir` line in the output. It uses the session's latest cwd.

## Development

```bash
npm test
```

```
bin/hop.mjs        CLI entry
lib/codex.mjs      Codex session discovery + parsing
lib/claude.mjs     Claude Code session discovery + parsing
lib/snapshot.mjs   git / listening-port snapshot
lib/render.mjs     handoff document + size budget
lib/launch.mjs     launch script + terminal tab
```

## Roadmap

- An in-session command that lets the source agent write its own, richer handoff while it still works
- Resume the original session with an incremental handoff when you hop back
- Linux terminal support

## License

MIT
