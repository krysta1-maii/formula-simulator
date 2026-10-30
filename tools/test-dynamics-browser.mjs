#!/usr/bin/env node
/**
 * Dynamic chassis browser smoke test.
 *
 * Runs index.html in headless Chrome over CDP and checks the stage-02
 * contract: live fixed-step simulation, pause/resume, impulse response,
 * low-grip sliding, reset and the browser-side dynamic self-tests. The test
 * skips gracefully when no Chrome binary is available.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.GOOGLE_CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const chromePath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.log('SKIP camera test: no Chrome/Chromium binary found (set CHROME_PATH to enable).');
  process.exit(0);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const pageUrl = 'file://' + join(root, 'index.html');
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'fs-camera-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
  '--force-device-scale-factor=1',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  pageUrl
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let failures = 0;

function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

async function findTarget() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json());
      const page = list.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page;
    } catch (_) {
      /* Chrome is still starting. */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not expose the app page');
}

function connect(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolvePromise(socket);
    socket.onerror = () => rejectPromise(new Error('CDP websocket failed'));
  });
}

const target = await findTarget();
const socket = await connect(target.webSocketDebuggerUrl);
let messageId = 1;
const pending = new Map();
const pageErrors = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.text || 'exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    pageErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
};

function send(method, params = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = messageId;
    messageId += 1;
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
}

async function evaluateJson(expression) {
  return JSON.parse(await evaluate('JSON.stringify(' + expression + ')'));
}

const snapshot = () => evaluateJson('window.FSApp.getSnapshot()');

try {
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
  const impulse = await snapshot();
  const impulseTravel = Math.max(...impulse.travelMm.map((value) => Math.abs(value)));
  check('heave impulse loads the suspension', impulseTravel > 2, impulseTravel.toFixed(2) + ' mm');
  await evaluate("window.FSApp.advanceSimulation(3.5)");
  const settled = await snapshot();
  const settledTravel = Math.max(...settled.travelMm.map((value) => Math.abs(value)));
  check('spring-damper settles after the impulse', settledTravel < 0.2 && settled.sim.holding, settledTravel.toFixed(3) + ' mm');

  await evaluate("window.FSApp.impulse('roll')");
  await evaluate("window.FSApp.advanceSimulation(0.12)");
  const rollSnap = await snapshot();
  check('roll impulse produces body roll', Math.abs(rollSnap.rollDeg) > 0.05, rollSnap.rollDeg.toFixed(3) + '°');
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
  console.error('FAIL dynamic browser test:', error && error.message ? error.message : error);
} finally {
  try { socket.close(); } catch (_) { /* noop */ }
  chrome.kill('SIGKILL');
  await sleep(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* noop */ }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' dynamic browser check(s) failed');
  process.exit(1);
}
console.log('PASS  dynamic browser checks');
