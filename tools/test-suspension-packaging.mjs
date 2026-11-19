#!/usr/bin/env node
/** Suspension packaging, actuation and dynamic mesh-alignment verification. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserGate, launchBrowser, BrowserEnvError } from './browser-runner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
let envFailure = false;
let client = null;
const report = { cases: [], pageErrors: [] };

function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

try {
  const chromePath = browserGate('suspension packaging');
  client = await launchBrowser({ chromePath, pagePath: join(root, 'index.html'), width: 1440, height: 900, timeoutMs: 180000 });
  const { evaluate, evaluateJson, pageErrors, send } = client;
  await evaluate('window.FSApp.setSimRunning(false)');
  await evaluate('window.FSApp.resetDynamics({ settle: 1.5 })');
  await sleep(150);

  async function sample(name) {
    const bundle = await evaluateJson('({ packaging: window.FSApp.getSuspensionPackaging(), scene: window.FSApp.getSceneProbe(), snapshot: window.FSApp.getSnapshot() })');
    const p = bundle.packaging;
    report.cases.push(bundle);
    check(name + ': four closed body envelopes', p.enclosures.length === 4, p.enclosures.join(', '));
    check(name + ': internal mesh vertices stay inside bodywork', p.outside === 0,
      p.outside + '/' + p.samples + ' outside · ' + p.components.filter((row) => row.outside).map((row) => row.label + ':' + row.outside).join(', '));
    check(name + ': rocker and damper hardpoints stay inside', p.exposedHardpoints.length === 0,
      p.exposedHardpoints.map((row) => row.corner + ':' + row.name).join(', '));
    check(name + ': front pushrod and rear pullrod', p.coilAxes.every((row) =>
      (row.corner[0] === 'F' && row.actuation === 'pushrod') ||
      (row.corner[0] === 'R' && row.actuation === 'pullrod')));
    check(name + ': coilovers remain horizontal and longitudinal', p.coilAxes.every((row) => row.tiltDeg < 25 && row.longitudinalDominant),
      p.coilAxes.map((row) => row.corner + ' ' + row.tiltDeg.toFixed(2) + '°').join(' · '));
    check(name + ': normal and x-ray visibility are coherent', p.visibility.internalVisible === p.visibility.xray && p.visibility.springVisibility && p.visibility.skinMountVisible === true,
      JSON.stringify(p.visibility));
    check(name + ': links and rocker close', bundle.scene.solverOk && bundle.scene.stretch.susp < 0.01 && bundle.scene.stretch.push < 0.01 && bundle.scene.stretch.arb < 0.05,
      'susp ' + bundle.scene.stretch.susp.toFixed(4) + ' · push ' + bundle.scene.stretch.push.toFixed(4) + ' · ARB ' + bundle.scene.stretch.arb.toFixed(4) + ' mm');
    check(name + ': ARB torsion bars meet the lever roots', (bundle.snapshot.diag.arbStemGapMm || 0) <= 0.001,
      (bundle.snapshot.diag.arbStemGapMm || 0).toFixed(6) + ' mm');
    const visibleStroke = bundle.scene.wireLengths.map((wire, index) => (wire - bundle.scene.springs[index]) * 1000);
    const delta = Math.max(...visibleStroke.map((value, index) => Math.abs(value - bundle.snapshot.springCompressionMm[index])));
    check(name + ': visible coil stroke matches force telemetry', delta < 0.005, 'Δ ' + delta.toExponential(2) + ' mm');
    return bundle;
  }

  await evaluate('window.FSApp.setState({ steer: 0, xray: false })');
  await sample('normal');
  await evaluate('window.FSApp.setState({ xray: true })');
  await sample('xray');

  await evaluate('window.FSApp.impulse("heave")');
  await evaluate('window.FSApp.advanceSimulation(0.12)');
  await sample('heave');

  await evaluate('window.FSApp.resetDynamics({ settle: 1.5 })');
  await evaluate('window.FSApp.setState({ steer: 18 })');
  await evaluate('window.FSApp.impulse("pitch")');
  await evaluate('window.FSApp.advanceSimulation(0.12)');
  const steered = await sample('steer+pitch');
  check('steering stays healthy through pitch impulse', steered.snapshot.solverState === 'ok' && steered.snapshot.solverOk,
    steered.snapshot.solverState + ' · rack ' + steered.scene.rackShiftMm.toFixed(3) + ' mm');

  await evaluate('window.FSApp.resetDynamics({ settle: 1.5 })');
  await evaluate('window.FSApp.impulse("roll")');
  await evaluate('window.FSApp.advanceSimulation(0.12)');
  await sample('steer+roll');

  for (const wheelbase of [3.20, 3.70, 3.90]) {
    await evaluate('window.FSApp.setState({ wheelbase: ' + wheelbase + ' })');
    for (let i = 0; i < 100; i += 1) {
      const settled = await evaluateJson('window.FSApp.getSnapshot().geometry');
      if (!settled.pending && !settled.mismatch) break;
      await sleep(50);
    }
    await evaluate('window.FSApp.resetDynamics({ settle: 1.0 })');
    await sample('wheelbase-' + wheelbase.toFixed(2));
  }
  await evaluate('window.FSApp.setState({ wheelbase: 3.55 })');
  for (let i = 0; i < 100; i += 1) {
    const settled = await evaluateJson('window.FSApp.getSnapshot().geometry');
    if (!settled.pending && !settled.mismatch) break;
    await sleep(50);
  }

  if (process.env.FS_CAPTURE_SUSPENSION === '1') {
    await evaluate('window.FSApp.resetDynamics({ settle: 1.5 })');
    await evaluate('window.FSApp.setState({ steer: 0, xray: false })');
    await evaluate('window.FSApp.setCameraPreset("threeQuarter")');
    await sleep(700);
    let shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, 'docs/11-suspension-normal.png'), Buffer.from(shot.data, 'base64'));
    await evaluate('window.FSApp.setState({ xray: true })');
    await sleep(250);
    shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, 'docs/12-suspension-xray.png'), Buffer.from(shot.data, 'base64'));
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  report.pageErrors = pageErrors.slice();
} catch (error) {
  failures += 1;
  if (error instanceof BrowserEnvError) envFailure = true;
  console.error('FAIL suspension packaging:', error && error.stack ? error.stack : error);
} finally {
  if (client) await client.close();
  const target = join(root, '.tmp-test/suspension-packaging.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2));
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' suspension packaging check(s) failed');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  suspension packaging checks');
