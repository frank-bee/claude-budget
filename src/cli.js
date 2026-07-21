#!/usr/bin/env node
/**
 * `claude-budget-statusline` command-line entry point.
 *
 * Subcommands:
 *   refresh              recompute spend via ccusage + offset, write the cache line
 *   calibrate AMOUNT [MAX]  anchor displayed spend to AMOUNT (your real bill) this
 *                         cycle, and optionally set the budget ceiling in one step
 *   line                  print the cached statusline segment (fast, no ccusage)
 *   config get|set        read or edit config values (max, cycle_start_day)
 */

import * as core from "./core.js";

function today() {
  return new Date();
}

function currentCycle(cfg) {
  const start = core.cycleStart(today(), cfg.cycle_start_day);
  return [start, core.cycleId(start)];
}

function cmdRefresh() {
  const cfg = core.loadConfig();
  const [start, cid] = currentCycle(cfg);
  const offset = core.loadOffset(cid);
  const cost = core.ccusageCost(start, cfg.exclude_models);
  const line = core.formatLine(cost + offset, cfg);
  core.writeCache(line);
  console.log(line);
  return 0;
}

function cmdCalibrate(amount, max) {
  const cfg = core.loadConfig();
  const [start, cid] = currentCycle(cfg);
  const cost = core.ccusageCost(start, cfg.exclude_models);
  const offset = amount - cost;
  core.saveOffset(offset, cid);

  let maxNote = "";
  if (max !== undefined) {
    cfg.max = max;
    core.writeConfig(cfg);
    maxNote = `, max set to $${max.toFixed(2)}`;
  }

  const line = core.formatLine(cost + offset, cfg);
  core.writeCache(line);

  const sign = offset >= 0 ? "+" : "";
  console.log(
    `Anchored to $${amount.toFixed(2)} (ccusage $${cost.toFixed(2)}, ` +
      `offset $${sign}${offset.toFixed(2)}) for cycle ${cid}${maxNote}`,
  );
  console.log(line);
  return 0;
}

function cmdLine() {
  const cached = core.readCache();
  if (cached) console.log(cached);
  return 0;
}

function cmdConfigGet() {
  const cfg = core.loadConfig();
  console.log(`max = ${cfg.max}`);
  console.log(`cycle_start_day = ${cfg.cycle_start_day}`);
  console.log(`exclude_models = [${cfg.exclude_models.map((m) => `'${m}'`).join(", ")}]`);
  return 0;
}

function cmdConfigSet(key, raw) {
  const cfg = core.loadConfig();
  if (!(key in core.NUMERIC_KEYS)) {
    const settable = Object.keys(core.NUMERIC_KEYS).join(", ");
    console.error(`error: can only set: ${settable}`);
    return 2;
  }
  let value;
  try {
    value = core.NUMERIC_KEYS[key](raw);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }
  cfg[key] = value;
  core.writeConfig(cfg);
  console.log(`${key} = ${value}`);
  return 0;
}

function parseNumber(raw, label) {
  const n = Number(raw);
  if (raw === undefined || raw === "" || Number.isNaN(n)) {
    throw new Error(`${label} must be a number`);
  }
  return n;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case "refresh":
        return cmdRefresh();

      case "calibrate": {
        if (rest.length < 1) {
          console.error("error: calibrate requires an amount");
          return 2;
        }
        const amount = parseNumber(rest[0], "amount");
        const max = rest.length > 1 ? parseNumber(rest[1], "max") : undefined;
        return cmdCalibrate(amount, max);
      }

      case "line":
        return cmdLine();

      case "config": {
        const [action, ...cfgRest] = rest;
        if (action === "get") return cmdConfigGet();
        if (action === "set") {
          if (cfgRest.length < 2) {
            console.error("error: config set requires key and value");
            return 2;
          }
          return cmdConfigSet(cfgRest[0], cfgRest[1]);
        }
        console.error("error: config requires a get|set action");
        return 2;
      }

      default:
        console.error(
          `error: unknown command '${cmd ?? ""}'. Expected refresh|calibrate|line|config`,
        );
        return 2;
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
