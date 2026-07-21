# claude-budget

A small, configurable Claude spend readout for the [Claude Code](https://claude.com/claude-code)
statusline — calibrated against your **real** Anthropic bill.

It builds on [`ccusage`](https://github.com/ryoppippi/ccusage), which reads Claude Code's local
logs. But ccusage can't see Claude Desktop or other clients on your account, so its number is
always lower than what you actually pay. `claude-budget` lets you *calibrate*: tell it your real
current spend once, and it stores the difference as an offset applied to every reading until the
billing cycle rolls over.

```
💰 $190/$200 (95%)
```

## Install

Requires [`uv`](https://docs.astral.sh/uv/) and Node.js (for `ccusage` via `npx`).

```bash
# Persistent — puts `budget` on your PATH (recommended for the statusline):
uv tool install git+https://github.com/frank-bee/claude-budget

# Or run ad-hoc without installing:
uvx --from git+https://github.com/frank-bee/claude-budget budget --help
```

## Usage

```bash
budget refresh          # recompute spend via ccusage + offset, write the cache line
budget calibrate 190    # anchor displayed spend to $190 (your real bill) this cycle
budget line             # print the cached statusline segment (fast, no ccusage call)
budget config get       # show current config
budget config set max 250
budget config set cycle_start_day 8
```

### Calibration

`ccusage` undercounts. When you check your actual spend on the Anthropic billing page, run:

```bash
budget calibrate <real_amount>
```

The tool reads ccusage's current figure and stores `offset = real_amount − ccusage_now`.
From then on, `budget refresh` shows `ccusage + offset`. The offset is tagged with the current
billing cycle and is **automatically dropped when the cycle rolls over**, so a stale anchor never
carries into a new month — just re-calibrate when you next check the bill.

## Configuration

`~/.config/claude-budget/config.toml` (auto-created defaults shown):

```toml
max = 200.0                          # budget ceiling in $
cycle_start_day = 8                  # billing-cycle reset day-of-month
exclude_models = ["claude-fable-5"]  # ccusage overstates fable pricing
```

State (offset + cached line) lives under `~/.local/state/claude-budget/`.

## Statusline integration

`claude-budget` never blocks the statusline: the render just prints the cached line
(`budget line`), and a background `budget refresh` updates the cache when it goes stale. Example
snippet for your `statusline.sh`:

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
  ( budget refresh >/dev/null 2>&1 & disown ) 2>/dev/null
fi

budget_part=$(budget line 2>/dev/null)
```

`stat -f %m` is the macOS/BSD form; on GNU/Linux use `stat -c %Y`.

## License

MIT
