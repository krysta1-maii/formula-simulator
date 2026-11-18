#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolveRequestPath, createDevServer } from './dev-server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
let checks = 0;

function check(name, ok, detail = '') {
  checks += 1;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures += 1;
}

const cases = [
  ['/index.html', 200],
  ['/../fs-secret/x', 403],
  ['/..%2fREADME.md', 403],
  ['/%00', 400],
  ['/src/../index.html', 200]
];
for (const [url, status] of cases) {
  const result = resolveRequestPath(root, url);
  check('resolve ' + url, result.status === status, 'status ' + result.status + ' / ' + (result.reason || result.rel || ''));
}

const instance = await createDevServer({ root, port: 0 });
try {
  const base = 'http://' + instance.host + ':' + instance.port;
  const get = (path, options = {}) => fetch(base + path, options);

  const index = await get('/');
  check('GET / is 200 html', index.status === 200 && String(index.headers.get('content-type')).includes('text/html'), index.status + ' ' + index.headers.get('content-type'));
  check('GET / has no-store', index.headers.get('cache-control') === 'no-store', String(index.headers.get('cache-control')));

  const traversal = await get('/..%2fREADME.md');
  check('GET /..%2fREADME.md is 403', traversal.status === 403, String(traversal.status));

  const directory = await get('/src');
  check('GET /src is 404 (no directory listing)', directory.status === 404, String(directory.status));

  const post = await get('/', { method: 'POST' });
  check('POST / is 405', post.status === 405, String(post.status));

  const head = await get('/', { method: 'HEAD' });
  const headBody = await head.text();
  check('HEAD / is 200 and empty', head.status === 200 && headBody.length === 0, head.status + ' body ' + headBody.length);
} finally {
  await instance.close();
}

if (process.platform !== 'win32') {
  const tempRoot = await mkdtemp(join(tmpdir(), 'fs-dev-server-'));
  await writeFile(join(tempRoot, 'index.html'), '<!doctype html><title>temp</title>', 'utf8');
  await symlink('/etc/passwd', join(tempRoot, 'escape'));
  const tempServer = await createDevServer({ root: tempRoot, port: 0 });
  try {
    const escaped = await fetch('http://' + tempServer.host + ':' + tempServer.port + '/escape');
    check('symlink outside root is 403', escaped.status === 403, String(escaped.status));
  } finally {
    await tempServer.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

console.log('');
if (failures) {
  console.log('FAIL  ' + failures + ' / ' + checks + ' dev-server checks failed');
  process.exit(1);
}
console.log('PASS  ' + checks + ' dev-server checks');
