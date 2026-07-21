#!/bin/bash
# claude-budget-statusline segment — cached read, non-blocking background refresh.
#
# Drop this block into an existing statusline.sh (append the resulting
# $budget_part into that script's own `parts` array / output composition), or
# use it standalone as the whole statusline.sh if the user has none yet.
#
# BIN resolves via PATH so it works whether the CLI was installed with
# `npm install -g` or is being run through `npx`.

BIN="claude-budget-statusline"
STATE_DIR="$HOME/.local/state/claude-budget"
CACHE_FILE="$STATE_DIR/statusline-cache"
TRIGGER_FILE="$STATE_DIR/last-refresh-trigger"
STALE_SECS=300

now=$(date +%s)
cache_age=$STALE_SECS
[ -f "$CACHE_FILE" ] && cache_age=$(( now - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
trigger_age=$STALE_SECS
[ -f "$TRIGGER_FILE" ] && trigger_age=$(( now - $(stat -f %m "$TRIGGER_FILE" 2>/dev/null || stat -c %Y "$TRIGGER_FILE" 2>/dev/null || echo 0) ))

if [ "$cache_age" -ge "$STALE_SECS" ] && [ "$trigger_age" -ge "$STALE_SECS" ]; then
  mkdir -p "$STATE_DIR"; touch "$TRIGGER_FILE"
  ( "$BIN" refresh >/dev/null 2>&1 & disown ) 2>/dev/null
fi

budget_part=$(cat "$CACHE_FILE" 2>/dev/null)

# Standalone usage: `echo "$budget_part"`
# Merged usage: append `$budget_part` (if non-empty) into the host script's
# existing `parts` array before it joins/prints them.
[ -n "$budget_part" ] && echo "$budget_part"
