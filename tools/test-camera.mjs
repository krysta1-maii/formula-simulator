#!/usr/bin/env node
/**
 * Camera rig smoke test.
 *
 * Runs the built page in headless Chrome over CDP and checks the orbit/zoom
 * contract that the UI depends on: exact axis presets, object-following drag,
 * cursor-centred wheel zoom and the orthographic toggle.
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

function near(actual, expected, epsilon = 1e-5) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
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
  const chromePath = browserGate('camera');
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
  if (error instanceof BrowserEnvError) envFailure = true;
  console.error('FAIL camera test:', error && error.message ? error.message : error);
} finally {
  if (client) await client.close();
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' camera check(s) failed');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  camera checks');