"""Core logic: config/state paths, cycle math, ccusage invocation, offset, cache.

The displayed spend is ``ccusage_cost + offset``. ``ccusage`` only sees Claude
Code's local logs, so it undercounts the real Anthropic bill (Claude Desktop,
other clients). ``calibrate`` anchors the number to reality by storing the
difference between a hand-entered real spend and ccusage's current figure. The
offset is scoped to a billing cycle and is treated as 0 once the cycle rolls
over, so a stale anchor never leaks into a new month.
"""

from __future__ import annotations

import calendar
import json
import os
import subprocess
import tomllib
from dataclasses import dataclass
from datetime import date
from pathlib import Path

CCUSAGE_ARGS = ["npx", "ccusage@latest", "claude", "monthly", "--json"]

DEFAULT_CONFIG = {
    "max": 200.0,
    "cycle_start_day": 8,
    "exclude_models": ["claude-fable-5"],
}
# Keys a hand-editable float/int config may set via `budget config set`.
_NUMERIC_KEYS = {"max": float, "cycle_start_day": int}


def config_dir() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    return Path(base) / "claude-budget"


def state_dir() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or (Path.home() / ".local" / "state")
    return Path(base) / "claude-budget"


def config_path() -> Path:
    return config_dir() / "config.toml"


def offset_path() -> Path:
    return state_dir() / "offset.json"


def cache_path() -> Path:
    return state_dir() / "statusline-cache"


# --- config -----------------------------------------------------------------


@dataclass
class Config:
    max: float
    cycle_start_day: int
    exclude_models: list[str]


def load_config() -> Config:
    data = dict(DEFAULT_CONFIG)
    path = config_path()
    if path.exists():
        with path.open("rb") as fh:
            data.update(tomllib.load(fh))
    return Config(
        max=float(data["max"]),
        cycle_start_day=int(data["cycle_start_day"]),
        exclude_models=list(data["exclude_models"]),
    )


def write_config(cfg: Config) -> None:
    """Serialize the known keys back to TOML. Only these keys are persisted;
    unknown keys in an existing file are intentionally not round-tripped."""
    config_dir().mkdir(parents=True, exist_ok=True)
    models = ", ".join(f'"{m}"' for m in cfg.exclude_models)
    text = (
        f"max = {cfg.max}\n"
        f"cycle_start_day = {cfg.cycle_start_day}\n"
        f"exclude_models = [{models}]\n"
    )
    config_path().write_text(text)


# --- billing cycle ----------------------------------------------------------


def cycle_start(today: date, cycle_start_day: int) -> date:
    """Start date of the billing cycle containing ``today``."""
    day = _clamp_day(today.year, today.month, cycle_start_day)
    if today.day >= day:
        return date(today.year, today.month, day)
    # Cycle began on cycle_start_day of the previous month.
    year = today.year - 1 if today.month == 1 else today.year
    month = 12 if today.month == 1 else today.month - 1
    return date(year, month, _clamp_day(year, month, cycle_start_day))


def _clamp_day(year: int, month: int, day: int) -> int:
    last = calendar.monthrange(year, month)[1]
    return min(day, last)


def cycle_id(start: date) -> str:
    return f"{start.year:04d}-{start.month:02d}"


# --- ccusage ----------------------------------------------------------------


def ccusage_cost(since: date, exclude_models: list[str]) -> float:
    """Sum ccusage's reported cost since ``since``, excluding given models."""
    args = CCUSAGE_ARGS + ["--since", since.strftime("%Y%m%d")]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:  # npx missing
        raise RuntimeError("npx not found; Node.js is required to run ccusage") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ccusage failed: {exc.stderr.strip()}") from exc

    data = json.loads(proc.stdout)
    excluded = set(exclude_models)
    total = 0.0
    for month in data.get("monthly", []):
        for bd in month.get("modelBreakdowns", []):
            if bd.get("modelName") in excluded:
                continue
            total += bd.get("cost", 0.0)
    return total


# --- offset -----------------------------------------------------------------


def load_offset(current_cycle: str) -> float:
    """Stored offset if it belongs to the current cycle, else 0 (auto-reset)."""
    path = offset_path()
    if not path.exists():
        return 0.0
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return 0.0
    if data.get("cycle") != current_cycle:
        return 0.0
    return float(data.get("value", 0.0))


def save_offset(value: float, current_cycle: str) -> None:
    state_dir().mkdir(parents=True, exist_ok=True)
    offset_path().write_text(json.dumps({"value": value, "cycle": current_cycle}))


# --- cache line -------------------------------------------------------------


def format_line(displayed: float, cfg: Config) -> str:
    pct = (displayed / cfg.max * 100) if cfg.max else 0.0
    icon = "🔴" if pct >= 100 else "💰"
    return f"{icon} ${displayed:.0f}/${cfg.max:.0f} ({pct:.0f}%)"


def write_cache(line: str) -> None:
    state_dir().mkdir(parents=True, exist_ok=True)
    cache_path().write_text(line)


def read_cache() -> str:
    try:
        return cache_path().read_text().strip()
    except OSError:
        return ""
