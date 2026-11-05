/**
 * Parity check: drives the original prototype (CO_ROI_Dashboard_Mockup*.html) and the built app (dist/)
 * through identical UI action sequences and compares the rendered text and SVG chart geometry after each step.
 *
 * Usage: npm run build && npm run parity
 * Requires Chrome/Chromium (CHROME_PATH, default /usr/local/bin/google-chrome).
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const prototype = readdirSync(root).find((f) => /^CO_ROI_Dashboard_Mockup.*\.html$/.test(f));
if (!prototype) throw new Error('Prototype HTML not found');
if (!existsSync(dist)) throw new Error('Run `npm run build` first');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/favicon.ico') return res.writeHead(204).end();
  const file = url === '/prototype' ? join(root, prototype) : join(dist, url === '/' ? 'index.html' : url);
  if (!existsSync(file) || !extname(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu'],
  protocolTimeout: 30000,
});

async function openPage(path) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'load' });
  if (process.env.PARITY_VERBOSE) console.log('loaded', path);
  // The app opens on the sample sign-in. Parity compares the consultant dashboard, which is the full prototype view.
  if (await page.$('#login')) {
    await page.$eval('#loginConsultantPass', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, 'roi');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#loginConsultantSubmit', (el) => el.click());
  }
  await page.waitForSelector('#main .title, #main p', { timeout: 15000 });
  return { page, errors };
}

const snapshot = (page) =>
  page.evaluate(() => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const visible = (el) => el && getComputedStyle(el).display !== 'none';
    const r = (v) => (v == null ? '' : String(v).replace(/-?\d+\.?\d*(e-?\d+)?/g, (n) => String(Math.round(Number(n) * 100) / 100)));
    const svgSig = [...document.querySelectorAll('#main svg')].map((svg) =>
      [...svg.querySelectorAll('*')]
        .filter((el) => el.tagName !== 'g')
        .map((el) => {
          const geo = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'cx', 'cy', 'r', 'points', 'stroke-width', 'font-size', 'font-weight', 'rx'];
          const lit = ['fill', 'stroke', 'stroke-dasharray', 'text-anchor'];
          return (
            el.tagName +
            '(' +
            geo.map((k) => r(el.getAttribute(k))).join(',') +
            '|' +
            lit.map((k) => el.getAttribute(k) || '').join(',') +
            ')' +
            (el.tagName === 'text' ? norm(el.textContent) : '')
          );
        })
        .join(';'),
    );
    const STYLE_PROPS = [
      'display', 'color', 'background-color', 'border-top', 'border-left', 'border-bottom', 'border-radius', 'font-size', 'font-weight',
      'font-style', 'margin', 'padding', 'text-align', 'white-space', 'gap', 'flex-wrap', 'align-items', 'width', 'height',
    ];
    const modalOpen = document.querySelector('#modal').classList.contains('open');
    // The export dialog's download action is app-only; the slide list (#mList) and status (#mStatus) stay comparable.
    const styleSig = [...document.querySelectorAll('header *, nav *, #main *')]
      .filter((el) => !el.closest('svg') && !el.closest('#overviewExport') && !el.closest('#signOut') && !el.closest('#logOut') && !(el.closest('header') && el.classList.contains('spacer')))
      .map((el) => {
        const cs = getComputedStyle(el);
        // Sizes are rounded: React splits interpolated text into several text nodes, which shifts sub-pixel widths.
        const v = (p) => (p === 'width' || p === 'height' ? String(Math.round(parseFloat(cs.getPropertyValue(p)))) : cs.getPropertyValue(p));
        return el.tagName + '.' + el.className + '{' + STYLE_PROPS.map(v).join(';') + '}';
      });
    return {
      nav: norm(document.querySelector('nav').innerText.replace(document.querySelector('#signOut')?.innerText || '', '')),
      // The Word download sits on Executive Highlights and is not part of the prototype.
      main: norm(document.querySelector('#main').innerText.replace(document.querySelector('#overviewExport')?.innerText || '', '')),
      svg: svgSig,
      // Executive Highlights is a separate Word document, so it is no longer listed as a PowerPoint slide.
      modal: modalOpen
        ? norm(document.querySelector('#mList').innerText.replace(/\bExecutive Highlights\b/g, '')) +
          '\n' +
          norm(document.querySelector('#mStatus').innerText)
        : '',
      clientDisabled: document.querySelector('#client').disabled,
      internalPanel: visible(document.querySelector('#internalPanel')),
      presBanner: visible(document.querySelector('#presBanner')),
      from: document.querySelector('#fromM').value,
      to: document.querySelector('#toM').value,
      preset: document.querySelector('#preset').value,
      style: styleSig,
    };
  });

/** Actions that work identically against both implementations. */
const act = {
  select: async (page, sel, value) => {
    await page.select(sel, value);
  },
  // DOM clicks rather than page.click: background tabs never get the animation frames page.click waits for.
  click: async (page, sel) => {
    await page.$eval(sel, (el) => el.click());
  },
  tab: async (page, v) => {
    await page.$eval(`.tab[data-v="${v}"]`, (el) => el.click());
  },
  card: async (page, k) => {
    await page.$eval(`.dcard[data-k="${k}"]`, (el) => el.click());
  },
  button: async (page, text) => {
    const ok = await page.evaluate((text) => {
      const b = [...document.querySelectorAll('#main button, #modal button')].find((x) => x.textContent.trim() === text);
      if (!b) return false;
      b.click();
      return true;
    }, text);
    if (!ok) throw new Error('button not found: ' + text);
  },
};

const tabsOf = (page) => page.evaluate(() => [...document.querySelectorAll('.tab')].map((b) => b.dataset.v));
const cardsOf = (page) => page.evaluate(() => [...document.querySelectorAll('.dcard')].map((b) => b.dataset.k));
const buttonsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#main button')].map((b) => b.textContent.trim()));

let steps = 0,
  failures = 0;
const failLog = [];

function compare(label, a, b) {
  steps++;
  for (const k of Object.keys(a)) {
    const x = JSON.stringify(a[k]),
      y = JSON.stringify(b[k]);
    if (x !== y) {
      failures++;
      let i = 0;
      while (i < x.length && x[i] === y[i]) i++;
      failLog.push(`[${label}] ${k} differs at ${i}:\n  prototype: …${x.slice(Math.max(0, i - 80), i + 120)}\n  app:       …${y.slice(Math.max(0, i - 80), i + 120)}`);
      return;
    }
  }
}

/** Runs a scenario on both implementations, comparing after every step. Steps may expand dynamically. */
async function scenario(name, setup, walk) {
  const P = await openPage('/prototype');
  const A = await openPage('/');
  const both = async (label, fn) => {
    if (process.env.PARITY_VERBOSE) console.log(name, '›', label);
    await fn(P.page);
    if (process.env.PARITY_VERBOSE) console.log('  prototype ok');
    await fn(A.page);
    compare(`${name} › ${label}`, await snapshot(P.page), await snapshot(A.page));
  };
  compare(`${name} › initial`, await snapshot(P.page), await snapshot(A.page));
  for (const [label, fn] of setup) await both(label, fn);
  if (walk) await walk(both, P.page);
  for (const e of [...P.errors.map((x) => 'prototype: ' + x), ...A.errors.map((x) => 'app: ' + x)]) {
    failures++;
    failLog.push(`[${name}] page error ${e}`);
  }
  await P.page.close();
  await A.page.close();
}

/** Visits every nav view, every workflow detail and every in-page toggle reachable from them. */
async function walkAll(both, page) {
  for (const v of await tabsOf(page)) {
    await both(`tab ${v}`, (p) => act.tab(p, v));
    if (v === 'trend') {
      for (const s of ['Return Mail', 'Address Verification (PIV)', 'Bankruptcy', 'Deceased', 'Medicaid', 'Charity']) {
        if (!(await buttonsOf(page)).includes(s)) continue;
        await both(`trend scrub ${s}`, (p) => act.button(p, s));
        for (const t of ['Guarantors', 'Experian', 'eInsights', 'All', 'Accounts'])
          if ((await buttonsOf(page)).includes(t)) await both(`trend ${s} ${t}`, (p) => act.button(p, t));
      }
    }
    if (v === 'ops') {
      for (const k of await cardsOf(page)) {
        await both(`detail ${k}`, (p) => act.card(p, k));
        for (const t of ['Guarantors', 'Experian', 'eInsights', 'Accounts', 'All'])
          if ((await buttonsOf(page)).includes(t)) await both(`detail ${k} ${t}`, (p) => act.button(p, t));
        if ((await buttonsOf(page)).includes('Open in Trending →')) {
          await both(`detail ${k} → trending`, (p) => act.button(p, 'Open in Trending →'));
          await both(`back to ops`, (p) => act.tab(p, 'ops'));
          await both(`detail ${k} again`, (p) => act.card(p, k));
        }
        await both(`detail ${k} back`, (p) => act.button(p, '← Workflow Results'));
      }
    }
  }
  await both('export open', (p) => act.click(p, '#exportBtn'));
  await both('export close', (p) => act.click(p, '#closeModal'));
}

const clients = ['maine', 'washu'];
const presets = ['all', '3', '6', '12', 'ytd25', 'y24'];

for (const c of clients) {
  for (const preset of presets) {
    for (const present of [false, true]) {
      const setup = [
        [`client ${c}`, (p) => act.select(p, '#client', c)],
        [`preset ${preset}`, (p) => act.select(p, '#preset', preset)],
      ];
      if (present) setup.push(['presentation on', (p) => act.click(p, '#present')]);
      await scenario(`${c}/${preset}/${present ? 'present' : 'internal'}`, setup, walkAll);
    }
  }
  for (const [from, to] of [
    ['0', '2'],
    ['5', '9'],
    ['14', '14'],
    ['18', '20'],
  ]) {
    await scenario(
      `${c}/custom ${from}-${to}`,
      [
        [`client ${c}`, (p) => act.select(p, '#client', c)],
        [`from ${from}`, (p) => act.select(p, '#fromM', from)],
        [`to ${to}`, (p) => act.select(p, '#toM', to)],
      ],
      walkAll,
    );
  }
  for (const flag of ['#hasPfc', '#hasEin', '#hasAgency', '#hasDialer']) {
    await scenario(
      `${c}/toggle ${flag}`,
      [
        [`client ${c}`, (p) => act.select(p, '#client', c)],
        ['tab trend', (p) => act.tab(p, 'trend')],
        [`toggle ${flag}`, (p) => act.click(p, flag)],
      ],
      async (both, page) => {
        await walkAll(both, page);
        await both('presentation on', (p) => act.click(p, '#present'));
        await walkAll(both, page);
        await both('presentation off', (p) => act.click(p, '#present'));
        await both(`toggle ${flag} back`, (p) => act.click(p, flag));
        await walkAll(both, page);
      },
    );
  }
}

await scenario(
  'cross-client state carry-over',
  [
    ['tab trend', (p) => act.tab(p, 'trend')],
    ['scrub Medicaid', (p) => act.button(p, 'Medicaid')],
    ['client washu', (p) => act.select(p, '#client', 'washu')],
    ['eInsights', (p) => act.button(p, 'eInsights')],
    ['client maine', (p) => act.select(p, '#client', 'maine')],
    ['maine ein on', (p) => act.click(p, '#hasEin')],
    ['tab agency? no -> seg', (p) => act.tab(p, 'seg')],
    ['client washu (seg hidden)', (p) => act.select(p, '#client', 'washu')],
    ['tab checks', (p) => act.tab(p, 'checks')],
    ['presentation on', (p) => act.click(p, '#present')],
    ['presentation off', (p) => act.click(p, '#present')],
  ],
  walkAll,
);

await browser.close();
server.close();

const outDir = join(root, 'parity-output');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'failures.txt'), failLog.join('\n\n'));
console.log(`Parity: ${steps} compared states, ${failures} differences.`);
if (failures) {
  console.log(failLog.slice(0, 15).join('\n\n'));
  process.exit(1);
}
