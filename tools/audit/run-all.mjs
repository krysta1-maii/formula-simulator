#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASELINE_PATH, COMMIT, APP_VERSION, compareReportToBaseline, loadBaseline, writeJson } from './_harness.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPTS = [
  { file: 'tools/audit/audit-free-body.mjs', groups: ['physics'] },
  { file: 'tools/audit/audit-rocker-reach.mjs', groups: ['physics'] },
  { file: 'tools/audit/audit-seed-writeback.mjs', groups: ['physics'] },
  { file: 'tools/audit/audit-shadowing.mjs', groups: ['physics'] },
  { file: 'tools/audit/audit-friction-low-speed.mjs', groups: ['contact'] },
  { file: 'tools/audit/audit-impulse-frame.mjs', groups: ['contact'] },
  { file: 'tools/audit/audit-contact-gap.mjs', groups: ['contact'] },
  { file: 'tools/audit/audit-frame-time.mjs', groups: ['runtime'] },
  { file: 'tools/audit-browser/audit-browser-contract.mjs', groups: ['runtime', 'browser'], browser: true },
  { file: 'tools/audit-browser/audit-ui.mjs', groups: ['ui', 'browser'], browser: true }
];

const DEFECTS = {
  'B4.1': ['B4.1/'],
  'B4.2': ['B4.2/'],
  'B4.3': ['B4.3/'],
  'B4.4': ['B4.4/'],
  'B4.5': ['B4.5/'],
  'B5.1': ['B5.1/'],
  'B5.2': ['B5.2/'],
  'B5.3': ['B5.3/'],
  'B5.4': ['B5.4/'],
  'O1': ['O1/'],
  'A2': ['A2/'],
  'UI': ['U1/', 'U2/', 'U3/', 'U4/']
};

function parseArgs(argv) {
  const args = {
    json: false,
    group: 'all',
    expectBaseline: false,
    updateBaseline: false,
    baselinePath: BASELINE_PATH,
    requirePass: false,
    list: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--expect-baseline') args.expectBaseline = true;
    else if (arg === '--update-baseline') args.updateBaseline = true;
    else if (arg === '--require-pass') args.requirePass = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--group') {
      args.group = argv[i + 1] || 'all';
      i += 1;
    } else if (arg.startsWith('--group=')) args.group = arg.slice('--group='.length);
    else if (arg === '--baseline') {
      args.baselinePath = argv[i + 1] || BASELINE_PATH;
      i += 1;
    } else if (arg.startsWith('--baseline=')) args.baselinePath = arg.slice('--baseline='.length);
  }
  return args;
}

function selectedScripts(group) {
  return SCRIPTS.filter((script) => group === 'all' || script.groups.includes(group));
}

function runScript(script) {
  const absolute = join(ROOT, script.file);
  if (!existsSync(absolute)) {
    return { error: 'missing script: ' + script.file, report: null, stderr: '' };
  }
  const result = spawnSync(process.execPath, [absolute, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout || '');
  } catch (error) {
    return {
      error: 'cannot parse JSON from ' + script.file + ': ' + error.message,
      report: null,
      stderr: result.stderr || ''
    };
  }
  if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
    return {
      error: 'unexpected exit ' + result.status + ' from ' + script.file,
      report,
      stderr: result.stderr || ''
    };
  }
  return {
    error: result.status === 2 || report.error ? report.error || 'audit error' : null,
    report,
    stderr: result.stderr || ''
  };
}

function buildBaseline(reports) {
  const checks = {};
  const knownFailures = [];
  for (const report of reports) {
    for (const item of report.checks || []) {
      checks[item.id] = {
        audit: report.audit,
        group: report.group,
        status: item.ok ? 'pass' : 'fail',
        knownFailure: !item.ok,
        observed: item.metrics,
        threshold: item.threshold,
        detail: item.detail
      };
      if (!item.ok) knownFailures.push(item.id);
    }
  }
  const defectEvidence = {};
  for (const [defect, prefixes] of Object.entries(DEFECTS)) {
    const ids = Object.keys(checks).filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));
    defectEvidence[defect] = {
      checks: ids,
      failing: ids.filter((id) => checks[id].status === 'fail')
    };
  }
  return {
    schema: 1,
    appVersion: APP_VERSION,
    commit: COMMIT,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      chrome: process.env.CHROME_PATH || 'auto'
    },
    knownFailures,
    defectEvidence,
    checks
  };
}

function compareAllToBaseline(reports, baseline) {
  const mismatches = [];
  const seen = new Set();
  for (const report of reports) {
    for (const item of report.checks || []) {
      seen.add(item.id);
      const expected = baseline.checks && baseline.checks[item.id];
      if (!expected) {
        mismatches.push({ id: item.id, reason: 'missing-in-baseline', observed: item.ok ? 'pass' : 'fail' });
        continue;
      }
      const observed = item.ok ? 'pass' : 'fail';
      if (expected.status !== observed) {
        mismatches.push({ id: item.id, reason: 'status-diff', expected: expected.status, observed });
      }
    }
  }
  for (const id of Object.keys(baseline.checks || {})) {
    if (!seen.has(id)) mismatches.push({ id, reason: 'missing-in-report' });
  }
  return { pass: mismatches.length === 0, mismatches };
}

function printHuman(aggregate) {
  const lines = [];
  lines.push('[audit] ' + (aggregate.pass ? 'PASS' : 'FAIL') + '  ' + aggregate.checks.length + ' checks');
  for (const audit of aggregate.audits) {
    const failed = audit.checks.filter((item) => !item.ok).length;
    lines.push('  ' + (failed ? 'FAIL ' : 'ok   ') + audit.audit + '  ' + audit.checks.length + ' checks, ' + failed + ' failed');
    for (const item of audit.checks.filter((entry) => !entry.ok)) {
      lines.push('    FAIL ' + item.id + (item.detail ? '  [' + item.detail + ']' : ''));
    }
  }
  if (aggregate.errors.length) {
    for (const error of aggregate.errors) lines.push('  ERROR ' + error);
  }
  if (aggregate.baseline) {
    lines.push('  baseline: ' + (aggregate.baseline.pass ? 'match' : 'mismatch'));
    for (const mismatch of aggregate.baseline.mismatches) {
      lines.push('    ' + mismatch.id + ' ' + mismatch.reason);
    }
  }
  console.error(lines.join('\n'));
}

const args = parseArgs(process.argv.slice(2));
const scripts = selectedScripts(args.group);
if (args.list) {
  for (const script of scripts) console.log(script.file + '  [' + script.groups.join(',') + ']');
  process.exit(0);
}
if (!scripts.length) {
  console.error('no audit script in group ' + args.group);
  process.exit(2);
}

const reports = [];
const errors = [];
for (const script of scripts) {
  const result = runScript(script);
  if (result.report) reports.push(result.report);
  if (result.error) errors.push(script.file + ': ' + result.error);
  if (result.stderr && !args.json) {
    for (const line of result.stderr.trim().split('\n')) if (line) console.error('  ' + line);
  }
}

let baseline = null;
let baselineError = null;
if (args.expectBaseline) {
  try {
    baseline = compareAllToBaseline(reports, loadBaseline(args.baselinePath));
  } catch (error) {
    baselineError = error.message;
  }
}

let aggregate = {
  schema: 1,
  appVersion: APP_VERSION,
  commit: COMMIT,
  generatedAt: new Date().toISOString(),
  group: args.group,
  errors,
  audits: reports,
  checks: reports.flatMap((report) => (report.checks || []).map((item) => Object.assign({}, item, {
    audit: report.audit,
    group: report.group
  }))),
  baseline
};
aggregate.pass = errors.length === 0 && reports.length > 0 && reports.every((report) => report.pass);

if (args.updateBaseline) {
  if (errors.length) {
    console.error('cannot update baseline while audit has errors');
    process.exit(2);
  }
  const snapshot = buildBaseline(reports);
  writeJson(args.baselinePath, snapshot);
  console.log('baseline written: ' + args.baselinePath + '  (' + Object.keys(snapshot.checks).length + ' checks, ' + snapshot.knownFailures.length + ' known failures)');
  process.exit(0);
}

process.stdout.write(JSON.stringify(aggregate, null, 2) + '\n');
if (!args.json) printHuman(aggregate);

if (baselineError) process.exitCode = 2;
else if (args.expectBaseline) process.exitCode = baseline && baseline.pass ? 0 : 1;
else process.exitCode = aggregate.pass ? 0 : errors.length ? 2 : 1;
