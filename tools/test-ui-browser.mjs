#!/usr/bin/env node
/**
 * UI browser checks. This round ships the viewport and display groups; the
 * keyboard, focus, state and solver groups will be added after B3 lands.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { build } from './build.mjs';
import { browserGate, launchBrowser, BrowserEnvError, sleep } from './browser-runner.mjs';

let failures = 0;
let envFailure = false;

function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

const metricsScript = "(function () {" +
  "function rect(selector) { var el = document.querySelector(selector); if (!el) return null; var b = el.getBoundingClientRect(); var s = getComputedStyle(el); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, display: s.display }; }" +
  "return { innerWidth: innerWidth, innerHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, app: rect('#app'), topbar: rect('.topbar'), bottomBar: rect('.bottom-bar') };" +
  "})()";

const chromePath = browserGate('ui');
const artifact = join(tmpdir(), 'fs-ui-' + process.pid + '.html');
const built = await build({ out: artifact });
let client = null;

try {
  client = await launchBrowser({ chromePath, pagePath: artifact, width: 1280, height: 900 });
  const { send, evaluate, evaluateJson, pageErrors } = client;

  const sizes = [
    [844, 390],
    [667, 375],
    [1024, 400],
    [1280, 720]
  ];
  for (const [width, height] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(350);
    const metrics = await evaluateJson(metricsScript);
    const label = width + 'x' + height;
    const inView = (rect) => Boolean(rect) && rect.display !== 'none' && rect.top >= -1 && rect.bottom <= metrics.innerHeight + 1 && rect.left >= -1 && rect.right <= metrics.innerWidth + 1;
    check(label + ' has no page overflow', metrics.scrollWidth <= metrics.innerWidth + 1 && metrics.scrollHeight <= metrics.innerHeight + 1, metrics.scrollWidth + 'x' + metrics.scrollHeight + ' vs ' + metrics.innerWidth + 'x' + metrics.innerHeight);
    check(label + ' app fills the viewport', Boolean(metrics.app) && Math.abs(metrics.app.height - metrics.innerHeight) <= 1, metrics.app ? metrics.app.height.toFixed(1) + ' vs ' + metrics.innerHeight : 'missing');
    check(label + ' topbar and toolbar are visible', inView(metrics.topbar) && inView(metrics.bottomBar), JSON.stringify({ topbar: metrics.topbar, bottomBar: metrics.bottomBar }));

    if (width === 844 && height === 390) {
      const netHeight = metrics.bottomBar.top - metrics.topbar.bottom;
      check('844x390 leaves at least 55% for the scene', netHeight >= metrics.innerHeight * 0.55, netHeight.toFixed(1) + ' / ' + metrics.innerHeight);
      await evaluate("(function () { var p = document.getElementById('panelControls'); if (p.classList.contains('is-open')) { var closes = document.querySelectorAll('[data-close-panel]'); if (closes[0]) closes[0].click(); } })()");
      await sleep(260);
      await evaluate("document.getElementById('btnToggleControls').click()");
      await sleep(380);
      const panel = await evaluateJson("(function () { var p = document.getElementById('panelControls'); var b = p.getBoundingClientRect(); var s = document.getElementById('btnScreenshot'); var sb = s.getBoundingClientRect(); return { open: p.classList.contains('is-open'), top: b.top, bottom: b.bottom, screenshotTop: sb.top, screenshotBottom: sb.bottom, viewport: innerHeight }; })()");
      check('844x390 panel stays inside the viewport', panel.open && panel.bottom <= panel.viewport + 1 && panel.top >= -1, JSON.stringify(panel));
      check('844x390 screenshot button is visible', panel.screenshotTop >= 0 && panel.screenshotBottom <= panel.viewport + 1, panel.screenshotTop.toFixed(1) + '..' + panel.screenshotBottom.toFixed(1));
      await evaluate("document.querySelectorAll('[data-close-panel]')[0].click()");
      await sleep(250);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(250);

  const copy = await evaluate("document.querySelector('#showLoads').closest('label').querySelector('small').textContent");
  check('load-arrow copy states the linear contract', /正比/.test(copy) && /0\.30 m/.test(copy) && /4\.5 倍封顶/.test(copy), copy.trim());
  check('load arrows are enabled by default', (await evaluate("document.getElementById('showLoads').checked")) === true);
  await evaluate("document.getElementById('showLoads').click()");
  await sleep(250);
  check('toggling load arrows updates the setup state', (await evaluateJson('window.FSApp.getState().showLoads')) === false);
  await evaluate("document.getElementById('showLoads').click()");
  await sleep(250);
  check('toggling load arrows back restores the state', (await evaluateJson('window.FSApp.getState().showLoads')) === true);
  const probe = await evaluateJson('window.FSApp.getSceneProbe()');
  check('display probe stays finite', Array.isArray(probe.springs) && probe.springs.every((value) => Number.isFinite(value)), 'springs ' + probe.springs.length);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  failures += 1;
  if (error instanceof BrowserEnvError) envFailure = true;
  console.error('FAIL ui browser test:', error && error.message ? error.message : error);
} finally {
  if (client) await client.close();
  try { await unlink(artifact); } catch (_) { /* noop */ }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' ui check(s) failed  [artifact ' + built.sha256 + ']');
  process.exit(envFailure ? 2 : 1);
}
console.log('PASS  ui checks  [artifact ' + built.bytes + ' B  sha256 ' + built.sha256 + ']');
