#!/usr/bin/env node
/**
 * Dynamic chassis browser smoke test.
 *
 * Runs the built page in headless Chrome over CDP and checks the stage-02
 * contract: live fixed-step simulation, pause/resume, impulse response,
 * low-grip sliding, reset and the browser-side dynamic self-tests.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserGate, launchBrowser, BrowserEnvError } from './browser-runner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let failures = 0;
let envFailure = false;
let client = null;
let send;
let evaluate;
let evaluateJson;
let pageErrors = [];

function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

const snapshot = () => evaluateJson('window.FSApp.getSnapshot()');

try {
  const chromePath = browserGate('dynamic');
  client = await launchBrowser({ chromePath, pagePath: join(root, 'index.html') });
  ({ send, evaluate, evaluateJson, pageErrors } = client);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');

  for (let i = 0; i < 200; i += 1) {
    if (await evaluate('Boolean(window.FSApp && window.FSApp.ready)').catch(() => false)) break;
    await sleep(200);
  }
  check('app boots and exposes FSApp', await evaluate('Boolean(window.FSApp && window.FSApp.ready)'));
  await sleep(1000);

  const initial = await snapshot();
  check(
    'six-DOF simulation is live',
    Boolean(initial.sim) && initial.sim.stepHz === 500 && initial.sim.time > 1.5,
    initial.sim ? initial.sim.time.toFixed(2) + ' s' : 'no sim'
  );
  const levelError = Math.max(...initial.loads.map((value, index) => Math.abs(value - initial.levelLoads[index])));
  check('level loads match the design reference', levelError < 1, levelError.toFixed(3) + ' N');
  check('four wheels are in contact', initial.contactOk && initial.liftedCount === 0);
  check('body translation state is present', Boolean(initial.bodyPos) && Boolean(initial.travelMm));
  check('motion strip is populated', (await evaluate("document.getElementById('dynHeave').textContent")) !== '—');

  const beforePause = await snapshot();
  await evaluate("document.getElementById('btnSimToggle').click()");
  await sleep(450);
  const afterPause = await snapshot();
  check('pause stops the clock', Math.abs(afterPause.sim.time - beforePause.sim.time) < 0.03, beforePause.sim.time.toFixed(3) + ' -> ' + afterPause.sim.time.toFixed(3));
  check('pause button switches to continue', (await evaluate("document.getElementById('btnSimToggle').textContent")) === '继续');
  await evaluate("document.getElementById('btnSimToggle').click()");
  await sleep(4000);
  const afterResume = await snapshot();
  check(
    'continue restarts the clock',
    afterResume.sim.time > afterPause.sim.time + 0.01,
    'running ' + afterResume.sim.running + ' frames ' + afterPause.frameCount + ' -> ' + afterResume.frameCount + ' acc ' + afterResume.sim.accumulator + ' sub ' + afterResume.sim.substeps + ' · ' + afterPause.sim.time.toFixed(3) + ' -> ' + afterResume.sim.time.toFixed(3)
  );

  await evaluate("window.FSApp.resetDynamics({ settle: 1 })");
  await evaluate("window.FSApp.impulse('heave')");
  await evaluate("window.FSApp.advanceSimulation(0.12)");
  const impulseBundle = await evaluateJson("({ snapshot: window.FSApp.getSnapshot(), scene: window.FSApp.getSceneProbe() })");
  const impulse = impulseBundle.snapshot;
  const scene = impulseBundle.scene;
  const impulseTravel = Math.max(...impulse.travelMm.map((value) => Math.abs(value)));
  check('heave impulse loads the suspension', impulseTravel > 2, impulseTravel.toFixed(2) + ' mm');
  const visibleStroke = scene.wireLengths.map((wire, index) => (wire - scene.springs[index]) * 1000);
  const strokeDelta = Math.max(...visibleStroke.map((value, index) => Math.abs(value - impulse.springCompressionMm[index])));
  check(
    'rendered coil stroke equals the telemetry compression',
    strokeDelta < 5e-3,
    visibleStroke.map((value) => value.toFixed(3)).join(' / ') + ' mm · Δ ' + strokeDelta.toExponential(1)
  );
  check(
    'mechanism closes in the rendered scene',
    scene.stretch.susp < 0.01 && scene.stretch.tie < 0.01 && scene.stretch.arb < 0.01 && scene.solverOk,
    'susp ' + scene.stretch.susp.toFixed(4) + ' · tie ' + scene.stretch.tie.toFixed(4) + ' · arb ' + scene.stretch.arb.toFixed(4) + ' mm'
  );
  check(
    'wheel centres stay one tire radius above the plane',
    scene.wheelPos.every((position) => Math.abs(position[1] - 0.36) < 0.002),
    scene.wheelPos.map((position) => position[1].toFixed(4)).join(' / ')
  );
  await evaluate("window.FSApp.advanceSimulation(3.5)");
  const settled = await snapshot();
  const settledTravel = Math.max(...settled.travelMm.map((value) => Math.abs(value)));
  check('spring-damper settles after the impulse', settledTravel < 0.2 && settled.sim.holding, settledTravel.toFixed(3) + ' mm');

  await evaluate("window.FSApp.impulse('roll')");
  let rollPeak = 0;
  for (let step = 0; step < 8; step += 1) {
    await evaluate("window.FSApp.advanceSimulation(0.05)");
    const rollSnap = await snapshot();
    rollPeak = Math.max(rollPeak, Math.abs(rollSnap.rollDeg));
  }
  check('roll impulse produces body roll', rollPeak > 0.1, rollPeak.toFixed(3) + '° peak');
  await evaluate("window.FSApp.advanceSimulation(3.0)");

  await evaluate("window.FSApp.resetDynamics({ settle: 1 })");
  await evaluate("window.FSApp.setState({ slope: 10, bank: 10, friction: 0.2 })");
  await evaluate("window.FSApp.advanceSimulation(2.0)");
  const slide = await snapshot();
  check(
    'low grip releases the six-DOF planar state',
    slide.sim.sliding && Math.hypot(slide.bodyPos.x, slide.bodyPos.z) > 0.05,
    Math.hypot(slide.bodyPos.x, slide.bodyPos.z).toFixed(2) + ' m'
  );
  check('sliding loads remain finite and non-negative', slide.loads.every((value) => Number.isFinite(value) && value >= 0));

  await evaluate("window.FSApp.setState({ slope: 0, bank: 0, friction: 1.4 })");
  await evaluate("window.FSApp.resetDynamics({ settle: 1 })");
  const reset = await snapshot();
  const resetError = Math.max(...reset.loads.map((value, index) => Math.abs(value - reset.levelLoads[index])));
  check('reset returns to the level design state', resetError < 1 && Math.abs(reset.bodyPos.y * 1000) < 0.01, resetError.toFixed(3) + ' N');

  const dynamicTests = await evaluateJson('window.FSApp.runDynamicSelfTests()');
  check('dynamic self-tests run in the browser', dynamicTests.length >= 8);
  check(
    'all dynamic self-tests pass',
    dynamicTests.every((test) => test.ok),
    dynamicTests.filter((test) => !test.ok).map((test) => test.name).join(', ')
  );
  const buttons = ['btnSimToggle', 'btnSimReset', 'btnImpulseHeave', 'btnImpulseRoll', 'btnImpulsePitch', 'btnSimSettle'];
  const buttonsPresent = await evaluate("[" + buttons.map((id) => "'" + id + "'").join(',') + "].every(function (id) { return Boolean(document.getElementById(id)); })");
  check('dynamic control buttons are present', buttonsPresent === true);

  await evaluate('window.FSApp.setState({ dampingF: 0.9 })');
  const damped = await snapshot();
  check('damping parameter updates the wheel damper', damped.damperRateWheel[0] > initial.damperRateWheel[0], damped.damperRateWheel[0].toFixed(0) + ' N s/m');
  check('parameter changes keep the dynamic state finite', Boolean(damped.sim) && damped.loads.every((value) => Number.isFinite(value)));
  await evaluate('window.FSApp.setState({ dampingF: 0.35 })');

  await evaluate('window.FSApp.setState({ wheelbase: 3.70 })');
  await sleep(1800);
  const rebuilt = await snapshot();
  check('geometry rebuild keeps the car grounded', Math.abs(rebuilt.state.wheelbase - 3.7) < 1e-9 && rebuilt.contactOk, rebuilt.state.wheelbase.toFixed(2) + ' m');
  await evaluate('window.FSApp.setState({ wheelbase: 3.55 })');
  await sleep(1200);

  await evaluate('window.FSApp.openModel()');
  await sleep(1400);
  const modalItems = await evaluate("document.querySelectorAll('#selfTestList li').length");
  check('model modal lists static and dynamic tests', modalItems >= 22, String(modalItems));
  await evaluate('window.FSApp.closeModel()');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  failures += 1;
  if (error instanceof BrowserEnvError) envFailure = true;
  console.error('FAIL dynamic browser test:', error && error.message ? error.message : error);
} finally {
  if (client) await client.close();
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' dynamic browser check(s) failed');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  dynamic browser checks');