"""`budget` command-line entry point.

Subcommands:
  refresh          recompute spend via ccusage + offset, write the cache line
  calibrate AMOUNT anchor displayed spend to AMOUNT (your real bill) this cycle
  line             print the cached statusline segment (fast, no ccusage)
  config get|set   read or edit config values (max, cycle_start_day)
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from . import core


def _today() -> date:
    return date.today()


def _current_cycle(cfg: core.Config) -> tuple[date, str]:
    start = core.cycle_start(_today(), cfg.cycle_start_day)
    return start, core.cycle_id(start)


def cmd_refresh(_args: argparse.Namespace) -> int:
    cfg = core.load_config()
    start, cid = _current_cycle(cfg)
    offset = core.load_offset(cid)
    cost = core.ccusage_cost(start, cfg.exclude_models)
    line = core.format_line(cost + offset, cfg)
    core.write_cache(line)
    print(line)
    return 0


def cmd_calibrate(args: argparse.Namespace) -> int:
    cfg = core.load_config()
    start, cid = _current_cycle(cfg)
    cost = core.ccusage_cost(start, cfg.exclude_models)
    offset = args.amount - cost
    core.save_offset(offset, cid)
    line = core.format_line(cost + offset, cfg)
    core.write_cache(line)
    print(
        f"Anchored to ${args.amount:.2f} (ccusage ${cost:.2f}, "
        f"offset ${offset:+.2f}) for cycle {cid}"
    )
    print(line)
    return 0


def cmd_line(_args: argparse.Namespace) -> int:
    cached = core.read_cache()
    if cached:
        print(cached)
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    cfg = core.load_config()
    if args.action == "get":
        print(f"max = {cfg.max}")
        print(f"cycle_start_day = {cfg.cycle_start_day}")
        print(f"exclude_models = {cfg.exclude_models}")
        return 0
    # set
    key, raw = args.key, args.value
    if key not in core._NUMERIC_KEYS:
        settable = ", ".join(core._NUMERIC_KEYS)
        print(f"error: can only set: {settable}", file=sys.stderr)
        return 2
    caster = core._NUMERIC_KEYS[key]
    try:
        value = caster(raw)
    except ValueError:
        print(f"error: {key} must be {caster.__name__}", file=sys.stderr)
        return 2
    setattr(cfg, key, value)
    core.write_config(cfg)
    print(f"{key} = {value}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="budget", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("refresh", help="recompute spend and write the cache line")

    p_cal = sub.add_parser("calibrate", help="anchor displayed spend to your real bill")
    p_cal.add_argument("amount", type=float, help="real current spend in $")

    sub.add_parser("line", help="print the cached statusline segment")

    p_cfg = sub.add_parser("config", help="read or edit config")
    cfg_sub = p_cfg.add_subparsers(dest="action", required=True)
    cfg_sub.add_parser("get", help="print current config")
    p_set = cfg_sub.add_parser("set", help="set a config value")
    p_set.add_argument("key", help="max | cycle_start_day")
    p_set.add_argument("value", help="new value")

    return parser


_DISPATCH = {
    "refresh": cmd_refresh,
    "calibrate": cmd_calibrate,
    "line": cmd_line,
    "config": cmd_config,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return _DISPATCH[args.cmd](args)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
