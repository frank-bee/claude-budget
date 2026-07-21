# claude-budget-statusline

A small, configurable Claude spend readout for the [Claude Code](https://claude.com/claude-code)
statusline — calibrated against your **real** Anthropic bill.

It builds on [`ccusage`](https://github.com/ryoppippi/ccusage), which reads Claude Code's local
logs. But ccusage can't see Claude Desktop or other clients on your account, so its number is
always lower than what you actually pay. `claude-budget-statusline` lets you *calibrate*: tell it
your real current spend once, and it stores the difference as an offset applied to every reading
until the billing cycle rolls over.

```
💰 $190/$200 (95%)
```

## Install via Claude (recommended)

This repo ships a Claude Code plugin with a skill that installs the CLI **and** wires it into
your statusline for you — no manual steps, no editing `settings.json` by hand:

```
/plugin marketplace add frank-bee/claude-budget
/plugin install claude-budget
```

Then just ask Claude: *"install claude-budget in my statusline"*. The skill checks Node, installs
the npm package, finds (or creates) your `statusline.sh`, adds the spend segment, migrates any
existing old python `budget` setup, and walks you through calibrating to your real bill.

## Manual install

Requires Node.js ≥18. Zero package dependencies of its own.

```bash
# Persistent — puts `claude-budget-statusline` on your PATH (recommended for the statusline):
npm install -g claude-budget-statusline

# Or run ad-hoc without installing:
npx claude-budget-statusline --help
```

**Note:** `ccusage` is *not* bundled or installed by the above — `claude-budget-statusline` shells
out to `npx ccusage@latest` on every `refresh`/`calibrate` call. `npx` downloads and caches it
automatically the first time it runs, which can take a few seconds; after that it's cached. To
pre-warm it yourself: `npx --yes ccusage@latest --version`.

## Usage

```bash
claude-budget-statusline refresh              # recompute spend via ccusage + offset, write the cache line
claude-budget-statusline calibrate 190         # anchor displayed spend to $190 (your real bill) this cycle
claude-budget-statusline calibrate 190 250     # anchor to $190 AND set the budget ceiling to $250, in one step
claude-budget-statusline line                  # print the cached statusline segment (fast, no ccusage call)
claude-budget-statusline config get            # show current config
claude-budget-statusline config set max 250
claude-budget-statusline config set cycle_start_day 8
```

### Calibration

`ccusage` undercounts. When you check your actual spend on the Anthropic billing page, run:

```bash
claude-budget-statusline calibrate <real_amount> [new_max]
```

The tool reads ccusage's current figure and stores `offset = real_amount − ccusage_now`. From
then on, `refresh` shows `ccusage + offset`. The offset is tagged with the current billing cycle
and is **automatically dropped when the cycle rolls over**, so a stale anchor never carries into a
new month — just re-calibrate when you next check the bill.

The optional second argument sets the budget ceiling (`max`) at the same time, so a bill check
that also changes your monthly budget is a single command instead of `calibrate` + `config set max`.

## Configuration

`~/.config/claude-budget/config.json` (auto-created defaults shown):

```json
{
  "max": 200.0,
  "cycle_start_day": 8,
  "exclude_models": ["claude-fable-5"]
}
```

- `max` — budget ceiling in $
- `cycle_start_day` — billing-cycle reset day-of-month
- `exclude_models` — ccusage overstates fable pricing, excluded by default

State (offset + cached line) lives under `~/.local/state/claude-budget/`.

## Statusline integration

`claude-budget-statusline` never blocks the statusline: the render just prints the cached line
(`claude-budget-statusline line`), and a background `refresh` updates the cache when it goes
stale. Example snippet for your `statusline.sh`:

```bash
STATE_DIR="$HOME/.local/state/claude-budget"
CACHE_FILE="$STATE_DIR/statusline-cache"
TRIGGER_FILE="$STATE_DIR/last-refresh-trigger"
STALE_SECS=300

now=$(date +%s)
cache_age=$STALE_SECS
[ -f "$CACHE_FILE" ] && cache_age=$(( now - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
trigger_age=$STALE_SECS
[ -f "$TRIGGER_FILE" ] && trigger_age=$(( now - $(stat -f %m "$TRIGGER_FILE" 2>/dev/null || echo 0) ))

if [ "$cache_age" -ge "$STALE_SECS" ] && [ "$trigger_age" -ge "$STALE_SECS" ]; then
  mkdir -p "$STATE_DIR"; touch "$TRIGGER_FILE"
  ( claude-budget-statusline refresh >/dev/null 2>&1 & disown ) 2>/dev/null
fi

budget_part=$(claude-budget-statusline line 2>/dev/null)
```

`stat -f %m` is the macOS/BSD form; on GNU/Linux use `stat -c %Y`.

## License

MIT
