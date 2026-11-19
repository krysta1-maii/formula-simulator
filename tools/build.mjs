import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function renderIndexHtml({ root = ROOT } = {}) {
  const read = (p) => readFile(join(root, p), 'utf8');
  const template = await read('src/index.template.html');
  const styles = await read('src/styles.css');
  const three = await read('vendor/three.min.js');
  const files = (await readdir(join(root, 'src/js')))
    .filter((f) => f.endsWith('.js'))
    .sort();
  const app = (await Promise.all(files.map((f) => read('src/js/' + f)))).join('\n\n');
  for (const [name, source] of [['styles', styles], ['three', three], ['app', app]]) {
    if (/<\/script\b/i.test(source)) throw new Error(name + ' contains a literal </script> end tag; escape it before embedding');
  }
  const placeholders = [
    ['/*__STYLES__*/', styles],
    ['/*__THREE__*/', three],
    ['/*__APP__*/', app]
  ];
  for (const [token] of placeholders) {
    const count = template.split(token).length - 1;
    if (count !== 1) throw new Error('template must contain exactly one ' + token + ' placeholder; found ' + count);
  }
  const inlineApp = '<script>\n(function () {\n\'use strict\';\n' + app + '\n})();\n</script>';
  let html = template;
  for (const [token, source] of placeholders) {
    const replacement = token === '/*__APP__*/' ? inlineApp : source;
    html = html.replace(token, () => replacement);
  }
  for (const [token] of placeholders) {
    if (html.includes(token)) throw new Error('template placeholder replacement failed: ' + token);
  }
  return { html, files };
}

export async function build({ root = ROOT, out = null, write = true } = {}) {
  const { html, files } = await renderIndexHtml({ root });
  const target = out ? resolve(process.cwd(), out) : join(root, 'index.html');
  if (write) await writeFile(target, html, 'utf8');
  return {
    html,
    files,
    target,
    bytes: Buffer.byteLength(html, 'utf8'),
    sha256: sha256(html)
  };
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  const result = await build({ out, write: true });
  console.log('built ' + result.target + '  ' + result.bytes + ' B  sha256 ' + result.sha256 + '  [' + result.files.join(', ') + ']');
}
