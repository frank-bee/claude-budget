import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as core from "../src/core.js";

describe("clampDay / cycleStart", () => {
  test("clamps to the last day of a short month (Feb, non-leap)", () => {
    // cycle_start_day 31, today Feb 20 2027 (non-leap) -> clamp to Feb 28,
    // today.day(20) < 28 -> previous cycle: Jan 31.
    const start = core.cycleStart(new Date(2027, 1, 20), 31);
    assert.equal(start.getFullYear(), 2027);
    assert.equal(start.getMonth(), 0); // January
    assert.equal(start.getDate(), 31);
  });

  test("clamps to Feb 29 on a leap year when today is on/after it", () => {
    const start = core.cycleStart(new Date(2028, 1, 29), 31); // 2028 is a leap year
    assert.equal(start.getMonth(), 1); // February
    assert.equal(start.getDate(), 29);
  });

  test("stays in the current month when today >= cycle_start_day", () => {
    const start = core.cycleStart(new Date(2026, 6, 8), 8); // July 8 2026
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 6);
    assert.equal(start.getDate(), 8);
  });

  test("rolls back to the previous month when today < cycle_start_day", () => {
    const start = core.cycleStart(new Date(2026, 6, 7), 8); // July 7 2026
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 5); // June
    assert.equal(start.getDate(), 8);
  });

  test("rolls back across a year boundary in January", () => {
    const start = core.cycleStart(new Date(2026, 0, 3), 8); // Jan 3 2026
    assert.equal(start.getFullYear(), 2025);
    assert.equal(start.getMonth(), 11); // December
    assert.equal(start.getDate(), 8);
  });
});

describe("cycleId", () => {
  test("zero-pads month", () => {
    assert.equal(core.cycleId(new Date(2026, 0, 8)), "2026-01");
    assert.equal(core.cycleId(new Date(2026, 10, 8)), "2026-11");
  });
});

describe("formatLine", () => {
  test("uses the money icon under budget", () => {
    assert.equal(core.formatLine(50, { max: 200 }), "💰 $50/$200 (25%)");
  });

  test("uses the red icon at or above 100%", () => {
    assert.equal(core.formatLine(200, { max: 200 }), "🔴 $200/$200 (100%)");
    assert.equal(core.formatLine(250, { max: 200 }), "🔴 $250/$200 (125%)");
  });

  test("rounds displayed/pct to whole numbers", () => {
    assert.equal(core.formatLine(184.98, { max: 323 }), "💰 $185/$323 (57%)");
  });

  test("guards against a zero max", () => {
    assert.equal(core.formatLine(10, { max: 0 }), "💰 $10/$0 (0%)");
  });
});

describe("sumCost", () => {
  test("sums cost across months and model breakdowns", () => {
    const data = {
      monthly: [
        { modelBreakdowns: [{ modelName: "a", cost: 1.5 }, { modelName: "b", cost: 2.5 }] },
        { modelBreakdowns: [{ modelName: "a", cost: 3.0 }] },
      ],
    };
    assert.equal(core.sumCost(data, []), 7.0);
  });

  test("excludes named models", () => {
    const data = {
      monthly: [{ modelBreakdowns: [{ modelName: "claude-fable-5", cost: 100 }, { modelName: "x", cost: 5 }] }],
    };
    assert.equal(core.sumCost(data, ["claude-fable-5"]), 5);
  });

  test("tolerates missing monthly/modelBreakdowns/cost", () => {
    assert.equal(core.sumCost({}, []), 0);
    assert.equal(core.sumCost({ monthly: [{}] }, []), 0);
    assert.equal(core.sumCost({ monthly: [{ modelBreakdowns: [{ modelName: "a" }] }] }, []), 0);
  });
});

describe("config + offset roundtrip (isolated XDG dirs)", () => {
  function withTempEnv(fn) {
    const dir = mkdtempSync(join(tmpdir(), "claude-budget-test-"));
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    process.env.XDG_CONFIG_HOME = join(dir, "config");
    process.env.XDG_STATE_HOME = join(dir, "state");
    try {
      fn();
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("loadConfig returns defaults when no file exists", () => {
    withTempEnv(() => {
      const cfg = core.loadConfig();
      assert.deepEqual(cfg, core.DEFAULT_CONFIG);
    });
  });

  test("writeConfig then loadConfig roundtrips", () => {
    withTempEnv(() => {
      core.writeConfig({ max: 323, cycle_start_day: 8, exclude_models: ["claude-fable-5"] });
      const cfg = core.loadConfig();
      assert.equal(cfg.max, 323);
      assert.equal(cfg.cycle_start_day, 8);
      assert.deepEqual(cfg.exclude_models, ["claude-fable-5"]);
    });
  });

  test("loadOffset returns 0 for a cycle that doesn't match the stored one", () => {
    withTempEnv(() => {
      core.saveOffset(10.02, "2026-06");
      assert.equal(core.loadOffset("2026-07"), 0);
      assert.equal(core.loadOffset("2026-06"), 10.02);
    });
  });

  test("loadOffset returns 0 on malformed offset file", () => {
    withTempEnv(() => {
      core.saveOffset(5, "2026-07");
      writeFileSync(core.offsetPath(), "not json");
      assert.equal(core.loadOffset("2026-07"), 0);
    });
  });
});
