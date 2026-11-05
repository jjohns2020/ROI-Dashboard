/**
 * Copies the app's sample dataset into the prototype HTML so parity compares the same clients and months.
 * Run after changing src/data/sample/library.ts: node scripts/sync-prototype-data.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const mod = await server.ssrLoadModule('/src/data/dataSource.ts');
const ds = mod.sampleDataSource.load();
await server.close();

const file = readdirSync(root).find((name) => /^CO_ROI_Dashboard_Mockup.*\.html$/.test(name));
if (!file) throw new Error('Prototype HTML not found');
let html = readFileSync(resolve(root, file), 'utf8');

function js(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function endOfStatement(src, i) {
  while (/\s/.test(src[i])) i++;
  const stack = [];
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{' || c === '[') {
      stack.push(c);
      continue;
    }
    if (c === '}' || c === ']') {
      stack.pop();
      if (!stack.length) return src[j + 1] === ';' ? j + 2 : j + 1;
      continue;
    }
    if (!stack.length && c === ';') return j + 1;
  }
  throw new Error('Unterminated statement');
}

function replaceConst(src, name, value) {
  const token = `const ${name}=`;
  const start = src.indexOf(token);
  if (start < 0) throw new Error(`Missing ${token}`);
  const end = endOfStatement(src, start + token.length);
  return src.slice(0, start) + token + js(value) + ';' + src.slice(end);
}

for (const name of ['clients', 'monthly', 'opps', 'months', 'scrubData', 'details', 'insights', 'guarRatio', 'medSplit', 'loads']) {
  html = replaceConst(html, name, ds[name]);
}

const checkFrom = "ok('Monthly Trend has 24 months for year-over-year','REVIEW','Monthly Trend — 21 months, sample data');";
const checkTo =
  "ok('Monthly Trend has 24 months for year-over-year',monthly[k].months.length>=24?'PASS':'REVIEW',monthly[k].months.length>=24?'Monthly Trend — 24 months; Oct–Dec 2025 is illustrative':'Monthly Trend — '+monthly[k].months.length+' months, sample data');";
if (!html.includes(checkFrom)) throw new Error('Monthly data-check text not found');
html = html.replace(checkFrom, checkTo);

const rangeFrom = 'fI=0,tI=20;';
if (!html.includes(rangeFrom)) throw new Error('Initial month index not found');
html = html.replace(rangeFrom, 'fI=0,tI=23;');

writeFileSync(resolve(root, file), html);
console.log(`Updated ${file}: ${Object.keys(ds.clients).join(', ')}; ${ds.monthly.maine.months.length} months.`);
