import { describe, expect, it } from 'vitest';
import { sampleDataSource } from '../data/dataSource';
import { applyPreset, overlaps, rolling, truncateToMonth } from './dateRange';
import { overallStatus, runChecks } from './dataChecks';
import { buildSlidePlan } from './exportPlan';
import { money, moneyFull, pct } from './format';
import { medicaidDetail } from './medicaid';
import { annualize, medicaidAttribution, medicaidFactor, opportunityTotals, pctChange, returnMailScale, roiRatio, totalValueCreation } from './roi';
import { navItems, visibleDetails, visibleInsights, visibleScrubs } from './visibility';

const ds = sampleDataSource.load();
const maine = ds.clients.maine;
const washu = ds.clients.washu;

describe('ROI calculations', () => {
  it('computes ROI as quantified benefit ÷ subscription', () => {
    expect(roiRatio(maine.quantified, maine.sub).toFixed(1)).toBe('3.4');
    expect(roiRatio(washu.quantified, washu.sub).toFixed(1)).toBe('17.2');
  });

  it('total value creation = quantified + additional', () => {
    expect(totalValueCreation(maine)).toBe(866391);
    expect(money(totalValueCreation(washu))).toBe('$3.4M');
  });

  it('cash impact payment change is measured against the prior period', () => {
    expect(pct(pctChange(maine.cash.payPrior, maine.cash.payCur))).toBe('32.4%');
  });

  it('annualizes opportunities by × 12 ÷ review months, excluding declined', () => {
    const t = opportunityTotals(ds.opps.washu, ds.months.washu);
    expect(t.live).toHaveLength(3);
    expect(t.declined).toBe(1);
    expect(t.total).toBeCloseTo(((28642 * 15) / 60) * 23 + 71350044 * 0.0025 + 120000);
    expect(t.annualized).toBeCloseTo(t.total * 2);
    expect(annualize(20734, 3)).toBe(82936);
  });

  it('Medicaid source factors apply only when eInsights is on the profile', () => {
    const m = ds.medSplit.washu;
    expect(medicaidFactor('pay', m, true, 'exp')).toBe(0.6);
    expect(medicaidFactor('pay', m, true, 'ein')).toBeCloseTo(0.4);
    expect(medicaidFactor('cov', m, true, 'ein')).toBeCloseTo(0.38);
    expect(medicaidFactor('pay', m, false, 'exp')).toBe(1);
    expect(medicaidFactor('pay', undefined, true, 'exp')).toBe(1);
  });

  it('Medicaid attribution removes eInsights-delivered payments from the ROI', () => {
    const a = medicaidAttribution(washu, ds.medSplit.washu!);
    expect(a.einPay).toBe(243566);
    expect(a.roiExperianOnly.toFixed(1)).toBe('15.9');
    expect(a.roi.toFixed(1)).toBe('17.2');
  });

  it('Return Mail guarantor view divides by the guarantor ratio', () => {
    expect(returnMailScale(1016, 'guar', 3)).toBe(339);
    expect(returnMailScale(1016, 'acct', 3)).toBe(1016);
    expect(returnMailScale(null, 'guar', 3)).toBeNull();
  });
});

describe('Medicaid detail', () => {
  it('re-states KPIs for the selected delivery source', () => {
    const d = medicaidDetail(ds.details.washu.mc!, ds.medSplit.washu, true, 'exp', (k) => medicaidFactor(k, ds.medSplit.washu, true, 'exp'));
    expect(d.sub).toContain('Delivered by Experian');
    expect(d.kpis![3]).toEqual(['Medicaid payments', moneyFull(608915 * 0.6), 'Delivered by Experian']);
  });

  it('keeps the workbook slide when eInsights is not on the profile', () => {
    const base = ds.details.washu.mc!;
    expect(medicaidDetail(base, ds.medSplit.washu, false, 'exp', () => 1)).toBe(base);
  });
});

describe('date filtering', () => {
  const r = { fI: 3, tI: 9 };
  it('applies presets over the 21-month calendar', () => {
    expect(applyPreset('all', r, 20)).toEqual({ fI: 0, tI: 20 });
    expect(applyPreset('3', r, 20)).toEqual({ fI: 18, tI: 20 });
    expect(applyPreset('12', r, 20)).toEqual({ fI: 9, tI: 20 });
    expect(applyPreset('ytd25', r, 20)).toEqual({ fI: 12, tI: 20 });
    expect(applyPreset('y24', r, 20)).toEqual({ fI: 0, tI: 11 });
    expect(applyPreset('custom', r, 20)).toBe(r);
  });

  it('review overlap decides whether a load is in range', () => {
    expect(overlaps(18, 20, { fI: 0, tI: 11 })).toBe(false);
    expect(overlaps(12, 17, { fI: 15, tI: 20 })).toBe(true);
  });

  it('truncates monthly series but keeps workbook YoY blocks', () => {
    const t = truncateToMonth(ds.scrubData.maine, 5);
    expect(t.bk).toHaveLength(6);
    expect(t.rm.new).toHaveLength(6);
    expect(t.yoy).toBe(ds.scrubData.maine.yoy);
    expect(t.flags).toBe(ds.scrubData.maine.flags);
  });

  it('rolling average is null until enough points', () => {
    expect(rolling([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });
});

describe('visibility rules', () => {
  it('hides internal-only views in presentation mode', () => {
    const keys = (p: boolean) => navItems(maine, p).map((x) => x.key);
    expect(keys(false)).toEqual(expect.arrayContaining(['opps', 'checks', 'portfolio']));
    expect(keys(true)).not.toEqual(expect.arrayContaining(['opps']));
    expect(keys(true)).not.toContain('checks');
    expect(keys(true)).not.toContain('portfolio');
    expect(keys(true)).toContain('insights');
    expect(navItems(maine, true, { insights: false }).map((x) => x.key)).not.toContain('insights');
  });

  it('shows profile-driven views only when the profile flag is set', () => {
    expect(navItems(maine, false).map((x) => x.key)).toContain('seg');
    expect(navItems(maine, false).map((x) => x.key)).not.toContain('agency');
    expect(navItems(washu, false).map((x) => x.key)).toContain('agency');
    expect(navItems(washu, false).map((x) => x.key)).not.toContain('seg');
    expect(navItems({ ...maine, dialer: true }, false).map((x) => x.key)).toContain('dialer');
  });

  it('turning PFC off hides PFC workflows, insights and ROI rows', () => {
    const noPfc = { ...washu, pfc: false };
    expect(Object.keys(visibleDetails(ds.details.washu, noPfc))).not.toContain('pfc');
    expect(visibleInsights(ds.insights.washu, noPfc).some((i) => i.area === 'pfc')).toBe(false);
    expect(visibleScrubs(noPfc).map((r) => r[0])).not.toContain('Patient Financial Clearance');
    expect(visibleScrubs(washu).map((r) => r[0])).toContain('Patient Financial Clearance');
  });
});

describe('data checks', () => {
  it('flags REVIEW for the sample clients', () => {
    expect(overallStatus(runChecks('maine', maine, ds))).toBe('REVIEW');
    expect(overallStatus(runChecks('washu', washu, ds))).toBe('REVIEW');
  });

  it('turning on agencies for MaineHealth (no agency data) produces a FIX', () => {
    const r = runChecks('maine', { ...maine, agency: true }, ds);
    expect(r.find((x) => x.t.startsWith('Agency results'))!.s).toBe('FIX');
    expect(overallStatus(r)).toBe('NOT READY');
  });

  it('Medicaid attribution check only appears when eInsights is on and a split exists', () => {
    const has = (c: typeof washu, k: string) => runChecks(k, c, ds).some((x) => x.t.startsWith('Medicaid ROI includes'));
    expect(has(washu, 'washu')).toBe(true);
    expect(has({ ...washu, ein: false }, 'washu')).toBe(false);
    expect(has({ ...maine, ein: true }, 'maine')).toBe(false);
  });
});

describe('PowerPoint export plan', () => {
  it('builds the client slide list and never includes internal pages', () => {
    const plan = buildSlidePlan(maine, Object.values(visibleDetails(ds.details.maine, maine)));
    expect(plan.fileName).toBe('MaineHealth_Q3_2025_Jul_Sep__ROI_Review.pptx');
    expect(plan.slides).toContain('Segmentation Performance');
    expect(plan.slides).not.toContain('Medicaid Results');
    expect(plan.profileSlides).toEqual([]);
    for (const s of [...plan.slides, ...plan.profileSlides]) expect(s).not.toMatch(/Portfolio|Opportunit|Data Checks/);
  });

  it('adds profile slides for agency / dialer clients', () => {
    const plan = buildSlidePlan({ ...washu, dialer: true }, Object.values(ds.details.washu));
    expect(plan.profileSlides).toEqual(['Agency Performance vs. Benchmark', 'Dialer Performance']);
    expect(plan.slides).toContain('Medicaid Results');
  });
});
