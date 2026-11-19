import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertBuildCurrent } from './check-build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export class BrowserEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserEnvError';
  }
}

export function findChrome() {
  const explicit = process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

export function requiredChrome() {
  return process.env.FS_REQUIRE_CHROME === '1' || process.env.FS_REQUIRE_CHROME === 'true' ||
    process.env.CI === '1' || process.env.CI === 'true';
}

export function browserGate(label, { required = requiredChrome() } = {}) {
  const explicitSkip = process.env.FS_SKIP_BROWSER === '1' || process.env.FS_SKIP_BROWSER === 'true';
  if (explicitSkip && required) {
    console.error('FAIL ' + label + ': FS_SKIP_BROWSER=1 conflicts with FS_REQUIRE_CHROME=1');
    process.exit(1);
  }
  if (explicitSkip) {
    console.log('SKIP ' + label + ': FS_SKIP_BROWSER=1');
    process.exit(0);
  }
  const chromePath = findChrome();
  if (!chromePath) {
    const message = label + ': no Chrome/Chromium binary found (set CHROME_PATH to enable)';
    if (required) {
      console.error('FAIL ' + message);
      process.exit(1);
    }
    console.log('SKIP ' + message);
    process.exit(0);
  }
  if (typeof WebSocket !== 'function') {
    const message = label + ': global WebSocket requires Node >= 21 (current ' + process.version + ')';
    if (required) {
      console.error('FAIL ' + message);
      process.exit(1);
    }
    console.log('SKIP ' + message);
    process.exit(0);
  }
  return chromePath;
}

function readDevToolsPort(profile) {
  try {
    const lines = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    const port = Number(lines[0]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch (_) {
    return null;
  }
}

async function findTarget(port, pageUrl) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((response) => response.json());
      const page = list.find((target) => target.type === 'page' && (target.url === pageUrl || target.url.startsWith('file://')));
      if (page) return page;
    } catch (_) {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new BrowserEnvError('Chrome did not expose the test page');
}

function connect(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolvePromise(socket);
    socket.onerror = () => rejectPromise(new BrowserEnvError('CDP websocket failed'));
  });
}

export async function launchBrowser({
  chromePath,
  pagePath = join(ROOT, 'index.html'),
  width = 1280,
  height = 900,
  timeoutMs = 90000,
  verifyBuild = true
} = {}) {
  if (!chromePath) throw new BrowserEnvError('no Chrome/Chromium path');
  const artifact = verifyBuild ? await assertBuildCurrent({ root: ROOT, target: pagePath }) : null;
  const profile = mkdtempSync(join(tmpdir(), 'fs-browser-'));
  const pageUrl = pathToFileURL(pagePath).href;
  const child = spawn(chromePath, [
    '--headless=new',
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-debugging-port=0',
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
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8000);
  });
  let socket = null;
  let closed = false;
  let watchdog = null;

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (watchdog) clearTimeout(watchdog);
    try { if (socket) socket.close(); } catch (_) { /* noop */ }
    try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* noop */ }
  };

  try {
    watchdog = setTimeout(() => {
      cleanup().finally(() => {
        console.error('FAIL browser environment: timed out after ' + timeoutMs + ' ms');
        process.exit(2);
      });
    }, timeoutMs);

    let port = null;
    for (let attempt = 0; attempt < 100 && !port; attempt += 1) {
      port = readDevToolsPort(profile);
      if (!port) await sleep(100);
    }
    if (!port) throw new BrowserEnvError('Chrome did not write DevToolsActivePort');
    const target = await findTarget(port, pageUrl);
    socket = await connect(target.webSocketDebuggerUrl);

    let messageId = 1;
    const pending = new Map();
    const pageErrors = [];
    const networkRequests = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent' && message.params && message.params.request) {
        networkRequests.push(message.params.request.url);
      }
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

    const send = (method, params = {}) => new Promise((resolvePromise, rejectPromise) => {
      const id = messageId;
      messageId += 1;
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      socket.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception));
      return result.result.value;
    };

    const evaluateJson = async (expression) => JSON.parse(await evaluate('JSON.stringify(' + expression + ')'));

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');

    let ready = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate('Boolean(window.FSApp && window.FSApp.ready)').catch(() => false)) {
        ready = true;
        break;
      }
      await sleep(200);
    }
    if (!ready) throw new BrowserEnvError('FSApp did not become ready');
    await sleep(600);

    return {
      send, evaluate, evaluateJson, pageErrors, networkRequests, close: cleanup, port,
      artifactSha256: artifact ? artifact.expectedHash : null
    };
  } catch (error) {
    await cleanup();
    if (error instanceof BrowserEnvError) throw error;
    const tail = stderr ? '; chrome stderr: ' + stderr.trim().split('\n').slice(-5).join(' | ') : '';
    throw new BrowserEnvError(error.message + tail);
  }
}

export function runCiBrowser() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const scripts = ['test:browser', 'test:suspension', 'test:camera', 'test:ui'];
  for (const script of scripts) {
    const result = spawnSync(npm, ['run', script], {
      cwd: ROOT,
      stdio: 'inherit',
      env: Object.assign({}, process.env, { FS_REQUIRE_CHROME: '1' })
    });
    if (result.error) {
      console.error('FAIL ci:browser: ' + result.error.message);
      return 1;
    }
    if (result.status !== 0) return result.status === null ? 1 : result.status;
  }
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--ci')) process.exitCode = runCiBrowser();
  else {
    console.error('usage: node tools/browser-runner.mjs --ci');
    process.exitCode = 2;
  }
}

export { ROOT, CANDIDATES };
