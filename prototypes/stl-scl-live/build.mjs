// PROTOTYPE (throwaway, ticket #37): inline everything into dist/stl-scl-live.html (opens by double-click).
// Each ES module becomes a function scope; imports become lookups in a tiny module table, so the
// page needs no module loader and no server. Run `node check.mjs` first: its gate-report.json is embedded.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8').replace(/\r\n/g, '\n');
const ORDER = ['s7core.mjs', 'stl.mjs', 'scl.mjs', 'listings/rulings.mjs', 'app.mjs'];

function wrap(path) {
  let src = read(path); const exported = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, from) => {
    const target = posix.normalize(posix.join(posix.dirname(path), from));
    return `const {${names.replace(/\s+as\s+/g, ': ')}} = __m[${JSON.stringify(target)}];`;
  });
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => { exported.push(name); return `${kw} ${name}`; });
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${path}: unsupported import/export form`);
  return `__m[${JSON.stringify(path)}] = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

if (!existsSync(join(HERE, 'gate-report.json'))) throw new Error('gate-report.json missing: run node check.mjs first');
const listings = { tank: read('listings/tank.awl'), warehouse: read('listings/warehouse.scl') };
const script = [
  `const LISTINGS = ${JSON.stringify(listings)};`,
  `const GATE_REPORT = ${read('gate-report.json').trim()};`,
  'const __m = {};',
  ...ORDER.map(wrap),
].join('\n').replace(/<\/script/gi, '<\\/script');

const css = [read('pad.css'), read('page.css')].join('\n');
const fontImport = css.match(/@import url\("([^"]+)"\);/);
const html = read('index.html')
  .replace('<!-- BUILD:CSS -->', `${fontImport ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fontImport[1]}">` : ''}\n<style>\n${css.replace(/@import url\("[^"]+"\);/, '')}\n</style>`)
  .replace('<!-- BUILD:SCRIPT -->', `<script>\n"use strict";\n${script}\n</script>`);

mkdirSync(join(HERE, 'dist'), { recursive: true });
writeFileSync(join(HERE, 'dist', 'stl-scl-live.html'), html);
console.log(`dist/stl-scl-live.html  ${(html.length / 1024).toFixed(1)} KB  (gate ${JSON.parse(read('gate-report.json')).result})`);
