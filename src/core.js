/**
 * Core logic: config/state paths, cycle math, ccusage invocation, offset, cache.
 *
 * The displayed spend is `ccusageCost + offset`. ccusage only sees Claude
 * Code's local logs, so it undercounts the real Anthropic bill (Claude Desktop,
 * other clients). `calibrate` anchors the number to reality by storing the
 * difference between a hand-entered real spend and ccusage's current figure. The
 * offset is scoped to a billing cycle and is treated as 0 once the cycle rolls
 * over, so a stale anchor never leaks into a new month.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CCUSAGE_ARGS = ["ccusage@latest", "claude", "monthly", "--json"];

export const DEFAULT_CONFIG = {
  max: 200.0,
  cycle_start_day: 8,
  exclude_models: ["claude-fable-5"],
};

// Keys a hand-editable config may set via `config set`.
export const NUMERIC_KEYS = {
  max: (raw) => {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error("max must be a float");
    return n;
  },
  cycle_start_day: (raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new Error("cycle_start_day must be an int");
    return n;
  },
};

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "claude-budget");
}

export function stateDir() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "claude-budget");
}

export function configPath() {
  return join(configDir(), "config.json");
}

export function offsetPath() {
  return join(stateDir(), "offset.json");
}

export function cachePath() {
  return join(stateDir(), "statusline-cache");
}

// --- config -----------------------------------------------------------------

export function loadConfig() {
  const data = { ...DEFAULT_CONFIG };
  const path = configPath();
  if (existsSync(path)) {
    try {
      Object.assign(data, JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // malformed config: fall back to defaults for the bad keys
    }
  }
  return {
    max: Number(data.max),
    cycle_start_day: Number(data.cycle_start_day),
    exclude_models: [...data.exclude_models],
  };
}

/** Serialize the known keys back to JSON. Unknown keys are intentionally not
 * round-tripped, matching the previous TOML writer's behavior. */
export function writeConfig(cfg) {
  mkdirSync(configDir(), { recursive: true });
  const out = {
    max: cfg.max,
    cycle_start_day: cfg.cycle_start_day,
    exclude_models: cfg.exclude_models,
  };
  writeFileSync(configPath(), `${JSON.stringify(out, null, 2)}\n`);
}

// --- billing cycle ------------------------------------------------------------

function clampDay(year, month, day) {
  // `month` is 1-indexed; Date(year, month, 0) rolls back to month's last day.
  const last = new Date(year, month, 0).getDate();
  return Math.min(day, last);
}

/** Start date of the billing cycle containing `today`. */
export function cycleStart(today, cycleStartDay) {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = clampDay(year, month, cycleStartDay);
  if (today.getDate() >= day) {
    return new Date(year, month - 1, day);
  }
  // Cycle began on cycle_start_day of the previous month.
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return new Date(prevYear, prevMonth - 1, clampDay(prevYear, prevMonth, cycleStartDay));
}

export function cycleId(start) {
  const y = String(start.getFullYear()).padStart(4, "0");
  const m = String(start.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// --- ccusage ------------------------------------------------------------------

/** Sum ccusage's reported cost since `since`, excluding given models. */
export function ccusageCost(since, excludeModels) {
  const sinceStr =
    `${since.getFullYear()}` +
    `${String(since.getMonth() + 1).padStart(2, "0")}` +
    `${String(since.getDate()).padStart(2, "0")}`;
  const args = [...CCUSAGE_ARGS, "--since", sinceStr];
  const proc = spawnSync("npx", args, { encoding: "utf8" });

  if (proc.error) {
    if (proc.error.code === "ENOENT") {
      throw new Error("npx not found; Node.js is required to run ccusage");
    }
    throw new Error(`ccusage failed: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(`ccusage failed: ${(proc.stderr || "").trim()}`);
  }

  return sumCost(JSON.parse(proc.stdout), excludeModels);
}

/** Sum `monthly[].modelBreakdowns[].cost` from a parsed ccusage report, skipping
 * excluded models. Pulled out of `ccusageCost` so it's testable without a subprocess. */
export function sumCost(data, excludeModels) {
  const excluded = new Set(excludeModels);
  let total = 0.0;
  for (const month of data.monthly ?? []) {
    for (const bd of month.modelBreakdowns ?? []) {
      if (excluded.has(bd.modelName)) continue;
      total += bd.cost ?? 0.0;
    }
  }
  return total;
}

// --- offset ---------------------------------------------------------------------

/** Stored offset if it belongs to the current cycle, else 0 (auto-reset). */
export function loadOffset(currentCycle) {
  const path = offsetPath();
  if (!existsSync(path)) return 0.0;
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0.0;
  }
  if (data.cycle !== currentCycle) return 0.0;
  return Number(data.value ?? 0.0);
}

export function saveOffset(value, currentCycle) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(offsetPath(), JSON.stringify({ value, cycle: currentCycle }));
}

// --- cache line -------------------------------------------------------------------

export function formatLine(displayed, cfg) {
  const pct = cfg.max ? (displayed / cfg.max) * 100 : 0.0;
  const icon = pct >= 100 ? "🔴" : "💰";
  return `${icon} $${displayed.toFixed(0)}/$${cfg.max.toFixed(0)} (${pct.toFixed(0)}%)`;
}

export function writeCache(line) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(cachePath(), line);
}

export function readCache() {
  try {
    return readFileSync(cachePath(), "utf8").trim();
  } catch {
    return "";
  }
}
