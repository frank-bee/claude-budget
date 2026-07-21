---
name: claude-budget-statusline
description: This skill should be used when the user asks to "install claude-budget", "set up the Claude spend readout in my statusline", "add budget to my statusline", "show my Claude spend in the statusline", "calibrate my Claude budget", or wants a Claude Code statusline segment showing spend against a real Anthropic bill. Also use it to migrate an existing statusline from the old python `budget` CLI to `claude-budget-statusline`.
version: 0.1.0
---

# claude-budget-statusline install & wiring

Install the `claude-budget-statusline` CLI (npm, zero dependencies) and wire it into the user's
Claude Code statusline so a spend readout — calibrated against their real Anthropic bill — shows
up automatically. Do the whole thing end to end; do not just print manual instructions.

Confirm with the user before any step that edits their existing files (`~/.claude/settings.json`,
their statusline script) or removes anything. Installing the npm package and running
`claude-budget-statusline` commands is safe to do without asking.

## 1. Preflight

Check Node is available and new enough:

```bash
node -v
```

Require `v18` or later. If Node is missing or too old, tell the user to install Node.js first
(e.g. via `nvm` or their OS package manager) and stop — do not proceed.

## 2. Install the CLI

```bash
npm install -g claude-budget-statusline
claude-budget-statusline --help
```

If the global install fails on permissions, suggest `nvm`/a user-owned Node install rather than
`sudo npm install -g`.

## 3. Find (or create) the statusline

Read `~/.claude/settings.json` and look at the `statusLine` key.

**Case A — `statusLine.command` points at an external script** (e.g.
`bash ~/.claude/statusline.sh`): open that script.

- If it already references the old python tool (look for `budget`, `BUDGET_BIN`, or
  `~/.local/bin/budget`), **rewrite those references in place** to call
  `claude-budget-statusline` instead — same cache file (`~/.local/state/claude-budget/statusline-
  cache`), same stale-refresh-with-trigger-file pattern, just swap the binary name/path. Preserve
  everything else in the script (git branch, model, context segments, etc.) untouched.
- If it has no budget segment yet, insert one modeled on
  `assets/statusline-segment.sh` (cached read + non-blocking background refresh via
  `claude-budget-statusline refresh`, gated by a `STALE_SECS` + trigger-file check) into the
  script's existing composition (wherever it builds up its output — e.g. an array of `parts`
  joined together). Match the host script's style rather than pasting the asset verbatim.

**Case B — no `statusLine` configured at all:** copy
`assets/statusline-segment.sh` to `~/.claude/statusline.sh`, `chmod +x` it, and set:

```json
"statusLine": { "type": "command", "command": "bash ~/.claude/statusline.sh" }
```

in `~/.claude/settings.json` (merge into the existing JSON — don't clobber other keys).

## 4. Migrate the SessionStart hook

Check `~/.claude/settings.json` for a `SessionStart` hook invoking the old `budget` binary
(e.g. `~/.local/bin/budget refresh`). If found, repoint its `command` to
`claude-budget-statusline refresh`. If no such hook exists, it's fine to leave hooks alone —
don't add one that wasn't there before unless the user asks.

## 5. Seed the cache and calibrate

```bash
claude-budget-statusline refresh
```

Then ask the user for their current real Anthropic bill (and, optionally, a new budget ceiling),
and run:

```bash
claude-budget-statusline calibrate <real_amount> [max]
```

This anchors the displayed spend to reality for the current billing cycle (see the main
`README.md` "Calibration" section for how the offset works).

## 6. Remove the old python tool

Check whether the old tool is still installed:

```bash
uv tool list | grep -i claude-budget
```

If present, confirm with the user, then:

```bash
uv tool uninstall claude-budget
```

Also check `~/.local/bin/budget` — if it's a stale shim left behind (not owned by the new npm
install), remove it after confirming with the user.

## 7. Verify

```bash
claude-budget-statusline line
```

Should print the same statusline segment now shown by the running Claude Code session (a fresh
session/reload will pick it up automatically via the `statusLine` command).

## Additional resources

- **`assets/statusline-segment.sh`** — the reusable cached-read + background-refresh segment
  template referenced in step 3.
