#!/usr/bin/env node
/**
 * Performance bench for the physics/runtime hot paths.
 *
 * The script is intentionally self-contained: it loads the same browser
 * sources as the audit harness and does not add a runtime dependency.
 *
 * Usage:
 *   node tools/bench.mjs             human readable table
 *   node tools/bench.mjs --json      machine readable JSON only
 *   BENCH_ITERS=500 node tools/bench.mjs
 *
 * The default sample count is 200.  Fast operations are timed in batches so
 * that a single GC pause does not dominate the mean; each metric still
 * reports per-iteration mean, median and p95.
 */

import { readFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { loadPhysics, loadThree, makeSetup, ROOT } from './audit/_harness.mjs';
import { join } from 'node:path';

const DEFAULT_ITERS = 200;
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
const requestedIters = Number(process.env.BENCH_ITERS || DEFAULT_ITERS);
const ITERS = Number.isFinite(requestedIters) && requestedIters >= 200 ? Math.floor(requestedIters) : DEFAULT_ITERS;

const BUDGETS = {
  singleSubstepMs: 0.05,
  suspEvalPerStep: 30,
  simBuildModelMs: 0.05,
  computeStaticMs: 8,
  simCreateMs: 60
};

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function quantile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    samples: sorted.length,
    mean: sum / sorted.length,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

function measureBatches(fn, { samples = ITERS, batch = 1, warmup = 20 } = {}) {
  for (let i = 0; i < warmup; i += 1) fn();
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const start = nowMs();
    for (let j = 0; j < batch; j += 1) fn();
    values.push((nowMs() - start) / batch);
  }
  return Object.assign(summarize(values), { iterations: samples * batch, batch });
}

function measureEach(fn, { samples = ITERS, warmup = 2 } = {}) {
  for (let i = 0; i < warmup; i += 1) fn();
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const start = nowMs();
    fn();
    values.push(nowMs() - start);
  }
  return Object.assign(summarize(values), { iterations: samples, batch: 1 });
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function cleanStats(stats) {
  return {
    samples: stats.samples,
    iterations: stats.iterations,
    batch: stats.batch,
    mean: round(stats.mean),
    median: round(stats.median),
    p95: round(stats.p95),
    min: round(stats.min),
    max: round(stats.max)
  };
}

function medianOf(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const api = loadPhysics([
  'suspEvalCount',
  'suspEvalReset',
  'runDynamicSelfTests',
  'SIM_DT'
]);
const setup = makeSetup(api);
const THREE = loadThree();

/* ------------------------------------------------------------------ */
/* 1. single physics substep and suspEval counts                       */
/* ------------------------------------------------------------------ */

const stepSim = api.simCreate(setup, { settle: 2 });
const stepStats = measureBatches(() => api.simStep(stepSim), { samples: ITERS, batch: 200, warmup: 100 });

const evalCounts = [];
for (let i = 0; i < ITERS; i += 1) {
  api.suspEvalReset();
  for (let j = 0; j < 100; j += 1) api.simStep(stepSim);
  evalCounts.push(api.suspEvalCount() / 100);
}
const evalStats = summarize(evalCounts);

/* ------------------------------------------------------------------ */
/* 2. simBuildModel: cold start, cold steady, hot steady               */
/* ------------------------------------------------------------------ */

const coldStarts = [];
for (let round = 0; round < 3; round += 1) {
  const fresh = api.simCreate(setup, { settle: 0 });
  const start = nowMs();
  api.simBuildModel(fresh);
  coldStarts.push(nowMs() - start);
}

const coldRounds = [];
for (let round = 0; round < 3; round += 1) {
  const fresh = api.simCreate(setup, { settle: 0 });
  coldRounds.push(measureBatches(() => api.simBuildModel(fresh), {
    samples: ITERS,
    batch: 20,
    warmup: 0
  }));
}

const hotSim = api.simCreate(setup, { settle: 0 });
for (let i = 0; i < 1000; i += 1) api.simBuildModel(hotSim);
const hotRounds = [];
for (let round = 0; round < 3; round += 1) {
  hotRounds.push(measureBatches(() => api.simBuildModel(hotSim), {
    samples: ITERS,
    batch: 20,
    warmup: 100
  }));
}

const coldMedians = coldRounds.map((roundStats) => roundStats.median);
const hotMedians = hotRounds.map((roundStats) => roundStats.median);
const coldStable = medianOf(coldMedians);
const hotStable = medianOf(hotMedians);

/* ------------------------------------------------------------------ */
/* 3. setup/model construction costs                                   */
/* ------------------------------------------------------------------ */

const computeStats = measureBatches(() => api.computeStatic(setup), {
  samples: ITERS,
  batch: 5,
  warmup: 10
});
const createStats = measureEach(() => api.simCreate(setup, { settle: 1.5 }), {
  samples: ITERS,
  warmup: 2
});

/* ------------------------------------------------------------------ */
/* 4. self-tests and cache behaviour                                   */
/* ------------------------------------------------------------------ */

const staticStats = measureEach(() => api.runSelfTests(setup), {
  samples: ITERS,
  warmup: 2
});
const dynamicStats = measureEach(() => api.runDynamicSelfTests(setup), {
  samples: ITERS,
  warmup: 1
});

let staticCache = { available: false, calls: 0, runs: 0, pass: null };
try {
  const uiSource = readFileSync(join(ROOT, 'src/js/30-ui.js'), 'utf8');
  let calls = 0;
  const factory = new Function('THREE', 'state', 'runSelfTests', uiSource + '\nreturn { ensureStaticSelfTests, UI };');
  const ui = factory(THREE, setup, () => {
    calls += 1;
    return api.runSelfTests(setup);
  });
  const first = ui.ensureStaticSelfTests();
  const second = ui.ensureStaticSelfTests();
  staticCache = {
    available: true,
    calls,
    runs: ui.UI.selfTestCache.runs.static,
    tests: second.length,
    stable: first === second,
    pass: calls === 1 && ui.UI.selfTestCache.runs.static === 1 && second.length === first.length && first === second
  };
} catch (error) {
  staticCache = { available: false, error: error.message, pass: null };
}

/* ------------------------------------------------------------------ */
/* 5. result / budget checks                                           */
/* ------------------------------------------------------------------ */

const metrics = {
  singleSubstep: Object.assign(cleanStats(stepStats), {
    unit: 'ms',
    budget: BUDGETS.singleSubstepMs
  }),
  suspEvalPerStep: {
    unit: 'count',
    samples: evalStats.samples,
    mean: round(evalStats.mean, 3),
    median: round(evalStats.median, 3),
    p95: round(evalStats.p95, 3),
    min: round(evalStats.min, 3),
    max: round(evalStats.max, 3),
    budget: BUDGETS.suspEvalPerStep
  },
  simBuildModel: {
    unit: 'ms',
    budget: BUDGETS.simBuildModelMs,
    coldStart: coldStarts.map((value) => round(value)),
    coldRounds: coldRounds.map((stats) => cleanStats(stats)),
    hotRounds: hotRounds.map((stats) => cleanStats(stats)),
    coldStable: round(coldStable),
    hotStable: round(hotStable),
    hotMean: round(hotRounds.reduce((sum, stats) => sum + stats.mean, 0) / hotRounds.length),
    hotP95: round(Math.max(...hotRounds.map((stats) => stats.p95)))
  },
  computeStatic: Object.assign(cleanStats(computeStats), {
    unit: 'ms',
    budget: BUDGETS.computeStaticMs
  }),
  simCreate: Object.assign(cleanStats(createStats), {
    unit: 'ms',
    budget: BUDGETS.simCreateMs,
    settle: 1.5
  }),
  staticSelfTests: Object.assign(cleanStats(staticStats), {
    unit: 'ms',
    budget: null,
    note: 'raw runSelfTests (cache miss); hit path checked below'
  }),
  dynamicSelfTests: Object.assign(cleanStats(dynamicStats), {
    unit: 'ms',
    budget: null,
    count: 10,
    note: 'run on demand only; must not run on the periodic frame path'
  }),
  staticCache
};

const checks = [
  {
    id: 'singleSubstep',
    label: '单子步',
    value: metrics.singleSubstep.median,
    unit: 'ms',
    budget: BUDGETS.singleSubstepMs,
    pass: metrics.singleSubstep.median <= BUDGETS.singleSubstepMs
  },
  {
    id: 'suspEvalPerStep',
    label: '每子步 suspEval',
    value: metrics.suspEvalPerStep.max,
    unit: '次',
    budget: BUDGETS.suspEvalPerStep,
    pass: metrics.suspEvalPerStep.max <= BUDGETS.suspEvalPerStep
  },
  {
    id: 'simBuildModel',
    label: '实时模型构建（热稳定）',
    value: metrics.simBuildModel.hotStable,
    unit: 'ms',
    budget: BUDGETS.simBuildModelMs,
    pass: metrics.simBuildModel.hotStable <= BUDGETS.simBuildModelMs
  },
  {
    id: 'computeStatic',
    label: 'computeStatic',
    value: metrics.computeStatic.median,
    unit: 'ms',
    budget: BUDGETS.computeStaticMs,
    pass: metrics.computeStatic.median <= BUDGETS.computeStaticMs
  },
  {
    id: 'simCreate',
    label: 'simCreate',
    value: metrics.simCreate.median,
    unit: 'ms',
    budget: BUDGETS.simCreateMs,
    pass: metrics.simCreate.median <= BUDGETS.simCreateMs
  },
  {
    id: 'staticCache',
    label: '静态自检缓存命中',
    value: staticCache.calls > 0 ? staticCache.calls - 1 : 0,
    unit: '次重跑',
    budget: 0,
    pass: staticCache.pass === true
  }
];

const pass = checks.every((check) => check.pass);

const result = {
  schema: 'formula-simulator/bench@1',
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus().length ? cpus()[0].model : 'unknown',
    iterations: ITERS
  },
  budgets: BUDGETS,
  metrics,
  checks,
  pass,
  notes: [
    'Fast metrics are timed as batch means; every metric uses at least 200 samples.',
    'coldStart = first simBuildModel on a fresh sim (null corner seeds); coldRounds = fresh sim each round; hotRounds = same sim after 1000 warm builds.',
    'staticCache loads 30-ui.js with a stubbed runSelfTests and verifies the second ensureStaticSelfTests() call does not rerun it.',
    'Dynamic self-tests are measured on demand; they are not called by simStep/simBuildModel and must stay off the periodic frame path.'
  ]
};

function fmt(value, digits = 4) {
  if (value === null || value === undefined) return '-';
  if (!Number.isFinite(value)) return String(value);
  return Number(value).toFixed(digits);
}

function printHuman() {
  console.log('formula-simulator bench');
  console.log('node ' + process.version + '  ' + platform() + '/' + arch() + '  samples=' + ITERS);
  console.log('');
  console.log('指标                                      mean        median      p95         budget      结果');
  console.log('----------------------------------------  ----------  ----------  ----------  ----------  ----');
  for (const check of checks) {
    const metric = check.id === 'simBuildModel' ? metrics.simBuildModel : metrics[check.id];
    const mean = check.id === 'simBuildModel' ? metrics.simBuildModel.hotMean : metric.mean;
    const p95 = check.id === 'simBuildModel' ? metrics.simBuildModel.hotP95 : metric.p95;
    console.log(
      check.label.padEnd(40) +
      fmt(mean).padStart(10) + '  ' +
      fmt(check.value).padStart(10) + '  ' +
      fmt(p95).padStart(10) + '  ' +
      (check.budget === null ? '-' : fmt(check.budget)).padStart(10) + '  ' +
      (check.pass ? 'PASS' : 'FAIL')
    );
  }
  console.log('');
  console.log('simBuildModel  coldStart=' + metrics.simBuildModel.coldStart.map((v) => fmt(v)).join('/') +
    ' ms  coldStable=' + fmt(metrics.simBuildModel.coldStable) +
    ' ms  hotStable=' + fmt(metrics.simBuildModel.hotStable) + ' ms');
  console.log('静态自检        ' + fmt(metrics.staticSelfTests.median) + ' ms (cache miss), cache hit: ' +
    (staticCache.pass ? 'PASS' : 'FAIL') + ' (calls=' + staticCache.calls + ', runs=' + staticCache.runs + ')');
  console.log('动态自检        ' + fmt(metrics.dynamicSelfTests.median) + ' ms / ' +
    metrics.dynamicSelfTests.count + ' 项 (按需)');
  console.log('');
  console.log('总体: ' + (pass ? 'PASS' : 'FAIL') + '  (JSON: node tools/bench.mjs --json)');
}

const json = JSON.stringify(result, null, 2);
if (outPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, json + '\n');
}
if (jsonOnly) {
  console.log(json);
} else {
  printHuman();
}

if (!pass) process.exitCode = 1;
