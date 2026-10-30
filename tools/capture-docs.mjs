#!/usr/bin/env node
/**
 * Documentation capture helper.
 *
 * Renders the built index.html in headless Chrome and writes the stage-02
 * preview images into docs/. Run after tools/build.mjs.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chromePath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.log('SKIP capture: no Chrome/Chromium binary found.');
  process.exit(0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = join(root, 'docs');
const pageUrl = 'file://' + join(root, 'index.html');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let port = 9600 + Math.floor(Math.random() * 200);

async function openPage(width, height) {
  const chromePort = port++;
  const profile = mkdtempSync(join(tmpdir(), 'fs-capture-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-debugging-port=' + chromePort,
    '--user-data-dir=' + profile,
    '--window-size=' + width + ',' + height,
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

  let target = null;
  for (let i = 0; i < 150 && !target; i += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + chromePort + '/json/list').then((res) => res.json());
      target = list.find((item) => item.type === 'page' && item.url.includes('index.html'));
    } catch (_) { /* Chrome is still starting. */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('Chrome did not expose the app page');

  const socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  });
  let messageId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = messageId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const capture = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(docs, name), Buffer.from(result.data, 'base64'));
    console.log('  saved docs/' + name);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  for (let i = 0; i < 200; i += 1) {
    if (await evaluate('Boolean(window.FSApp && window.FSApp.ready)').catch(() => false)) break;
    await sleep(200);
  }
  await sleep(1400);
  return { send, evaluate, capture, socket, chrome, profile };
}

async function closePage(client) {
  try { client.socket.close(); } catch (_) { /* noop */ }
  client.chrome.kill('SIGKILL');
  await sleep(300);
  try { rmSync(client.profile, { recursive: true, force: true }); } catch (_) { /* noop */ }
}

function latestDownload() {
  const files = readdirSync(docs).filter((name) => name.startsWith('FS-01_dynamic_') && name.endsWith('.png'));
  if (!files.length) return null;
  return files.sort().pop();
}

const main = async () => {
  const client = await openPage(1440, 900);
  const { evaluate, capture, send } = client;

  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await capture('01-overview.png');

  await evaluate('window.FSApp.setState({ slope: 8, bank: 7, friction: 1.4 })');
  await evaluate('window.FSApp.advanceSimulation(2.2)');
  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  await capture('02-tilt.png');

  await evaluate('window.FSApp.setState({ slope: 0, bank: 0, friction: 1.4, xray: true })');
  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  await capture('03-xray.png');

  await evaluate("window.FSApp.setCameraPreset('inspectSteering', true)");
  await capture('06-steering.png');
  await evaluate("window.FSApp.setCameraPreset('inspectArb', true)");
  await capture('07-arb-front.png');
  await evaluate("window.FSApp.setCameraPreset('inspectArbRear', true)");
  await capture('08-arb-rear.png');

  await evaluate('window.FSApp.setState({ xray: false })');
  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
  await evaluate("document.querySelector('#panelControls .panel-scroll').scrollTop = 99999");
  await evaluate("document.getElementById('btnImpulseHeave').click()");
  await evaluate('window.FSApp.advanceSimulation(0.08)');
  await evaluate('window.FSApp.setSimRunning(false)');
  await sleep(300);
  await capture('09-dynamics.png');
  await evaluate('window.FSApp.setSimRunning(true)');

  await evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await evaluate('window.FSApp.openModel()');
  await sleep(900);
  await evaluate("document.getElementById('selfTestSummary').scrollIntoView({ block: 'center' })");
  await sleep(500);
  await capture('10-selftests.png');
  await evaluate('window.FSApp.closeModel()');

  const downloadPath = join(docs, '.downloads');
  try { rmSync(downloadPath, { recursive: true, force: true }); } catch (_) { /* noop */ }
  try {
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
    await evaluate("window.FSApp.setCameraPreset('threeQuarter', true)");
    await evaluate('window.FSApp.exportScreenshot()');
    await sleep(1800);
    const files = readdirSync(downloadPath).filter((name) => name.endsWith('.png'));
    if (files.length) {
      renameSync(join(downloadPath, files[0]), join(docs, '04-export.png'));
      console.log('  saved docs/04-export.png');
    }
    rmSync(downloadPath, { recursive: true, force: true });
  } catch (error) {
    console.log('  export capture skipped: ' + error.message);
  }
  await closePage(client);

  const mobile = await openPage(390, 844);
  await mobile.evaluate('window.FSApp.resetDynamics({ settle: 1 })');
  await sleep(500);
  await mobile.capture('05-mobile.png');
  await closePage(mobile);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
