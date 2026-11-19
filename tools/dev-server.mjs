import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function containsDotfile(path) {
  return String(path).split(/[\\/]+/).some((part) => part.startsWith('.'));
}

export function resolveRequestPath(root, requestUrl, { allowDotfiles = false } = {}) {
  let pathname;
  try {
    pathname = decodeURIComponent((requestUrl || '/').split('?')[0]);
  } catch (_) {
    return { status: 400, reason: 'bad-uri' };
  }
  if (pathname.includes('\0')) return { status: 400, reason: 'nul-byte' };
  if (pathname === '/') pathname = '/index.html';
  const target = normalize(join(root, pathname));
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return { status: 403, reason: 'outside-root' };
  }
  if (!allowDotfiles && containsDotfile(rel)) {
    return { status: 403, reason: 'dotfile' };
  }
  return { status: 200, path: target, rel };
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': payload.length
  }, headers));
  if (res.req && res.req.method === 'HEAD') res.end();
  else res.end(payload);
}

export async function createDevServer({ root = ROOT, port = 0, host = '127.0.0.1', allowDotfiles = false } = {}) {
  const realRoot = await realpath(root);
  const server = createServer(async (req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const resolved = resolveRequestPath(root, req.url || '/', { allowDotfiles });
    if (resolved.status !== 200) {
      send(res, resolved.status, resolved.status === 400 ? 'Bad request' : 'Forbidden');
      return;
    }
    try {
      const actual = await realpath(resolved.path);
      const rel = relative(realRoot, actual);
      if (rel.startsWith('..') || isAbsolute(rel) || (!allowDotfiles && containsDotfile(rel))) {
        send(res, 403, 'Forbidden');
        return;
      }
      const body = await readFile(actual);
      const type = TYPES[extname(actual).toLowerCase()] || 'application/octet-stream';
      send(res, 200, body, { 'Content-Type': type });
    } catch (_) {
      send(res, 404, 'Not found');
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => rejectPromise(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolvePromise();
    });
  });
  const address = server.address();
  return {
    server,
    port: address && typeof address === 'object' ? address.port : port,
    host,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    })
  };
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const port = Number(process.env.PORT || 8731);
  const instance = await createDevServer({ port });
  console.log('dev server: http://' + instance.host + ':' + instance.port);
}
