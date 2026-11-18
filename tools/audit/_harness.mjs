import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const APP_VERSION = '0.3.0';
export const COMMIT = 'fbb401d';
export const BASELINE_PATH = join(ROOT, 'tools/audit/baseline/0.2.0.json');

const PHYSICS_FILES = [
  'src/js/00-core.js',
  'src/js/03-suspension.js',
  'src/js/05-body-dynamics.js'
];

const BASE_EXPORTS = [
  'THREE',
  'computeStatic', 'computeBodyInertia', 'runSelfTests', 'DEFAULTS', 'NUM_LIMITS', 'GRAVITY',
  'suspSolveCorner', 'suspensionBuild', 'suspRackForSteer', 'suspWheelSteer',
  'suspDesign', 'suspRockerPoint', 'suspRockerAngle', 'suspCoilLength',
  'suspEval', 'suspSolveRaw',
  'simCreate', 'simReset', 'simStep', 'simRunFor', 'simAdvance', 'simBuildModel',
  'simApplyImpulse', 'simEvaluate', 'simIntegrate', 'simActiveImpulse', 'runDynamicSelfTests',
  'simQuatFromEuler', 'simEulerFromQuat', 'simQuatRotate', 'simQuatRotateInverse',
  'simQuatNormalize', 'simCross',
  'SIM_DT', 'SIM_MAX_SUBSTEPS', 'SIM_MAX_FRAME_DT', 'SIM_REST_SPEED', 'SIM_IMPULSE_SECONDS'
];

export function loadThree() {
  const source = readFileSync(join(ROOT, 'vendor/three.min.js'), 'utf8');
  const threeModule = { exports: {} };
  new Function('module', 'exports', 'globalThis', source + '\n;')
    .call(threeModule.exports, threeModule, threeModule.exports, globalThis);
  return threeModule.exports;
}

export function loadPhysics(extraExports = []) {
  const source = PHYSICS_FILES.map((file) => readFileSync(join(ROOT, file), 'utf8')).join('\n');
  const names = Array.from(new Set(BASE_EXPORTS.concat(extraExports)));
  const fields = names.map((name) => name + ': typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined');
  const factory = new Function('THREE', 'localStorage', source + '\nreturn {' + fields.join(',') + '};');
  return factory(loadThree(), { getItem: () => null, setItem: () => {} });
}

export function makeSetup(api, patch = {}) {
  return Object.assign({}, api.DEFAULTS, patch);
}

export function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function maxAbs(values) {
  return Math.max.apply(null, values.map((value) => Math.abs(value)));
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) throw new Error('baseline not found: ' + path);
  return readJson(path);
}

function checkStatus(ok) {
  return ok ? 'pass' : 'fail';
}

export function compareReportToBaseline(report, baseline, options = {}) {
  const subset = Boolean(options.subset);
  const expected = baseline.checks || {};
  const mismatches = [];
  const seen = new Set();
  for (const item of report.checks || []) {
    seen.add(item.id);
    const want = expected[item.id];
    if (!want) {
      mismatches.push({ id: item.id, reason: 'missing-in-baseline', observed: checkStatus(item.ok) });
      continue;
    }
    if (want.status !== checkStatus(item.ok)) {
      mismatches.push({ id: item.id, reason: 'status-diff', expected: want.status, observed: checkStatus(item.ok) });
    }
  }
  if (!subset) {
    for (const id of Object.keys(expected)) {
      if (!seen.has(id)) mismatches.push({ id, reason: 'missing-in-report', expected: expected[id].status });
    }
  }
  return { pass: mismatches.length === 0, mismatches };
}

export function createAudit(meta) {
  const checks = [];
  const skips = [];
  let error = null;
  function check(id, ok, metrics = {}, threshold = '', detail = '') {
    checks.push({ id, ok: Boolean(ok), metrics, threshold, detail });
  }
  function skip(id, reason) {
    skips.push({ id, reason });
  }
  function fail(err) {
    error = err && err.stack ? err.stack : String(err);
  }
  function report() {
    return {
      schema: 1,
      audit: meta.audit,
      title: meta.title || meta.audit,
      group: meta.group || null,
      appVersion: APP_VERSION,
      commit: COMMIT,
      generatedAt: new Date().toISOString(),
      skipped: skips,
      error,
      checks,
      pass: !error && skips.length === 0 && checks.length > 0 && checks.every((item) => item.ok)
    };
  }
  return { check, skip, fail, report };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    expectBaseline: false,
    updateBaseline: false,
    baselinePath: BASELINE_PATH,
    group: null,
    requirePass: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--expect-baseline') args.expectBaseline = true;
    else if (arg === '--update-baseline') args.updateBaseline = true;
    else if (arg === '--require-pass') args.requirePass = true;
    else if (arg === '--group') {
      args.group = argv[i + 1] || null;
      i += 1;
    } else if (arg.startsWith('--group=')) args.group = arg.slice('--group='.length);
    else if (arg === '--baseline') {
      args.baselinePath = argv[i + 1] || BASELINE_PATH;
      i += 1;
    } else if (arg.startsWith('--baseline=')) args.baselinePath = arg.slice('--baseline='.length);
  }
  return args;
}

function printHuman(report, baseline) {
  const lines = [];
  lines.push('[' + report.audit + '] ' + (report.pass ? 'PASS' : 'FAIL'));
  for (const item of report.checks) {
    lines.push((item.ok ? '  ok   ' : '  FAIL ') + item.id + (item.detail ? '  [' + item.detail + ']' : ''));
  }
  for (const item of report.skipped || []) lines.push('  SKIP ' + item.id + '  [' + item.reason + ']');
  if (report.error) lines.push('  ERROR ' + report.error.split('\n')[0]);
  if (baseline) {
    lines.push('  baseline: ' + (baseline.pass ? 'match' : 'mismatch'));
    for (const item of baseline.mismatches) lines.push('    ' + item.id + ' ' + item.reason);
  }
  console.error(lines.join('\n'));
}

export async function runAudit(meta, fn) {
  const args = parseArgs();
  const audit = createAudit(meta);
  try {
    await fn(audit, args);
  } catch (error) {
    audit.fail(error);
  }
  let baseline = null;
  if (args.expectBaseline) {
    try {
      baseline = compareReportToBaseline(audit.report(), loadBaseline(args.baselinePath), { subset: true });
    } catch (error) {
      audit.fail(error);
    }
  }
  const report = audit.report();
  let code = report.error ? 2 : report.pass ? 0 : 1;
  if (args.expectBaseline) code = report.error ? 2 : baseline && baseline.pass ? 0 : 1;
  const output = Object.assign({}, report, baseline ? { baseline } : {});
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (!args.json) printHuman(output, baseline);
  process.exitCode = code;
  return output;
}
