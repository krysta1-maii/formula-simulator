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
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { build } from './build.mjs';
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

async function waitFor(expression, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate('Boolean(' + expression + ')').catch(() => false)) return true;
    await sleep(50);
  }
  return false;
}

async function press(key, code, vk, modifiers = 0) {
  const event = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, event));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, event));
}

async function projectedCarBounds() {
  return evaluateJson('window.FSApp.getSceneProbe().cameraFraming');
}

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
const artifact = join(tmpdir(), 'fs-camera-' + process.pid + '.html');
await build({ out: artifact });
  client = await launchBrowser({ chromePath, pagePath: artifact, width: 1280, height: 900 });
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
  check('default orbit angles', near(initial.theta, 0.62) && near(initial.phi, 1.22) && initial.zoom >= 5.79, JSON.stringify(initial));

  await evaluate("document.querySelector('#viewport canvas').focus()");
  await press('ArrowRight', 'ArrowRight', 39);
  const orbited = await waitFor('window.FSApp.getSnapshot().camera.theta > ' + (initial.theta + 0.04));
  const afterKeyOrbit = await camera();
  check('canvas ArrowRight provides keyboard orbit', orbited && afterKeyOrbit.theta > initial.theta + 0.04, initial.theta.toFixed(3) + ' -> ' + afterKeyOrbit.theta.toFixed(3));
  const focusStyle = await evaluateJson("(function () { var c = document.querySelector('#viewport canvas'); var s = getComputedStyle(c); return { focused: document.activeElement === c, visible: c.matches(':focus-visible'), outline: s.outlineStyle, width: s.outlineWidth }; })()");
  check('canvas keyboard focus has a visible ring', focusStyle.focused && focusStyle.visible && focusStyle.outline !== 'none' && parseFloat(focusStyle.width) >= 2, JSON.stringify(focusStyle));
  const beforeKeyPan = await camera();
  await press('ArrowRight', 'ArrowRight', 39, 8);
  await waitFor('Math.hypot(window.FSApp.getSnapshot().camera.target[0] - ' + beforeKeyPan.target[0] + ', window.FSApp.getSnapshot().camera.target[2] - ' + beforeKeyPan.target[2] + ') > 0.02');
  const afterKeyPan = await camera();
  const panDistance = Math.hypot(afterKeyPan.target[0] - beforeKeyPan.target[0], afterKeyPan.target[1] - beforeKeyPan.target[1], afterKeyPan.target[2] - beforeKeyPan.target[2]);
  check('Shift+ArrowRight provides keyboard pan', panDistance > 0.02, 'target moved ' + panDistance.toFixed(3) + ' m');
  const beforeKeyZoom = await camera();
  await press('PageUp', 'PageUp', 33);
  await waitFor('window.FSApp.getSnapshot().camera.zoom < ' + (beforeKeyZoom.zoom - 0.1));
  const afterKeyZoom = await camera();
  check('PageUp provides keyboard zoom', afterKeyZoom.zoom < beforeKeyZoom.zoom - 0.1, beforeKeyZoom.zoom.toFixed(3) + ' -> ' + afterKeyZoom.zoom.toFixed(3));
  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");

  for (const preset of [
    { name: 'side', theta: Math.PI / 2, phi: Math.PI / 2, zoom: 6 },
    { name: 'front', theta: 0, phi: Math.PI / 2, zoom: 2.45 },
    { name: 'rear', theta: Math.PI, phi: Math.PI / 2, zoom: 2.45 },
    { name: 'top', theta: Math.PI / 2, phi: 0.002, zoom: 6 }
  ]) {
    await evaluate("window.FSApp.setCameraPreset('" + preset.name + "', true)");
    const state = await camera();
    check(
      preset.name + ' has exact axis angles and safe-area zoom',
      near(state.theta, preset.theta, 1e-6) &&
        near(state.phi, preset.phi, 1e-6) &&
        state.zoom >= preset.zoom - 1e-6 &&
        state.projection === 'orthographic' &&
        state.preset === preset.name,
      JSON.stringify(state)
    );
  }
  check('axis preset marks the toolbar button', (await buttonPressed('btnOrtho')) === 'true');
  const cameraAria = await evaluateJson("[].map.call(document.querySelectorAll('[data-camera]'), function (b) { return { name: b.dataset.camera, pressed: b.getAttribute('aria-pressed') }; })");
  check('camera selection exposes aria-pressed', cameraAria.find(function (b) { return b.name === 'top'; }).pressed === 'true' && cameraAria.filter(function (b) { return b.pressed === 'true'; }).length === 1, JSON.stringify(cameraAria));

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

  for (const name of ['threeQuarter', 'side', 'front', 'rear', 'top']) {
    await evaluate("window.FSApp.setCameraPreset('" + name + "', true)");
    const bounds = await projectedCarBounds();
    const inside = bounds.left >= bounds.safe.left - 2 && bounds.right <= bounds.safe.right + 2 && bounds.top >= bounds.safe.top - 2 && bounds.bottom <= bounds.safe.bottom + 2;
    check('1280 panels leave ' + name + ' car framing unobscured', inside && bounds.samples > 1000, JSON.stringify({ bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, safe: bounds.safe }));
  }
  await evaluate("window.FSApp.setState({ showLoads: true, showLabels: true })");
  await sleep(1200);
  const labelFit = await evaluateJson("(function () { var panels = [document.getElementById('panelControls').getBoundingClientRect(), document.getElementById('panelTelemetry').getBoundingClientRect()]; var rows = [].map.call(document.querySelectorAll('.load-label:not(.is-hidden)'), function (el) { var r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clear: panels.every(function (p) { return r.right <= p.left || r.left >= p.right || r.bottom <= p.top || r.top >= p.bottom; }) }; }); return { count: rows.length, clear: rows.every(function (r) { return r.clear; }) }; })()");
  check('1280 load labels avoid both open panels', labelFit.count === 4 && labelFit.clear, JSON.stringify(labelFit));
  await evaluate("window.FSApp.setState({ showLabels: false })");
  for (const width of [390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    for (const name of ['portrait', 'threeQuarter']) {
      await evaluate("window.FSApp.setCameraPreset('" + name + "', true)");
      const bounds = await projectedCarBounds();
      const inside = bounds.left >= -1 && bounds.right <= width + 1 && bounds.left >= bounds.safe.left - 2 && bounds.right <= bounds.safe.right + 2 && bounds.top >= bounds.safe.top - 2 && bounds.bottom <= bounds.safe.bottom + 2;
      check(width + 'px ' + name + ' fits the safe portrait framing', inside, JSON.stringify({ bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, safe: bounds.safe }));
    }
    const bar = await evaluateJson("(function () { var b = document.querySelector('.bottom-bar'); return { client: b.clientWidth, scroll: b.scrollWidth }; })()");
    check(width + 'px bottom toolbar has no hidden overflow', bar.scroll <= bar.client + 1, JSON.stringify(bar));
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  failures += 1;
  if (error instanceof BrowserEnvError) envFailure = true;
  console.error('FAIL camera test:', error && error.message ? error.message : error);
} finally {
  if (client) await client.close();
  try { await unlink(artifact); } catch (_) { /* noop */ }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' camera check(s) failed');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  camera checks');