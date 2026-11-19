#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, renderIndexHtml } from './build.mjs';
import { assertBuildCurrent, verifyIndexHtml } from './check-build.mjs';
import { baselineExpectationExitCode, baselineUpdateErrors } from './audit/run-all.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = '<!doctype html><style>/*__STYLES__*/</style><script>/*__THREE__*/</script>/*__APP__*/';
let checks = 0;
let failures = 0;

function check(name, ok, detail = '') {
  checks += 1;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

async function expectThrow(name, fn, pattern) {
  try {
    await fn();
    check(name, false, 'operation unexpectedly succeeded');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    check(name, pattern.test(message), message.split('\n')[0]);
  }
}

async function withFixture(options, fn) {
  const root = await mkdtemp(join(tmpdir(), 'fs-build-test-'));
  try {
    await mkdir(join(root, 'src', 'js'), { recursive: true });
    await mkdir(join(root, 'vendor'), { recursive: true });
    await writeFile(join(root, 'src', 'index.template.html'), options.template || TEMPLATE, 'utf8');
    await writeFile(join(root, 'src', 'styles.css'), options.styles || 'a::after { content: "$&"; }', 'utf8');
    await writeFile(join(root, 'vendor', 'three.min.js'), options.three || 'globalThis.THREE = "$&";', 'utf8');
    await writeFile(join(root, 'src', 'js', '00-fixture.js'), options.app || 'globalThis.__fixture = "$&";', 'utf8');
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withFixture({}, async (root) => {
  const { html } = await renderIndexHtml({ root });
  check('build replaces each placeholder once',
    !html.includes('/*__STYLES__*/') && !html.includes('/*__THREE__*/') && !html.includes('/*__APP__*/'));
  check('build preserves replacement-pattern dollar sequences',
    html.includes('content: "$&";') && html.includes('globalThis.THREE = "$&";') && html.includes('globalThis.__fixture = "$&";'));
  const result = await build({ root });
  check('build writes a matching artifact', (await verifyIndexHtml({ root })).ok && result.target === join(root, 'index.html'));
  await writeFile(join(root, 'index.html'), html + '\n<!-- stale -->', 'utf8');
  check('build check detects a stale artifact', (await verifyIndexHtml({ root })).ok === false);
  await expectThrow('artifact assertion rejects stale HTML', () => assertBuildCurrent({ root }), /does not match current sources/);
});

for (const [label, source, value] of [
  ['uppercase app end tag', 'app', 'globalThis.__bad = "</SCRIPT>";'],
  ['mixed-case three end tag', 'three', 'globalThis.THREE = "</ScRiPt>";'],
  ['uppercase style end tag', 'styles', 'a { content: "</SCRIPT >"; }']
]) {
  await withFixture({ [source]: value }, async (root) => {
    await expectThrow('build rejects ' + label, () => renderIndexHtml({ root }), /literal <\/script>/i);
  });
}

for (const token of ['/*__STYLES__*/', '/*__THREE__*/', '/*__APP__*/']) {
  await withFixture({ template: TEMPLATE.replace(token, '') }, async (root) => {
    await expectThrow('build rejects missing ' + token, () => renderIndexHtml({ root }), /exactly one/);
  });
  await withFixture({ template: TEMPLATE + token }, async (root) => {
    await expectThrow('build rejects duplicate ' + token, () => renderIndexHtml({ root }), /exactly one/);
  });
}

const passingReport = { audit: 'fixture', pass: true, error: null, skipped: [], checks: [{ id: 'ok', ok: true }] };
check('baseline update accepts a complete passing report', baselineUpdateErrors([passingReport], [], 1).length === 0);
check('baseline update rejects skips', baselineUpdateErrors([
  { audit: 'skip', pass: false, error: null, skipped: [{ id: 'browser', reason: 'missing' }], checks: [] }
], [], 1).some((reason) => reason.includes('skip:')));
check('baseline update rejects report errors', baselineUpdateErrors([
  { audit: 'error', pass: false, error: 'boom', skipped: [], checks: [] }
], [], 1).some((reason) => reason.includes('error:')));
check('baseline update rejects failed checks', baselineUpdateErrors([
  { audit: 'fail', pass: false, error: null, skipped: [], checks: [{ id: 'bad', ok: false }] }
], [], 1).some((reason) => reason.includes('fail:')));
check('baseline update rejects missing reports', baselineUpdateErrors([passingReport], [], 2).some((reason) => reason.includes('incomplete')));

const passingAggregate = { errors: [], pass: true };
check('baseline gate passes only with pass and match',
  baselineExpectationExitCode(passingAggregate, { pass: true }) === 0);
check('baseline gate fails when an audit fails despite a match',
  baselineExpectationExitCode({ errors: [], pass: false }, { pass: true }) === 1);
check('baseline gate reports errors despite a match',
  baselineExpectationExitCode({ errors: ['boom'], pass: false }, { pass: true }) === 2);
check('baseline gate fails on baseline drift',
  baselineExpectationExitCode(passingAggregate, { pass: false }) === 1);

const historical = join(ROOT, 'tools', 'audit', 'baseline', '0.2.0.json');
const historicalBefore = await readFile(historical, 'utf8');
const overwrite = spawnSync(process.execPath, ['tools/audit/run-all.mjs', '--update-baseline'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 30000
});
check('audit update refuses to overwrite the historical baseline',
  overwrite.status !== 0 && /read-only/.test(overwrite.stderr || ''), 'exit ' + overwrite.status);
check('historical baseline bytes remain unchanged', (await readFile(historical, 'utf8')) === historicalBefore);

const noChromeEnv = Object.assign({}, process.env, {
  CHROME_PATH: join(tmpdir(), 'fs-chrome-does-not-exist'),
  GOOGLE_CHROME_BIN: '',
  FS_REQUIRE_CHROME: '',
  FS_SKIP_BROWSER: '',
  CI: ''
});
const localOptional = spawnSync(process.execPath, ['tools/test-dynamics-browser.mjs'], {
  cwd: ROOT,
  env: noChromeEnv,
  encoding: 'utf8',
  timeout: 30000
});
check('local browser unit test may skip without Chrome',
  localOptional.status === 0 && /SKIP/.test(localOptional.stdout || ''), 'exit ' + localOptional.status);
const strictCi = spawnSync(process.execPath, ['tools/browser-runner.mjs', '--ci'], {
  cwd: ROOT,
  env: noChromeEnv,
  encoding: 'utf8',
  timeout: 30000
});
const strictOutput = (strictCi.stdout || '') + (strictCi.stderr || '');
check('ci browser runner fails without Chrome instead of skipping',
  strictCi.status !== 0 && /no Chrome\/Chromium binary found/.test(strictOutput) && !/SKIP dynamic/.test(strictOutput),
  'exit ' + strictCi.status);

const runtimeSource = await readFile(join(ROOT, 'tools', 'test-runtime.mjs'), 'utf8');
const stepsLine = 'const steps2 = Math.round(sim.time / physics.SIM_DT);';
check('runtime fault injection fixture matches the production step counter', runtimeSource.includes(stepsLine));
if (runtimeSource.includes(stepsLine)) {
  const faultRoot = await mkdtemp(join(tmpdir(), 'fs-runtime-fault-'));
  try {
    const faulty = runtimeSource
      .replace("const root = dirname(dirname(fileURLToPath(import.meta.url)));", "const root = " + JSON.stringify(ROOT) + ';')
      .replace("from './audit/_harness.mjs'", "from " + JSON.stringify(pathToFileURL(join(ROOT, 'tools', 'audit', '_harness.mjs')).href))
      .replace(stepsLine, 'sim.time -= physics.SIM_DT;\n    ' + stepsLine);
    const faultFile = join(faultRoot, 'test-runtime-fault.mjs');
    await writeFile(faultFile, faulty, 'utf8');
    const injected = spawnSync(process.execPath, [faultFile], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    });
    const output = (injected.stdout || '') + (injected.stderr || '');
    check('missing-substep fault injection fails the runtime test', injected.status === 1, 'exit ' + injected.status);
    check('fault injection reaches the frame-rate state assertion', /FAIL \d+ Hz state matches fixed stepping/.test(output));
    check('fault output reports actual and reference substep counts', /steps=\d+\/\d+ delta=Infinity/.test(output));
  } finally {
    await rm(faultRoot, { recursive: true, force: true });
  }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' / ' + checks + ' tooling checks failed');
  process.exit(1);
}
console.log('PASS  ' + checks + ' tooling checks');
