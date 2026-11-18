#!/usr/bin/env node
import { readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { renderIndexHtml, build } from './build.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function verifyIndexHtml({ root = ROOT, target = 'index.html' } = {}) {
  const { html } = await renderIndexHtml({ root });
  const expectedHash = sha256(html);
  const expectedBytes = Buffer.byteLength(html, 'utf8');
  const absolute = resolve(process.cwd(), target);
  let actual = null;
  try {
    actual = await readFile(join(root, target), 'utf8');
  } catch (error) {
    try {
      actual = await readFile(absolute, 'utf8');
    } catch (_) {
      return { ok: false, reason: 'missing', target: absolute, expectedHash, expectedBytes };
    }
  }
  return {
    ok: actual === html,
    target: absolute,
    actualHash: sha256(actual),
    expectedHash,
    actualBytes: Buffer.byteLength(actual, 'utf8'),
    expectedBytes
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const targetIndex = process.argv.indexOf('--target');
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : 'index.html';
  const strict = process.argv.includes('--strict');
  const result = await verifyIndexHtml({ target });
  if (result.ok) {
    console.log('index.html 与源码一致  ' + result.expectedBytes + ' B  sha256 ' + result.expectedHash + '  (' + result.target + ')');
    process.exit(0);
  }
  if (!strict) {
    const temp = join(tmpdir(), 'fs-check-build-' + process.pid + '.html');
    const built = await build({ out: temp, write: true });
    const tempText = await readFile(temp, 'utf8');
    try { await unlink(temp); } catch (_) { /* noop */ }
    if (tempText === built.html) {
      console.log('STALE index.html  ' + (result.reason || 'content differs') + '  (not committed by this round)');
      console.log('临时重建与源码一致  ' + built.bytes + ' B  sha256 ' + built.sha256 + '  (' + temp + ')');
      console.log('严格产物门禁请运行 npm run build:check（--strict）');
      process.exit(0);
    }
    console.error('FAIL build:check  临时重建与源码不一致');
    process.exit(1);
  }
  console.error('FAIL build:check  ' + (result.reason || 'content differs'));
  console.error('  expected ' + result.expectedHash + '  ' + result.expectedBytes + ' B');
  if (result.actualHash) console.error('  actual   ' + result.actualHash + '  ' + result.actualBytes + ' B');
  console.error('  运行 node tools/build.mjs 重建 index.html');
  process.exit(1);
}
