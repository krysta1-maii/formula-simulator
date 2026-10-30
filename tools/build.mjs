import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFile(join(root, p), 'utf8');

const template = await read('src/index.template.html');
const styles = await read('src/styles.css');
const three = await read('vendor/three.min.js');

const files = (await readdir(join(root, 'src/js')))
  .filter((f) => f.endsWith('.js'))
  .sort();
const app = (await Promise.all(files.map((f) => read(`src/js/${f}`)))).join('\n\n');

for (const [name, source] of [['styles', styles], ['three', three], ['app', app]]) {
  if (source.includes('</script>')) throw new Error(`${name} contains a literal </script>; escape it before embedding`);
}

const inlineApp = `<script>\n(function () {\n'use strict';\n${app}\n})();\n</script>`;
const html = template
  .replace('/*__STYLES__*/', () => styles)
  .replace('/*__THREE__*/', () => three)
  .replace('/*__APP__*/', () => inlineApp);

if (html.includes('/*__STYLES__*/') || html.includes('/*__THREE__*/') || html.includes('/*__APP__*/')) {
  throw new Error('template placeholder replacement failed');
}
await writeFile(join(root, 'index.html'), html);
console.log(`built index.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB  [${files.join(', ')}]`);
