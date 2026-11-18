#!/usr/bin/env node
/**
 * UI browser checks: viewport, keyboard, focus, state, solver display, load
 * arrows and offline. Uses the built temp artifact so the committed
 * index.html does not have to be refreshed by this round.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { build } from './build.mjs';
import { browserGate, launchBrowser, BrowserEnvError, sleep } from './browser-runner.mjs';

let failures = 0;
let envFailure = 0;
let checks = 0;
let group = 'general';

function check(name, ok, detail = '') {
  checks += 1;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

function setGroup(name) {
  group = name;
  console.log('\n[' + name + ']');
}

const metricsScript = "(function () {" +
  "function rect(selector) { var el = document.querySelector(selector); if (!el) return null; var b = el.getBoundingClientRect(); var s = getComputedStyle(el); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, display: s.display, visibility: s.visibility }; }" +
  "return { innerWidth: innerWidth, innerHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, app: rect('#app'), topbar: rect('.topbar'), bottomBar: rect('.bottom-bar'), panel: rect('#panelControls') };" +
  "})()";

const keyEvent = (type, key, code, vk) => ({
  type,
  key,
  code,
  windowsVirtualKeyCode: vk,
  nativeVirtualKeyCode: vk
});

async function press(client, key, code, vk) {
  await client.send('Input.dispatchKeyEvent', keyEvent('keyDown', key, code, vk));
  await client.send('Input.dispatchKeyEvent', keyEvent('keyUp', key, code, vk));
  await sleep(180);
}

async function pressTab(client, shift = false) {
  const modifiers = shift ? 8 : 0;
  await client.send('Input.dispatchKeyEvent', Object.assign(keyEvent('keyDown', 'Tab', 'Tab', 9), { modifiers }));
  await client.send('Input.dispatchKeyEvent', Object.assign(keyEvent('keyUp', 'Tab', 'Tab', 9), { modifiers }));
  await sleep(60);
}

async function focusSelector(client, selector) {
  const target = JSON.stringify(selector);
  const focused = await waitFor(client, "(function () { var el = document.querySelector(" + target + "); if (!el) return false; el.focus(); return document.activeElement === el; })()", 1500, 25);
  if (!focused) throw new Error('could not focus ' + selector);
}

async function activeInfo(client) {
  return client.evaluateJson("(function () { var e = document.activeElement; return { id: e ? e.id : '', tag: e ? e.tagName : '', inPanel: Boolean(e && e.closest('#panelControls')), inModal: Boolean(e && e.closest('#modelModal')) }; })()");
}

async function waitReady(client) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await client.evaluate('Boolean(window.FSApp && window.FSApp.ready)').catch(() => false);
    if (ready) return true;
    await sleep(150);
  }
  return false;
}

async function waitFor(client, expression, timeoutMs = 3000, interval = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await client.evaluate('Boolean(' + expression + ')').catch(() => false);
    if (ok) return true;
    await sleep(interval);
  }
  return false;
}

async function waitForViewport(client, width, height) {
  await waitFor(client, 'innerWidth === ' + width + ' && Math.abs(innerHeight - ' + height + ') <= 1');
  await waitFor(client, "matchMedia('(max-width: 980px)').matches === " + (width <= 980 ? 'true' : 'false'));
  await client.evaluate('new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); }); })');
  await sleep(80);
}

async function waitForModalClosed(client) {
  await client.evaluate("if (!document.getElementById('modelModal').hidden) window.FSApp.closeModel()");
  await waitFor(client, "document.getElementById('modelModal').hidden && !document.body.classList.contains('modal-open')");
  await waitFor(client, "document.querySelector('.topbar').inert === false");
}

function panelOpenExpression(id) {
  return "document.getElementById('" + id + "').classList.contains('is-open')";
}

async function ensurePanelOpen(client, id) {
  const toggle = id === 'panelControls' ? 'btnToggleControls' : 'btnToggleTelemetry';
  const expression = panelOpenExpression(id);
  if (!(await client.evaluate(expression))) {
    await client.evaluate("document.getElementById('" + toggle + "').click()");
  }
  if (!(await waitFor(client, expression))) {
    await client.evaluate("document.getElementById('" + toggle + "').click()");
    await waitFor(client, expression);
  }
  return client.evaluate(expression);
}

async function openPanelStable(client, id) {
  const expression = panelOpenExpression(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensurePanelOpen(client, id);
    if (!(await waitFor(client, expression))) {
      await closePanel(client, id);
      continue;
    }
    const stable = await client.evaluate('new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(Boolean(' + expression + ')); }); }); })');
    if (stable) return true;
    await closePanel(client, id);
  }
  return false;
}

async function closePanel(client, id) {
  const expression = panelOpenExpression(id);
  if (await client.evaluate(expression)) {
    const selector = '[data-close-panel="' + id + '"]';
    await client.evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  }
  await waitFor(client, '!' + expression);
}

async function closePanels(client) {
  await closePanel(client, 'panelControls');
  await closePanel(client, 'panelTelemetry');
}

async function establishCleanUi(client) {
  await waitForModalClosed(client);
  await closePanels(client);
}

async function waitForRebuild(client) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pending = await client.evaluateJson('window.FSApp.getSnapshot().pendingRebuild').catch(() => false);
    if (pending === false) return true;
    await sleep(100);
  }
  return false;
}

const chromePath = browserGate('ui');
const artifact = join(tmpdir(), 'fs-ui-' + process.pid + '.html');
const built = await build({ out: artifact });
let client = null;

try {
  client = await launchBrowser({ chromePath, pagePath: artifact, width: 1280, height: 900 });
  const { send, evaluate, evaluateJson, pageErrors, networkRequests } = client;

  setGroup('viewport');
  const sizes = [[844, 390], [667, 375], [1024, 400], [1280, 720]];
  for (const [width, height] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await waitForViewport(client, width, height);
    const metrics = await evaluateJson(metricsScript);
    const label = width + 'x' + height;
    const inView = (rect) => Boolean(rect) && rect.display !== 'none' && rect.top >= -1 && rect.bottom <= metrics.innerHeight + 1 && rect.left >= -1 && rect.right <= metrics.innerWidth + 1;
    check(label + ' has no page overflow', metrics.scrollWidth <= metrics.innerWidth + 1 && metrics.scrollHeight <= metrics.innerHeight + 1, metrics.scrollWidth + 'x' + metrics.scrollHeight);
    check(label + ' layout fits the viewport', Boolean(metrics.app) && Math.abs(metrics.app.height - metrics.innerHeight) <= 1 && inView(metrics.topbar) && inView(metrics.bottomBar), JSON.stringify({ app: metrics.app && metrics.app.height, topbar: metrics.topbar, bottomBar: metrics.bottomBar }));
    if (width === 844 && height === 390) {
      const netHeight = metrics.bottomBar.top - metrics.topbar.bottom;
      check('844x390 leaves at least 55% for the scene', netHeight >= metrics.innerHeight * 0.55, netHeight.toFixed(1) + ' / ' + metrics.innerHeight);
      await closePanels(client);
      const panelStable = await openPanelStable(client, 'panelControls');
      await waitFor(client, panelOpenExpression('panelControls'));
      const panel = await evaluateJson("(function () { var p = document.getElementById('panelControls'); var b = p.getBoundingClientRect(); var s = document.getElementById('btnScreenshot'); var sb = s.getBoundingClientRect(); return { open: p.classList.contains('is-open'), top: b.top, bottom: b.bottom, screenshotTop: sb.top, screenshotBottom: sb.bottom, viewport: innerHeight }; })()");
      check('844x390 panel stays inside the viewport', panelStable && panel.open && panel.bottom <= panel.viewport + 1 && panel.top >= -1, JSON.stringify(panel));
      check('844x390 screenshot button is visible', panel.screenshotTop >= 0 && panel.screenshotBottom <= panel.viewport + 1, panel.screenshotTop.toFixed(1) + '..' + panel.screenshotBottom.toFixed(1));
      await closePanel(client, 'panelControls');
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await waitFor(client, 'innerWidth === 1280');
  await sleep(150);

  setGroup('keyboard');
  await evaluate('window.FSApp.setSimRunning(false)');
  await establishCleanUi(client);
  await focusSelector(client, '#btnHelp');
  const runningBeforeSpace = (await evaluateJson('window.FSApp.getSnapshot().sim.running'));
  await press(client, ' ', 'Space', 32);
  const modalOpen = await evaluate("!document.getElementById('modelModal').hidden");
  const runningAfterSpace = (await evaluateJson('window.FSApp.getSnapshot().sim.running'));
  check('Space on a focused button opens the modal', modalOpen === true);
  check('Space on a focused button does not toggle simulation', runningBeforeSpace === runningAfterSpace, runningBeforeSpace + ' -> ' + runningAfterSpace);
  await evaluate('window.FSApp.closeModel()');
  await sleep(250);
  await evaluate('document.activeElement.blur()');
  await press(client, ' ', 'Space', 32);
  check('Space on the page toggles simulation', (await evaluateJson('window.FSApp.getSnapshot().sim.running')) === true);

  await evaluate('window.FSApp.setState({ slope: 6 })');
  await ensurePanelOpen(client, 'panelControls');
  await focusSelector(client, '#slope');
  await press(client, 'h', 'KeyH', 72);
  check('h does not change slope while the range is focused', Math.abs((await evaluateJson('window.FSApp.getState().slope')) - 6) < 1e-9);
  await press(client, 'ArrowRight', 'ArrowRight', 39);
  check('ArrowRight keeps the range native behaviour', (await evaluateJson('window.FSApp.getState().slope')) > 6);
  await evaluate('window.FSApp.setState({ slope: 0 })');
  await closePanels(client);
  await focusSelector(client, '#btnToggleControls');
  await press(client, ' ', 'Space', 32);
  const panelOpened = await evaluate("document.getElementById('panelControls').classList.contains('is-open')");
  const panelExpanded = await evaluate("document.getElementById('btnToggleControls').getAttribute('aria-expanded')");
  await press(client, ' ', 'Space', 32);
  check('Space on the panel button toggles it and keeps aria in sync', panelOpened === true && panelExpanded === 'true' && (await evaluate("document.getElementById('panelControls').classList.contains('is-open')")) === false);

  await evaluate("document.getElementById('btnToggleControls').click()");
  await sleep(320);
  await evaluate("document.querySelector('#panelControls details summary').focus()");
  const detailsBefore = await evaluate("document.querySelector('#panelControls details').open");
  await press(client, ' ', 'Space', 32);
  const detailsAfter = await evaluate("document.querySelector('#panelControls details').open");
  check('Space on a summary toggles details natively', detailsBefore !== detailsAfter, String(detailsBefore) + ' -> ' + String(detailsAfter));
  await closePanels(client);

  await focusSelector(client, '#btnHelp');
  await press(client, ' ', 'Space', 32);
  await sleep(250);
  const modalSnapshotA = await evaluateJson('window.FSApp.getSnapshot()');
  await press(client, 'h', 'KeyH', 72);
  await press(client, ' ', 'Space', 32);
  await press(client, '1', 'Digit1', 49);
  const modalSnapshotB = await evaluateJson('window.FSApp.getSnapshot()');
  const modalShortcutsBlocked = modalSnapshotA.sim.running === modalSnapshotB.sim.running && Math.abs(modalSnapshotA.state.slope - modalSnapshotB.state.slope) < 1e-9 && modalSnapshotA.camera.preset === modalSnapshotB.camera.preset;
  await press(client, 'Escape', 'Escape', 27);
  check('modal blocks shortcuts and Escape returns focus', modalShortcutsBlocked && (await evaluate("document.getElementById('modelModal').hidden")) === true && (await activeInfo(client)).id === 'btnHelp');

  setGroup('focus');
  await waitForModalClosed(client);
  await closePanels(client);
  const openedForFocus = await ensurePanelOpen(client, 'panelControls');
  if (!openedForFocus) throw new Error('panelControls did not open for the focus check');
  await focusSelector(client, '#panelControls .panel-close');
  await waitFor(client, "document.activeElement === document.querySelector('#panelControls .panel-close')");
  await evaluate("document.querySelector('[data-close-panel=\"panelControls\"]').click()");
  await waitFor(client, "document.activeElement === document.getElementById('btnToggleControls')");
  const closedInfo = await activeInfo(client);
  const closedPanel = await evaluateJson("(function () { var p = document.getElementById('panelControls'); return { inert: p.inert === true, ariaHidden: p.getAttribute('aria-hidden'), visibility: getComputedStyle(p).visibility }; })()");
  check('closing a panel returns focus and marks it inert', closedInfo.id === 'btnToggleControls' && closedInfo.inPanel === false && closedPanel.inert === true && closedPanel.ariaHidden === 'true', JSON.stringify({ focus: closedInfo, panel: closedPanel }));
  let tabInsidePanel = false;
  for (let i = 0; i < 20; i += 1) {
    await pressTab(client);
    if ((await activeInfo(client)).inPanel) tabInsidePanel = true;
  }
  check('Tab never enters a closed panel', tabInsidePanel === false);
  await ensurePanelOpen(client, 'panelControls');
  await focusSelector(client, '#btnToggleControls');
  const openedPanel = await evaluateJson("(function () { var p = document.getElementById('panelControls'); return { inert: p.inert === true, ariaHidden: p.getAttribute('aria-hidden'), open: p.classList.contains('is-open') }; })()");
  check('opening a panel clears inert and aria-hidden', openedPanel.open === true && openedPanel.inert === false && openedPanel.ariaHidden === null, JSON.stringify(openedPanel));
  let tabEntered = false;
  for (let i = 0; i < 5; i += 1) {
    await pressTab(client);
    if ((await activeInfo(client)).inPanel) tabEntered = true;
  }
  check('Tab can enter an open panel', tabEntered === true);
  await closePanels(client);

  await focusSelector(client, '#btnHelp');
  await evaluate("document.getElementById('btnHelp').click()");
  await sleep(320);
  let modalTabOk = true;
  for (let i = 0; i < 15; i += 1) {
    await pressTab(client);
    if (!(await activeInfo(client)).inModal) modalTabOk = false;
  }
  for (let i = 0; i < 5; i += 1) {
    await pressTab(client, true);
    if (!(await activeInfo(client)).inModal) modalTabOk = false;
  }
  check('Tab and Shift+Tab stay inside the modal', modalTabOk === true);
  await press(client, 'Escape', 'Escape', 27);
  const afterModal = await activeInfo(client);
  const panelAfterModal = await evaluateJson("(function () { var p = document.getElementById('panelControls'); return { inert: p.inert === true }; })()");
  check('Escape restores focus and background inert state', afterModal.id === 'btnHelp' && panelAfterModal.inert === true);

  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
  await waitForViewport(client, 844, 390);
  await openPanelStable(client, 'panelControls');
  await evaluate("document.getElementById('btnToggleTelemetry').click()");
  await waitFor(client, "document.getElementById('panelTelemetry').classList.contains('is-open') && !document.getElementById('panelControls').classList.contains('is-open')");
  const exclusive = await evaluateJson("(function () { var l = document.getElementById('panelControls'); var r = document.getElementById('panelTelemetry'); return { leftOpen: l.classList.contains('is-open'), leftInert: l.inert === true, rightOpen: r.classList.contains('is-open') }; })()");
  check('exclusive panel opening closes and inerts the other', exclusive.leftOpen === false && exclusive.leftInert === true && exclusive.rightOpen === true, JSON.stringify(exclusive));
  await closePanels(client);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(250);

  setGroup('state');
  await evaluate('window.FSApp.setSimRunning(true)');
  await evaluate('window.FSApp.setState({ slope: 0, bank: 0 })');
  await evaluate("document.getElementById('btnSimToggle').click()");
  await waitFor(client, 'window.FSApp.getSnapshot().sim.running === false');
  const paused = await evaluateJson("(function () { return { detail: document.getElementById('simDetail').textContent, telemetry: document.getElementById('telemetrySimState').textContent, status: document.getElementById('simStatus').textContent, button: document.getElementById('btnSimToggle').textContent, running: window.FSApp.getSnapshot().sim.running }; })()");
  check('pause updates every status field from one path', paused.running === false && paused.detail.indexOf('暂停') >= 0 && paused.detail.indexOf('运行') !== 0 && paused.telemetry === '暂停' && paused.status === '暂停' && paused.button === '继续', JSON.stringify(paused));
  await evaluate("document.getElementById('btnSimToggle').click()");
  await sleep(420);
  const resumed = await evaluateJson("(function () { return { detail: document.getElementById('simDetail').textContent, telemetry: document.getElementById('telemetrySimState').textContent, running: window.FSApp.getSnapshot().sim.running }; })()");
  check('resume keeps the status fields together', resumed.running === true && resumed.detail.indexOf('运行') === 0 && resumed.telemetry === '运行', JSON.stringify(resumed));
  await evaluate("document.getElementById('btnSimToggle').click()");
  await sleep(300);
  await evaluate("document.getElementById('btnSimReset').click()");
  await sleep(700);
  check('reset from pause returns to running', (await evaluateJson('window.FSApp.getSnapshot().sim.running')) === true && (await evaluate("document.getElementById('simStatus').textContent")) === '运行');
  await evaluate('document.activeElement.blur()');
  await press(client, ' ', 'Space', 32);
  check('Space pause keeps the four status fields consistent', (await evaluateJson('window.FSApp.getSnapshot().sim.running')) === false && (await evaluate("document.getElementById('simDetail').textContent")).indexOf('暂停') >= 0 && (await evaluate("document.getElementById('telemetrySimState').textContent")) === '暂停');
  await press(client, ' ', 'Space', 32);

  setGroup('solver');
  await evaluate('window.FSApp.reset()');
  await sleep(700);
  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await sleep(500);
  const defaultSnapshot = await evaluateJson('window.FSApp.getSnapshot()');
  const badgeDefault = await evaluateJson("(function () { var b = document.getElementById('solverBadge'); return { hidden: b.hidden, text: b.textContent, live: b.getAttribute('aria-live'), state: b.dataset.state }; })()");
  const rowIds = await evaluateJson("[].map.call(document.querySelectorAll('#checkList .check-item'), function (item) { return item.dataset.checkId; })");
  check('default solver state is ok and the badge is hidden', defaultSnapshot.solverOk === true && defaultSnapshot.solverState === 'ok' && badgeDefault.hidden === true && badgeDefault.live === 'polite', JSON.stringify({ state: defaultSnapshot.solverState, badge: badgeDefault }));
  check('check table has the frozen ten ids', JSON.stringify(rowIds) === JSON.stringify(['sim', 'contact', 'links', 'steer', 'arb', 'friction', 'rockerResidual', 'motionRatio', 'staticTests', 'dynamicTests']), JSON.stringify(rowIds));
  check('default residual row is ok', (await evaluate("document.querySelector('[data-check-id=rockerResidual]').className")).indexOf('is-ok') >= 0 && (await evaluate("document.getElementById('cornerSolveStatus').textContent")).indexOf('0.100 mm') >= 0);

  await evaluate("window.FSApp.setState({ mass: 600, wheelRateF: 50, wheelRateR: 50, dampingF: 0.05, dampingR: 0.05, arbFront: 0, arbRear: 0 })");
  await waitForRebuild(client);
  await sleep(400);
  await evaluate('window.FSApp.resetDynamics({ settle: 1.5 })');
  await sleep(300);
  await evaluate("window.FSApp.impulse('pitch')");
  await evaluate('window.FSApp.setSimRunning(false)');
  for (let i = 0; i < 40; i += 1) {
    await evaluate('window.FSApp.advanceSimulation(0.05)');
    const probe = await evaluateJson('window.FSApp.getSnapshot()');
    const residuals = probe.rockerResidualMm || [];
    const maxResidual = residuals.length ? Math.max.apply(null, residuals) : 0;
    if (probe.solverOk === false && maxResidual > 0.1) break;
  }
  await sleep(300);
  const splitSnapshot = await evaluateJson('window.FSApp.getSnapshot()');
  const splitFrame = splitSnapshot.solved && splitSnapshot.solved.some(function (row) { return row && row.converged === true && row.ok === false; });
  const splitBadge = await evaluateJson("(function () { var b = document.getElementById('solverBadge'); return { hidden: b.hidden, text: b.textContent, state: b.dataset.state }; })()");
  const splitWarning = await evaluate("document.getElementById('solverWarning').hidden ? '' : document.getElementById('solverWarning').textContent");
  const splitResidualRow = await evaluate("document.querySelector('[data-check-id=rockerResidual]').className");
  check('4.1 case splits frame.converged from solverOk', splitFrame === true && splitSnapshot.solverOk === false, JSON.stringify({ solverOk: splitSnapshot.solverOk, state: splitSnapshot.solverState }));
  check('4.1 badge reports degradation or failure', splitBadge.hidden === false && (splitBadge.text.indexOf('求解降级') >= 0 || splitBadge.text.indexOf('求解失败') >= 0), JSON.stringify(splitBadge));
  check('4.1 residual row and warning expose the residual', splitResidualRow.indexOf('is-error') >= 0 || splitResidualRow.indexOf('is-warn') >= 0, splitResidualRow + ' / ' + splitWarning.slice(0, 80));
  const dynamicTests = await evaluate('window.FSApp.runDynamicSelfTests().length');
  await evaluate('window.FSApp.openModel()');
  await waitFor(client, "document.querySelectorAll('#selfTestList li').length >= 24", 4000);
  const modalItems = await evaluate("document.querySelectorAll('#selfTestList li').length");
  check('self-tests expose 10 dynamic and 24 total entries', dynamicTests >= 10 && modalItems >= 24, dynamicTests + ' dynamic / ' + modalItems + ' total');
  await evaluate('window.FSApp.closeModel()');
  await evaluate("document.getElementById('btnToggleTelemetry').click()");
  await sleep(300);
  const badgeWithPanelClosed = await evaluateJson("(function () { var b = document.getElementById('solverBadge'); return { hidden: b.hidden, visible: b.offsetParent !== null }; })()");
  check('solver badge stays visible with the telemetry panel closed', badgeWithPanelClosed.hidden === false && badgeWithPanelClosed.visible === true, JSON.stringify(badgeWithPanelClosed));
  await evaluate("document.getElementById('btnToggleTelemetry').click()");
  await evaluate('window.FSApp.reset()');
  await sleep(700);
  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await sleep(500);
  check('solver display recovers after reset', (await evaluateJson('window.FSApp.getSnapshot().solverState')) === 'ok' && (await evaluate("document.getElementById('solverBadge').hidden")) === true);

  setGroup('assets');
  const threeGlobal = await evaluate('Boolean(window.THREE && window.THREE.Material && window.THREE.BufferGeometry && window.THREE.Material.prototype && typeof window.THREE.Material.prototype.dispose === "function" && window.THREE.BufferGeometry.prototype && typeof window.THREE.BufferGeometry.prototype.dispose === "function")');
  if (!threeGlobal) {
    check('B5.4 rebuild releases materials and geometry', false, 'window.THREE Material/BufferGeometry prototype unavailable');
  } else {
    await evaluate("(function () { if (window.__uiDisposeHooked) return; window.__uiMatDispose = 0; window.__uiGeomDispose = 0; var materialProto = window.THREE.Material.prototype; var materialDispose = materialProto.dispose; materialProto.dispose = function () { window.__uiMatDispose += 1; return materialDispose.call(this); }; var geometryProto = window.THREE.BufferGeometry.prototype; var geometryDispose = geometryProto.dispose; geometryProto.dispose = function () { window.__uiGeomDispose += 1; return geometryDispose.call(this); }; window.__uiDisposeHooked = true; })()");
    await evaluate('window.FSApp.setState({ wheelbase: 3.70 })');
    const released = await waitFor(client, 'window.__uiMatDispose >= 3 && window.__uiGeomDispose > 0', 4000);
    const disposeCounts = await evaluateJson('({ materialDisposed: window.__uiMatDispose, geometryDisposed: window.__uiGeomDispose })');
    check('B5.4 rebuild releases materials and geometry', released === true, 'materialDisposed=' + disposeCounts.materialDisposed + ' geometryDisposed=' + disposeCounts.geometryDisposed);
    await evaluate('window.FSApp.setState({ wheelbase: 3.55 })');
    await waitForRebuild(client);
    await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  }

  setGroup('display');
  const copy = await evaluate("document.querySelector('#showLoads').closest('label').querySelector('small').textContent");
  check('load-arrow copy states the linear contract', /正比/.test(copy) && /0\.30 m/.test(copy) && /4\.5 倍封顶/.test(copy), copy.trim());
  const arrow = await evaluateJson("(function () { var probe = window.FSApp.getSceneProbe(); var snap = window.FSApp.getSnapshot(); var avg = snap.totalWeight / 4; var expected = 0.30 / avg; var worst = 0; for (var i = 0; i < 4; i += 1) { var load = snap.loads[i]; var height = probe.loadArrowHeights[i]; if (load > 0.5) worst = Math.max(worst, Math.abs(height / load - expected) / expected); } return { worst: worst, heights: probe.loadArrowHeights, loads: snap.loads, avg: avg }; })()");
  check('load-arrow height is linear in load', arrow.worst < 1e-12, 'worst rel ' + arrow.worst.toExponential(2));
  await evaluate("document.getElementById('showLoads').click()");
  await sleep(220);
  check('load-arrow toggle updates the setup state', (await evaluateJson('window.FSApp.getState().showLoads')) === false);
  await evaluate("document.getElementById('showLoads').click()");

  setGroup('offline');
  await send('Network.enable');
  networkRequests.length = 0;
  await send('Page.reload');
  const readyAfterReload = await waitReady(client);
  await sleep(700);
  const external = networkRequests.filter(function (url) { return !/^(file:|data:)/.test(url); });
  check('reload keeps every request local', readyAfterReload === true && networkRequests.length > 0 && external.length === 0, networkRequests.length + ' requests, ' + external.join(' | '));
  check('no page errors after reload', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  failures += 1;
  if (error instanceof BrowserEnvError) envFailure += 1;
  console.error('FAIL ui browser test [' + group + ']:', error && error.message ? error.message : error);
} finally {
  if (client) await client.close();
  try { await unlink(artifact); } catch (_) { /* noop */ }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' / ' + checks + ' ui check(s) failed  [artifact ' + built.bytes + ' B  sha256 ' + built.sha256 + ']');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  ' + checks + ' ui checks  [artifact ' + built.bytes + ' B  sha256 ' + built.sha256 + ']');
