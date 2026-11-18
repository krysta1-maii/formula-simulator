import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, sleep } from '../audit/_harness.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE_URL = 'file://' + join(ROOT, 'index.html');
const CHROME_CANDIDATES = [
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

export function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

async function findTarget(port) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((response) => response.json());
      const page = list.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page;
    } catch (error) {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error('Chrome did not expose the audit page');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error('CDP websocket failed'));
  });
}

async function launch(chromePath) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'fs-audit-'));
  const child = spawn(chromePath, [
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
    PAGE_URL
  ], { stdio: 'ignore' });

  let socket = null;
  const cleanup = async () => {
    try { if (socket) socket.close(); } catch (error) { /* noop */ }
    try { child.kill('SIGKILL'); } catch (error) { /* noop */ }
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch (error) { /* noop */ }
  };

  try {
    const target = await findTarget(port);
    socket = await connect(target.webSocketDebuggerUrl);
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
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = messageId;
      messageId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
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
    if (!ready) throw new Error('FSApp did not become ready');
    await sleep(600);

    return { send, evaluate, evaluateJson, pageErrors, close: cleanup, port };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function runBrowserAudit(meta, fn) {
  await runAudit(meta, async (audit) => {
    const chromePath = findChrome();
    if (!chromePath) {
      const required = process.env.FS_REQUIRE_CHROME === '1' || process.env.FS_REQUIRE_CHROME === 'true';
      if (required) throw new Error('Chrome/Chromium not found; FS_REQUIRE_CHROME is set');
      audit.skip('browser/chrome', 'Chrome/Chromium not found; set CHROME_PATH to enable');
      return;
    }
    const context = await launch(chromePath);
    try {
      await fn(audit, context);
      audit.check(
        meta.audit + '/page-errors',
        context.pageErrors.length === 0,
        { pageErrors: context.pageErrors.slice(0, 10) },
        'pageErrors.length === 0',
        'uncaught exceptions and console errors'
      );
    } finally {
      await context.close();
    }
  });
}

export { ROOT };
