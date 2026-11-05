import type { Client, ClientKey, Dataset } from '../data/types';

export type CheckStatus = 'PASS' | 'REVIEW' | 'FIX' | 'N/A';
export type OverallStatus = 'READY' | 'REVIEW' | 'NOT READY';

export interface CheckResult {
  t: string;
  s: CheckStatus;
  w: string;
}

/** Pre-export checklist for one client (internal only). `c` is the client with current profile flags applied. */
export function runChecks(k: ClientKey, c: Client, ds: Pick<Dataset, 'scrubData' | 'medSplit' | 'monthly'>): CheckResult[] {
  const r: CheckResult[] = [];
  const ok = (t: string, s: CheckStatus, w: string) => r.push({ t, s, w });
  const roi = c.quantified / c.sub;
  ok('Client profile complete (name, period, months, subscription)', 'PASS', 'Client Profile');
  ok('ROI within plausible range (0.5x – 50x)', roi >= 0.5 && roi <= 50 ? 'PASS' : 'REVIEW', 'ROI Summary');
  ok('Agency results present when Has Agency = Y', !c.agency ? 'N/A' : c.agencyData ? 'PASS' : 'FIX', 'Agency Benchmarking');
  ok('Dialer data present when Has Dialer = Y', !c.dialer ? 'N/A' : 'REVIEW', 'Dialer Performance — sample data only in this mockup');
  const monthCount = ds.monthly[k]?.months.length ?? 0;
  ok(
    'Monthly Trend has 24 months for year-over-year',
    monthCount >= 24 ? 'PASS' : 'REVIEW',
    monthCount >= 24 ? 'Monthly Trend — 24 months; Oct–Dec 2025 is illustrative' : `Monthly Trend — ${monthCount} months, sample data`,
  );
  if (k === 'maine') ok('ROI method matches prior review', 'REVIEW', 'Jan–Jun counted all scrubs; Q3 counted recovery lift + return mail');
  if (k === 'washu') {
    ok('Cash Impact: recovery rate lift is negative — ROI uses patient payment lift', 'REVIEW', 'Cash Impact Analysis');
    ok("Agency names shown — confirm OK for this client's deck", 'REVIEW', 'Agency Benchmarking');
  }
  ds.scrubData[k].flags.forEach((f) => ok('Scrub trend data: ' + f, 'REVIEW', 'Scrub Trends / YoY blocks'));
  if (c.ein && ds.medSplit[k])
    ok('Medicaid ROI includes payments delivered by eInsights — confirm attribution', 'REVIEW', 'Medicaid tab / Client Profile');
  ok('Opportunities kept out of ROI totals and client deck', 'PASS', 'Opportunity Sizing');
  return r;
}

export const overallStatus = (r: CheckResult[]): OverallStatus =>
  r.some((x) => x.s === 'FIX') ? 'NOT READY' : r.some((x) => x.s === 'REVIEW') ? 'REVIEW' : 'READY';
