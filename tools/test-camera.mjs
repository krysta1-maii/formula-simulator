#!/usr/bin/env node
/**
 * Camera rig smoke test.
 *
 * Runs index.html in headless Chrome over CDP and checks the orbit/zoom
 * contract that the UI depends on: exact axis presets, object-following drag,
 * cursor-centred wheel zoom and the orthographic toggle. The test skips
 * gracefully when no Chrome binary is available, so the camera check stays
 * usable on a bare Node install.
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

function near(actual, expected, epsilon = 1e-5) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
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

const camera = () => evaluateJson('window.FSApp.getSnapshot().camera');
const buttonPressed = (id) => evaluate("document.getElementById('" + id + "').getAttribute('aria-pressed')");

async function drag(dx, dy) {
  const rect = await evaluateJson("(function () { var r = document.querySelector('#viewport canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()");
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x + (dx * i) / steps,
      y: y + (dy * i) / steps,
      button: 'left',
      buttons: 1
    });
    await sleep(20);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x + dx,
    y: y + dy,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(2200);
}

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

  const initial = await camera();
  check('default is three-quarter perspective', initial.preset === 'threeQuarter' && initial.projection === 'perspective');
  check('default orbit angles', near(initial.theta, 0.62) && near(initial.phi, 1.22) && near(initial.zoom, 5.79), JSON.stringify(initial));

  for (const preset of [
    { name: 'side', theta: Math.PI / 2, phi: Math.PI / 2, zoom: 6 },
    { name: 'front', theta: 0, phi: Math.PI / 2, zoom: 2.45 },
    { name: 'rear', theta: Math.PI, phi: Math.PI / 2, zoom: 2.45 },
    { name: 'top', theta: Math.PI / 2, phi: 0.002, zoom: 6 }
  ]) {
    await evaluate("window.FSApp.setCameraPreset('" + preset.name + "', true)");
    const state = await camera();
    check(
      preset.name + ' is an exact orthographic elevation',
      near(state.theta, preset.theta, 1e-6) &&
        near(state.phi, preset.phi, 1e-6) &&
        near(state.zoom, preset.zoom, 1e-6) &&
        state.projection === 'orthographic' &&
        state.preset === preset.name,
      JSON.stringify(state)
    );
  }
  check('axis preset marks the toolbar button', (await buttonPressed('btnOrtho')) === 'true');

  await evaluate("window.FSApp.setCameraPreset('side', true)");
  await evaluate("document.getElementById('btnAutoRotate').click()");
  await sleep(300);
  const orbitState = await camera();
  check('auto-rotate leaves the fixed preset', orbitState.preset === null && orbitState.projection === 'orthographic');
  check('auto-rotate marks its own button', (await buttonPressed('btnAutoRotate')) === 'true');
  await evaluate("document.getElementById('btnAutoRotate').click()");
  await sleep(200);

  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  const beforeRight = await camera();
  await drag(160, 0);
  const afterRight = await camera();
  check('drag right increases azimuth (scene follows pointer)', afterRight.theta > beforeRight.theta + 0.5, beforeRight.theta.toFixed(3) + ' -> ' + afterRight.theta.toFixed(3));

  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  const beforeDown = await camera();
  await drag(0, 120);
  const afterDown = await camera();
  check('drag down lowers polar angle (camera rises)', afterDown.phi < beforeDown.phi - 0.25, beforeDown.phi.toFixed(3) + ' -> ' + afterDown.phi.toFixed(3));
  check('manual drag clears the preset', afterDown.preset === null);

  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  const beforeWheel = await camera();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 430, y: 620, deltaX: 0, deltaY: -240 });
  await sleep(1800);
  const afterWheel = await camera();
  const moved = Math.hypot(
    afterWheel.target[0] - beforeWheel.target[0],
    afterWheel.target[1] - beforeWheel.target[1],
    afterWheel.target[2] - beforeWheel.target[2]
  );
  check('wheel zooms in', afterWheel.zoom < beforeWheel.zoom - 0.5, beforeWheel.zoom.toFixed(3) + ' -> ' + afterWheel.zoom.toFixed(3));
  check('wheel moves the orbit target toward the cursor', moved > 0.05, 'target moved ' + moved.toFixed(3) + ' m');

  await evaluate("document.getElementById('btnOrtho').click()");
  await sleep(300);
  check('orthographic button switches projection', (await camera()).projection === 'orthographic');
  check('orthographic button reports pressed state', (await buttonPressed('btnOrtho')) === 'true');
  await evaluate("document.getElementById('btnOrtho').click()");
  await sleep(300);
  check('orthographic button toggles back', (await camera()).projection === 'perspective');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  failures += 1;
  console.error('FAIL camera test:', error && error.message ? error.message : error);
} finally {
  try { socket.close(); } catch (_) { /* noop */ }
  chrome.kill('SIGKILL');
  await sleep(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* noop */ }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' camera check(s) failed');
  process.exit(1);
}
console.log('PASS  camera checks');
