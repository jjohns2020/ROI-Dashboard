import type {
  AgencyData,
  Client,
  ClientKey,
  Dataset,
  Insight,
  MedicaidSplit,
  MonthlySeries,
  Opportunity,
  ScrubData,
  WorkflowDetail,
  WorkflowKey,
} from '../types';
import { clients as sourceClients } from './clients';
import { loads as sourceLoads, guarRatio as sourceGuar, medSplit as sourceMed } from './misc';
import { months as sourceMonths, opps as sourceOpps } from './opportunities';
import sourceMonthly from './monthly.json';
import sourceScrub from './scrubData.json';
import sourceDetails from './details.json';
import sourceInsights from './insights.json';

/**
 * Sample library on top of the MaineHealth and WashU workbook figures.
 * The first 21 months (Jan 2024–Sep 2025) are unchanged. Oct–Dec 2025 continues
 * that pattern so every client has two calendar years. Novant, Banner,
 * Saint Luke's, Rush, and Ochsner are illustrative and are not workbook extracts.
 */
const EXTRA_MONTHS = ['Oct 2025', 'Nov 2025', 'Dec 2025'] as const;
const CONTINUATION = ' Oct–Dec 2025 is an illustrative continuation so the series covers two calendar years.';
const MOCK_FLAG = 'Illustrative mock client — these figures are not from a workbook.';

const baseMonthly = sourceMonthly as unknown as Record<string, MonthlySeries>;
const CALENDAR = [...baseMonthly.maine.months, ...EXTRA_MONTHS];

interface MockSpec {
  key: string;
  name: string;
  agency: boolean;
  dialer: boolean;
  ein: boolean;
  seg: boolean;
  sub: number;
  roi: number;
  payBase: number;
  seed: number;
}

const MOCKS: MockSpec[] = [
  { key: 'novant', name: 'Novant', agency: true, dialer: true, ein: false, seg: true, sub: 186000, roi: 4.6, payBase: 14200000, seed: 11 },
  { key: 'banner', name: 'Banner', agency: true, dialer: false, ein: true, seg: false, sub: 240000, roi: 7.2, payBase: 21800000, seed: 22 },
  { key: 'saintlukes', name: "Saint Luke's", agency: false, dialer: true, ein: false, seg: true, sub: 98000, roi: 3.4, payBase: 7600000, seed: 33 },
  { key: 'rush', name: 'Rush', agency: true, dialer: true, ein: true, seg: false, sub: 154000, roi: 5.5, payBase: 11100000, seed: 44 },
  { key: 'ochsner', name: 'Ochsner', agency: false, dialer: true, ein: false, seg: true, sub: 210000, roi: 4.1, payBase: 16500000, seed: 55 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundTo(n: number, decimals: number) {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function extendNums(values: number[], rand: () => number, decimals: number, min = 0, max = Number.POSITIVE_INFINITY) {
  const out = values.slice();
  for (let i = 0; i < EXTRA_MONTHS.length; i++) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2] ?? last;
    const step = (last - prev) * 0.35 + (rand() - 0.5) * Math.max(Math.abs(last) * 0.05, decimals === 0 ? 1 : 0.001);
    const next = Math.min(max, Math.max(min, last + step));
    out.push(decimals === 0 ? Math.round(next) : roundTo(next, decimals));
  }
  return out;
}

function wave(rand: () => number, base: number, i: number, wobble: number, yearLift: number) {
  const year = i >= 12 ? yearLift : 1;
  const season = 1 + 0.07 * Math.sin(((i % 12) / 12) * Math.PI * 2);
  const noise = 1 + (rand() - 0.5) * wobble;
  return base * year * season * noise;
}

function series(seed: number, base: number, decimals: number, wobble: number, yearLift: number, min = 0, max = Number.POSITIVE_INFINITY) {
  const rand = rng(seed);
  return Array.from({ length: CALENDAR.length }, (_, i) => {
    const next = Math.min(max, Math.max(min, wave(rand, base, i, wobble, yearLift)));
    return decimals === 0 ? Math.round(next) : roundTo(next, decimals);
  });
}

function sum(values: number[], start: number, end: number) {
  return values.slice(start, end).reduce((a, b) => a + b, 0);
}

function avg(values: number[], start: number, end: number) {
  const slice = values.slice(start, end);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function allocate(total: number, weights: [string, number][]): [string, number][] {
  const weight = weights.reduce((a, row) => a + row[1], 0);
  const rows = weights.map(([name, w]) => [name, Math.round((total * w) / weight)] as [string, number]);
  rows[0][1] += total - rows.reduce((a, row) => a + row[1], 0);
  return rows;
}

function portions(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  const rows = values.map((v) => roundTo(v / total, 4));
  rows[0] = roundTo(rows[0] + (1 - rows.reduce((a, b) => a + b, 0)), 4);
  return rows;
}

export function mockAgency(seed: number): AgencyData {
  const rand = rng(seed);
  const cell = (base: number) => roundTo(Math.min(0.2, Math.max(0.004, base * (0.92 + rand() * 0.16))), 4);
  const tier = (low: number, mid: number, high: number) => {
    const rows = [cell(low), cell(mid), cell(high)];
    return [...rows, roundTo(rows.reduce((a, b) => a + b, 0) / rows.length, 4)];
  };
  const periods: Record<string, number[]> = {
    '24 months': [0.118, 0.086, 0.054],
    '0–3 months': [0.049, 0.036, 0.022],
    '4–6 months': [0.094, 0.067, 0.041],
    '7–12 months': [0.121, 0.084, 0.051],
  };
  return {
    buckets: ['<$100', '$100–$1,000', '>$1,000', 'Total'],
    periods: Object.fromEntries(
      Object.entries(periods).map(([label, bases]) => [
        label,
        {
          Benchmark: tier(bases[0], bases[1], bases[2]),
          'Agency A': tier(bases[0] * 0.46, bases[1] * 0.42, bases[2] * 0.5),
          'Agency B': tier(bases[0] * 0.74, bases[1] * 0.7, bases[2] * 0.78),
        },
      ]),
    ),
  };
}

function extendMonthly(seriesIn: MonthlySeries, seed: number): MonthlySeries {
  const rand = rng(seed);
  const wf: Record<string, number[]> = {};
  for (const [key, values] of Object.entries(seriesIn.wf)) wf[key] = extendNums(values, rand, 0);
  return {
    months: CALENDAR.slice(),
    pay: extendNums(seriesIn.pay, rand, 0),
    rate: extendNums(seriesIn.rate, rand, 4, 0.02, 0.35),
    wf,
    known: seriesIn.known + CONTINUATION,
    dialer: {
      attempts: extendNums(seriesIn.dialer.attempts, rand, 0),
      contacts: extendNums(seriesIn.dialer.contacts, rand, 0),
      payments: extendNums(seriesIn.dialer.payments, rand, 0),
    },
  };
}

function extendScrub(scrub: ScrubData, seed: number): ScrubData {
  const rand = rng(seed);
  return {
    rm: {
      new: extendNums(scrub.rm.new, rand, 0),
      imp: extendNums(scrub.rm.imp, rand, 0),
      eq: extendNums(scrub.rm.eq, rand, 0),
      nh: extendNums(scrub.rm.nh, rand, 0),
    },
    piv: {
      vol: extendNums(scrub.piv.vol, rand, 0),
      new: extendNums(scrub.piv.new, rand, 4, 0.05, 0.4),
      imp: extendNums(scrub.piv.imp, rand, 4, 0.01, 0.2),
    },
    bk: extendNums(scrub.bk, rand, 0),
    dc: extendNums(scrub.dc, rand, 0),
    mc: { rec: extendNums(scrub.mc.rec, rand, 0), cov: extendNums(scrub.mc.cov, rand, 0) },
    ch: extendNums(scrub.ch, rand, 0),
    yoy: structuredClone(scrub.yoy),
    flags: scrub.flags.slice(),
    known: scrub.known + CONTINUATION,
  };
}

function mockMonthly(spec: MockSpec): MonthlySeries {
  const pay = series(spec.seed, spec.payBase, 0, 0.08, 1.07);
  const rate = series(spec.seed + 1, 0.09, 4, 0.12, 1.04, 0.04, 0.22);
  const attempts = series(spec.seed + 2, Math.round(spec.payBase / 90), 0, 0.1, 1.05);
  const contacts = attempts.map((n, i) => Math.round(n * (0.11 + ((spec.seed + i) % 5) * 0.008)));
  const payments = series(spec.seed + 3, Math.round(spec.payBase * 0.012), 0, 0.15, 1.08);
  const wf = {
    'Charity qualified accounts': series(spec.seed + 4, Math.round(spec.payBase / 280), 0, 0.12, 0.96),
    'Bankruptcy results': series(spec.seed + 5, 40 + (spec.seed % 17), 0, 0.2, 1.06),
    'Deceased results': series(spec.seed + 6, 18 + (spec.seed % 9), 0, 0.18, 0.94),
    'Return Mail collections ($)': series(spec.seed + 7, Math.round(spec.sub * 0.04), 0, 0.2, 1.05),
  };
  return {
    months: CALENDAR.slice(),
    pay,
    rate,
    wf,
    known: `Illustrative mock payments for ${spec.name}, Jan 2024 – Dec 2025. Not a workbook extract.`,
    dialer: { attempts, contacts, payments },
  };
}

function mockScrub(spec: MockSpec, monthly: MonthlySeries): ScrubData {
  const rmNew = series(spec.seed + 8, 900 + spec.seed * 7, 0, 0.15, 1.08);
  const rmImp = series(spec.seed + 9, 140 + spec.seed, 0, 0.12, 1.05);
  const rmEq = series(spec.seed + 10, 120, 0, 0.1, 1.02);
  const rmNh = series(spec.seed + 11, 220, 0, 0.1, 1.03);
  const pivVol = series(spec.seed + 12, Math.round(spec.payBase / 35), 0, 0.08, 1.04);
  const pivNew = series(spec.seed + 13, 0.18, 4, 0.08, 1, 0.12, 0.24);
  const pivImp = series(spec.seed + 14, 0.07, 4, 0.1, 1, 0.03, 0.12);
  const bk = series(spec.seed + 15, 30 + (spec.seed % 11), 0, 0.2, 1.08);
  const dc = series(spec.seed + 16, 20 + (spec.seed % 7), 0, 0.16, 0.95);
  const mcRec = series(spec.seed + 17, 8000 + spec.seed * 40, 0, 0.1, 1.04);
  const mcCov = mcRec.map((n) => Math.round(n * 0.1));
  const ch = series(spec.seed + 18, 18000 + spec.seed * 30, 0, 0.12, 0.97);
  const pack = (values: number[]) => [Math.round(sum(values, 0, 12)), Math.round(sum(values, 12, 24))] as const;
  const [rm24, rm25] = pack(rmNew.map((n, i) => n + rmImp[i] + rmEq[i] + rmNh[i]));
  const [new24, new25] = pack(rmNew);
  const [imp24, imp25] = pack(rmImp);
  const [piv24, piv25] = pack(pivVol);
  const [bk24, bk25] = pack(bk);
  const [dc24, dc25] = pack(dc);
  const [ch24, ch25] = pack(ch);
  const [cov24, cov25] = pack(mcCov);
  return {
    rm: { new: rmNew, imp: rmImp, eq: rmEq, nh: rmNh },
    piv: { vol: pivVol, new: pivNew, imp: pivImp },
    bk,
    dc,
    mc: { rec: mcRec, cov: mcCov },
    ch,
    yoy: {
      rm: [
        ['Jan–Dec 2024', rm24, new24, imp24],
        ['Jan–Dec 2025', rm25, new25, imp25],
      ],
      rmc: [
        ['Jan–Dec 2024', Math.round(sum(monthly.wf['Return Mail collections ($)'], 0, 12))],
        ['Jan–Dec 2025', Math.round(sum(monthly.wf['Return Mail collections ($)'], 12, 24))],
      ],
      piv: [
        ['Jan–Dec 2024', piv24, roundTo(avg(pivNew, 0, 12), 4), roundTo(avg(pivImp, 0, 12), 4)],
        ['Jan–Dec 2025', piv25, roundTo(avg(pivNew, 12, 24), 4), roundTo(avg(pivImp, 12, 24), 4)],
      ],
      bk: [
        ['Jan–Dec 2024', bk24, bk24 * 820],
        ['Jan–Dec 2025', bk25, bk25 * 860],
      ],
      dc: [
        ['Jan–Dec 2024', dc24],
        ['Jan–Dec 2025', dc25],
      ],
      mc: [
        ['Jan–Dec 2024', Math.round(spec.sub * 1.4), roundTo(cov24 / Math.max(1, sum(mcRec, 0, 12)), 3)],
        ['Jan–Dec 2025', Math.round(spec.sub * 1.6), roundTo(cov25 / Math.max(1, sum(mcRec, 12, 24)), 3)],
      ],
      ch: [
        ['Jan–Dec 2024', ch24, ch24 * 480],
        ['Jan–Dec 2025', ch25, ch25 * 510],
      ],
    },
    flags: [MOCK_FLAG],
    known: `Illustrative mock scrub trends for ${spec.name}. Not a workbook extract.`,
  };
}

function mockDetails(spec: MockSpec, scrub: ScrubData): Partial<Record<WorkflowKey, WorkflowDetail>> {
  const piv = Math.round(sum(scrub.piv.vol, 12, 24));
  const charity = Math.round(sum(scrub.ch, 12, 24));
  const bk = Math.round(sum(scrub.bk, 12, 24));
  const dc = Math.round(sum(scrub.dc, 12, 24));
  const rm = Math.round(sum(scrub.rm.new, 12, 24) + sum(scrub.rm.imp, 12, 24));
  const cov = Math.round(sum(scrub.mc.cov, 12, 24));
  const num = (n: number) => Math.round(n).toLocaleString('en-US');
  const mc: WorkflowDetail = spec.ein
    ? {
        name: 'Medicaid',
        sub: 'Self-pay converted to Medicaid coverage',
        src: 'Illustrative mock',
        kpis: [
          ['Records scrubbed', num(sum(scrub.mc.rec, 12, 24)), '2025 sample'],
          ['Active coverage found', num(cov), '2025 sample'],
          ['Hit rate', `${((cov / sum(scrub.mc.rec, 12, 24)) * 100).toFixed(1)}%`, 'Coverage ÷ records'],
          ['Medicaid payments', `$${Math.round(spec.sub * 1.6).toLocaleString('en-US')}`, 'Counted in the sample ROI'],
        ],
        charts: [{ t: 'Active coverage, by year', cats: ['2024', '2025'], v: [sum(scrub.mc.cov, 0, 12), cov], f: 'n' }],
        trend: 'mc',
      }
    : {
        name: 'Medicaid',
        sub: 'Medicaid eligibility scrub',
        src: 'Not included in this sample profile',
        empty: 'Medicaid was not included in this sample review.',
        trend: 'mc',
      };
  return {
    pfc: {
      name: 'Patient Financial Clearance',
      sub: 'Front-end patient financial insight and address validation',
      src: 'Illustrative mock',
      kpis: [
        ['PIV transactions', num(piv), '2025 sample'],
        ['New addresses', '18%', 'Illustrative'],
        ['Improved addresses', '7%', 'Illustrative'],
        ['High propensity', '71%', 'Illustrative'],
      ],
      charts: [
        { t: 'Propensity to pay (% of accounts)', cats: ['High', 'Medium', 'Low', 'NC'], v: [0.71, 0.2, 0.06, 0.03], f: 'p' },
      ],
      tl: 'Sample takeaway',
      take: 'These PFC figures are a two-year illustration so the workflow page can be reviewed before a workbook is loaded.',
      trend: 'piv',
    },
    av: {
      name: 'Address Verification',
      sub: 'Address correction supports statement deliverability',
      src: 'Illustrative mock',
      kpis: [
        ['Total searches', num(piv), 'Same PIV volume'],
        ['New addresses', '18%', 'Illustrative'],
        ['Improved addresses', num(Math.round(piv * 0.07)), 'Illustrative'],
        ['Impacted AR', `$${Math.round(spec.payBase / 8000).toLocaleString('en-US')}`, 'Illustrative'],
      ],
      trend: 'piv',
    },
    bk: {
      name: 'Bankruptcy',
      sub: 'Bankruptcy monitoring',
      src: 'Illustrative mock',
      kpis: [
        ['Bankruptcy results', num(bk), '2025 sample'],
        ['Impacted balance', `$${(bk * 860).toLocaleString('en-US')}`, 'Illustrative'],
      ],
      charts: [{ t: 'Bankruptcy volume', cats: ['2024', '2025'], v: [sum(scrub.bk, 0, 12), bk], f: 'n' }],
      trend: 'bk',
    },
    dc: {
      name: 'Deceased',
      sub: 'Deceased monitoring',
      src: 'Illustrative mock',
      kpis: [
        ['Deceased results', num(dc), '2025 sample'],
        ['Collections', `$${Math.round(dc * 42).toLocaleString('en-US')}`, 'Illustrative'],
      ],
      charts: [{ t: 'Deceased volume', cats: ['2024', '2025'], v: [sum(scrub.dc, 0, 12), dc], f: 'n' }],
      trend: 'dc',
    },
    rm: {
      name: 'Return Mail',
      sub: 'Corrected-address activity',
      src: 'Illustrative mock',
      kpis: [
        ['New + improved', num(rm), '2025 sample'],
        ['Collections', `$${Math.round(sum(scrub.yoy.rmc[1].slice(1) as number[], 0, 1)).toLocaleString('en-US')}`, '2025 sample'],
      ],
      charts: [{ t: 'New + improved addresses', cats: ['2024', '2025'], v: [sum(scrub.rm.new, 0, 12) + sum(scrub.rm.imp, 0, 12), rm], f: 'n' }],
      trend: 'rm',
    },
    mc,
    ch: {
      name: 'Charity',
      sub: 'Presumptive charity qualification',
      src: 'Illustrative mock',
      kpis: [
        ['Qualified accounts', num(charity), '2025 sample'],
        ['Qualified balance', `$${Math.round(charity * 510).toLocaleString('en-US')}`, 'Illustrative'],
      ],
      charts: [{ t: 'Qualified accounts', cats: ['2024', '2025'], v: [sum(scrub.ch, 0, 12), charity], f: 'n' }],
      trend: 'ch',
    },
  };
}

function mockInsights(spec: MockSpec, monthly: MonthlySeries): Insight[] {
  const prior = sum(monthly.pay, 0, 12);
  const current = sum(monthly.pay, 12, 24);
  const change = (((current - prior) / prior) * 100).toFixed(1);
  return [
    {
      area: 'roi',
      type: 'Observation',
      aud: 'client',
      title: 'Patient payments are higher in 2025',
      obs: `Sample patient payments for ${spec.name} are ${change}% higher in 2025 than in 2024.`,
      so: 'The gain is spread across the year rather than one quarter.',
      rec: 'Keep the monthly collection rate on the review so a soft month is visible before renewal.',
      metric: `${change}% vs 2024`,
    },
    {
      area: 'rm',
      type: 'Opportunity',
      aud: 'client',
      title: 'Return mail is large enough to automate',
      obs: 'New and improved address results run through both years of this sample.',
      so: 'Most of that volume can move off a manual work queue.',
      rec: 'Start with improved addresses, then add new-address updates.',
      metric: 'Two-year sample',
    },
    ...(spec.seg
      ? [
          {
            area: 'seg',
            type: 'Observation' as const,
            aud: 'client' as const,
            title: 'Payments concentrate in the first segments',
            obs: 'The first two segments hold more of the payments than of the volume.',
            so: 'Effort on the last two segments returns less cash.',
            rec: 'Point dialer and statement effort at segments 1–3.',
            metric: 'Sample segment mix',
          },
        ]
      : []),
    {
      area: 'roi',
      type: 'Data quality',
      aud: 'internal',
      title: `${spec.name} is illustrative mock data`,
      obs: 'This organization was added so the library covers a two-year sample before a workbook exists.',
      so: 'None of these dollars should be quoted as a client result.',
      rec: 'Replace the record with the workbook extract before a client review.',
      metric: 'Mock data',
    },
  ];
}

function mockOpps(spec: MockSpec, pay2025: number): Opportunity[] {
  return [
    { w: 'Return Mail', o: 'Automate improved address updates', v: Math.round(spec.sub * 0.08), src: 'Illustrative estimate', st: 'Proposed' },
    {
      w: 'Segmentation',
      o: 'Shift effort toward segments 1–3 (0.25% lift)',
      v: Math.round(pay2025 * 0.0025),
      src: 'Illustrative assumption on 2025 patient payments',
      st: 'In discussion',
    },
    { w: 'Dialer', o: 'Raise the right-party contact rate', v: Math.round(spec.sub * 0.05), src: 'Illustrative estimate', st: 'Not yet discussed' },
  ];
}

function mockMed(spec: MockSpec, medicaidPay: number): MedicaidSplit {
  const rand = rng(spec.seed + 19);
  const rec = Math.round(90000 + rand() * 120000);
  const cov = Math.round(rec * (0.08 + rand() * 0.04));
  return {
    expCov: roundTo(0.55 + rand() * 0.2, 2),
    expPay: roundTo(0.5 + rand() * 0.2, 2),
    rec,
    recBal: rec * 78,
    cov,
    covBal: cov * 110,
    pay: medicaidPay,
    stmt: Math.round(cov * 1.6),
    yoy: [
      ['Jan–Dec 2024', Math.round(medicaidPay * 0.92), 0.09],
      ['Jan–Dec 2025', medicaidPay, roundTo(cov / rec, 3)],
    ],
  };
}

function mockClient(spec: MockSpec, monthly: MonthlySeries): Client {
  const quantified = Math.round(spec.sub * spec.roi);
  const weights: [string, number][] = [
    ['Recovery Rate Lift', 0.52],
    ['Return Mail Collections', 0.14],
    ['Charity', 0.1],
    ['Patient Financial Clearance', 0.08],
    ['Bankruptcy', 0.04],
    ['Deceased', 0.02],
  ];
  if (spec.ein) weights.push(['Medicaid', 0.1]);
  else weights[0][1] += 0.1;
  const scrubs = allocate(quantified, weights);
  const additional = Math.round(quantified * 0.22);
  const payPrior = sum(monthly.pay, 0, 12);
  const payCur = sum(monthly.pay, 12, 24);
  const ratePrior = roundTo(avg(monthly.rate, 0, 12), 4);
  const rateCur = roundTo(avg(monthly.rate, 12, 24), 4);
  const rand = rng(spec.seed + 30);
  return {
    name: spec.name,
    period: 'Jan – Dec 2025',
    source: `Illustrative mock data for ${spec.name}, Jan 2024 – Dec 2025. Not a workbook or production extract.`,
    agency: spec.agency,
    dialer: spec.dialer,
    pfc: true,
    ein: spec.ein,
    decision: '—',
    quantified,
    sub: spec.sub,
    additional,
    scrubs,
    addl: [['Supporting statement and automation value', additional]],
    ops: [
      ['PIV transactions', Math.round(spec.payBase * 1.4), 'n'],
      ['New + improved addresses', 0.25, 'p'],
      ['Charity qualified accounts', Math.round(spec.payBase / 90), 'n'],
      ['Bankruptcy results', 400 + spec.seed, 'n'],
    ],
    cash: {
      prior: 'Jan–Dec 2024',
      cur: 'Jan–Dec 2025',
      payPrior,
      payCur,
      ratePrior,
      rateCur,
      lift: scrubs[0][1],
      liftLabel: 'Recovery lift',
    },
    seg: spec.seg ? { vol: portions([0.24, 0.27, 0.23, 0.16, 0.1].map((n) => n * (0.92 + rand() * 0.16))), pay: portions([0.18, 0.47, 0.2, 0.09, 0.06].map((n) => n * (0.92 + rand() * 0.16))) } : null,
    agencyData: mockAgency(spec.seed + 40),
    trend: {
      reviews: [{ p: 'Jan–Dec 2025', m: 12, b: quantified, sub: spec.sub, s: 12, e: 23 }],
      yoy: [{ p: 'Jan–Dec', py: '2024', cy: '2025', pay: [payPrior, payCur], rate: [ratePrior, rateCur] }],
      note: 'Illustrative two-year sample. Replace with the client workbook before a review.',
      ...(spec.seg
        ? {
            seg: {
              years: ['2023', '2024', '2025'],
              vol: [
                [0.31, 0.28, 0.26],
                [0.27, 0.29, 0.28],
                [0.22, 0.23, 0.24],
                [0.12, 0.12, 0.13],
                [0.08, 0.08, 0.09],
              ],
            },
          }
        : {}),
    },
    recs: [
      'Return mail automation',
      spec.agency ? 'Agency performance review vs. benchmark' : 'Dialer contact-rate review',
      'Segmentation strategy monitoring',
      'Quarterly ROI governance',
    ],
  };
}

function extendLoads(loads: Dataset['loads']): Dataset['loads'] {
  const next = structuredClone(loads);
  for (const rows of Object.values(next)) {
    for (const row of rows) {
      if (row.n.startsWith('Monthly Trend')) {
        row.p = 'Jan 2024 – Dec 2025';
        row.e = CALENDAR.length - 1;
      }
    }
  }
  return next;
}

/** Full sample dataset: workbook clients, two-year continuation, and the mock organizations. */
export function assembleSampleDataset(): Dataset {
  const workbookClients = structuredClone(sourceClients);
  workbookClients.maine.agencyData = mockAgency(7);

  const monthly: Dataset['monthly'] = {};
  const scrubData: Dataset['scrubData'] = {};
  for (const [key, value] of Object.entries(baseMonthly)) monthly[key] = extendMonthly(value, key === 'maine' ? 101 : 202);
  for (const [key, value] of Object.entries(sourceScrub as unknown as Record<string, ScrubData>)) {
    scrubData[key] = extendScrub(value, key === 'maine' ? 303 : 404);
  }

  const details = structuredClone(sourceDetails) as unknown as Dataset['details'];
  const insights = structuredClone(sourceInsights) as unknown as Dataset['insights'];
  const opps = structuredClone(sourceOpps);
  const months = { ...sourceMonths };
  const medSplit = structuredClone(sourceMed);
  const loads = extendLoads(sourceLoads);
  const guarRatio = { ...sourceGuar };

  for (const spec of MOCKS) {
    const month = mockMonthly(spec);
    const scrub = mockScrub(spec, month);
    const client = mockClient(spec, month);
    workbookClients[spec.key] = client;
    monthly[spec.key] = month;
    scrubData[spec.key] = scrub;
    details[spec.key] = mockDetails(spec, scrub);
    insights[spec.key] = mockInsights(spec, month);
    opps[spec.key] = mockOpps(spec, sum(month.pay, 12, 24));
    months[spec.key] = 12;
    loads[spec.key] = [{ n: `${spec.name} illustrative mock`, p: 'Jan 2024 – Dec 2025', s: 0, e: 23 }];
    guarRatio[spec.key] = 3;
    if (spec.ein) {
      const medicaid = client.scrubs.find((row) => row[0] === 'Medicaid');
      medSplit[spec.key] = mockMed(spec, medicaid ? medicaid[1] : 0);
    }
  }

  return {
    clients: workbookClients,
    monthly,
    scrubData,
    details,
    insights,
    opps,
    months,
    medSplit,
    loads,
    guarRatio,
  };
}

export const MOCK_CLIENT_KEYS: ClientKey[] = MOCKS.map((spec) => spec.key);
