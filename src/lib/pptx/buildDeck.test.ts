import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { sampleDataSource } from '../../data/dataSource';
import type { WorkflowDetail } from '../../data/types';
import { overallStatus, runChecks } from '../dataChecks';
import { canExport } from '../exportPlan';
import { visibleDetails, visibleInsights } from '../visibility';
import { buildClientDeck, presentationDetails, type DeckInput } from './buildDeck';

const ds = sampleDataSource.load();

function inputFor(key: 'maine' | 'washu', patch: Partial<DeckInput> = {}): DeckInput {
  const client = { ...ds.clients[key], ...patch.client };
  const details = presentationDetails(
    visibleDetails(ds.details[key], client),
    ds.medSplit[key],
    client.ein,
    patch.medSrc ?? 'all',
    (kind) => (patch.medSrc && patch.medSrc !== 'all' && client.ein ? (kind === 'pay' ? 0.4 : 0.38) : 1),
  );
  return {
    range: { fI: 0, tI: 20 },
    rangeLabel: 'Jan 2024 – Sep 2025',
    monthly: ds.monthly[key],
    insights: visibleInsights(ds.insights[key], client),
    scrub: ds.scrubData[key],
    medSrc: 'all',
    usesEin: client.ein,
    rmLevel: 'acct',
    guarRatio: ds.guarRatio[key],
    ...patch,
    client,
    details,
  };
}

async function slideTexts(input: DeckInput) {
  const out = await buildClientDeck(input).write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(out as Uint8Array);
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('presentationml');
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]));
  const texts: string[] = [];
  for (const name of names) {
    const xml = await zip.file(name)!.async('string');
    texts.push(
      [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)]
        .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
        .join(''),
    );
  }
  return texts;
}

const INTERNAL = [
  'INTERNAL ONLY',
  'INTERNAL',
  'Opportunity Sizing',
  'Data Checks',
  'Portfolio',
  'eInsights-delivered',
  'ROI rests almost entirely',
  'Cash impact is 64%',
  '6.2 : 1',
  'Bankruptcy dollars jump',
  'Return mail 2025 New/Improved is blank',
  'Data loads for this client',
  'Avg Guar to Acct',
];

describe('PowerPoint export', () => {
  it('blocks the download only when data checks are NOT READY', () => {
    expect(canExport('REVIEW')).toBe(true);
    expect(canExport('READY')).toBe(true);
    expect(canExport('NOT READY')).toBe(false);
    expect(overallStatus(runChecks('maine', { ...ds.clients.maine, agency: true, agencyData: undefined }, ds))).toBe('NOT READY');
  });

  it('builds the MaineHealth review from workbook figures and leaves internal content out', async () => {
    const input = inputFor('maine');
    const slides = await slideTexts(input);
    const all = slides.join('\n');
    expect(all).toContain('MaineHealth');
    expect(all).toContain('Collection Optimization Utilization Review');
    expect(all).toContain('3.4 : 1');
    expect(all).toContain('$485,089');
    expect(all).toContain('Return Mail Automation');
    expect(all).toContain('545,867');
    expect(all).toContain('73.6%');
    expect(all).toContain('1,248 hours or 0.60 FTE');
    expect(all).toContain('1.73 FTE');
    expect(all).toContain('$20,352');
    expect(all).toContain('150,396');
    expect(all).toContain('2.33 FTE hour savings via automation');
    expect(all).not.toContain('<<');
    expect(all).not.toContain('xxxxx');
    expect(all).not.toContain('1,985');
    expect(all).not.toContain('458k');
    expect(all).toContain('not validated production results');
    expect(all).toContain('Monthly split is illustrative; period totals are from the workbook.');
    const packed = await JSZip.loadAsync((await buildClientDeck(input).write()) as Uint8Array);
    const presXml = await packed.file('ppt/presentation.xml')!.async('string');
    expect(presXml).toContain('cx="18288000"');
    expect(presXml).toContain('cy="10287000"');
    expect(packed.file('ppt/slides/slide2.xml')).toBeNull();
    expect(packed.file('ppt/slides/slide51.xml')).toBeNull();
    expect(all).not.toContain('$5,276,613,542');
    expect(all).not.toContain('WashU');
    expect(all).not.toContain('Medicaid Scrub');
    for (const phrase of INTERNAL) expect(all, phrase).not.toContain(phrase);
  });

  it('adds WashU profile slides and labels illustrative dialer data', async () => {
    const withDialer = inputFor('washu', { client: { ...ds.clients.washu, dialer: true } });
    const slides = await slideTexts(withDialer);
    const all = slides.join('\n');
    expect(all).toContain('Medicaid Scrub');
    expect(all).toContain('Agency Performance vs. Benchmark');
    expect(all).toContain('Agency A');
    expect(all).toContain('ILLUSTRATIVE SAMPLE DATA');
    expect(all).toContain('17.2 : 1');
    expect(all).toContain('Dialer Performance');
    expect(all).toContain('2,947,042');
    expect(all).toContain('14.17 FTE');
    expect(all).toContain('22.6 FTE hour savings via automation');
    expect(all).toContain('$608,915');
    expect(all).not.toContain('<<');
    expect(all).not.toContain('xxxxx');
    expect(all).not.toContain('MaineHealth');
    const zip = await JSZip.loadAsync((await buildClientDeck(withDialer).write()) as Uint8Array);
    const chartXml = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    expect(chartXml.some((xml) => xml.includes('Agency A') && xml.includes('Benchmark'))).toBe(true);
    expect(chartXml.some((xml) => xml.includes('Dialer payments') && xml.includes(String(Math.round(withDialer.monthly.dialer.payments[0]))))).toBe(true);
    for (const phrase of INTERNAL) expect(all, phrase).not.toContain(phrase);
  });

  it('omits Patient Financial Clearance when the profile flag is off', async () => {
    const all = (await slideTexts(inputFor('washu', { client: { ...ds.clients.washu, pfc: false } }))).join('\n');
    expect(all).not.toContain('Patient Financial Clearance');
    expect(all).toContain('Medicaid Scrub');
  });

  it('labels a Medicaid delivery split as illustrative and keeps the ROI on all payments', async () => {
    const all = (await slideTexts(inputFor('washu', { medSrc: 'ein', usesEin: true }))).join('\n');
    expect(all).toContain('SOURCE SPLIT = ILLUSTRATIVE');
    expect(all).toContain('Delivered by eInsights');
    expect(all).toContain('$243,566');
    expect(all).toContain('$608,915');
    expect(all).not.toContain('eInsights-delivered');
  });

  it('fills the selected dates and replaces template charts with dashboard series', async () => {
    const input = inputFor('maine');
    const zip = await JSZip.loadAsync((await buildClientDeck(input).write()) as Uint8Array);
    const slides = await slideTexts(input);
    const all = slides.join('\n');
    expect(all).toContain('Jan 2024 – Sep 2025');
    expect(all).not.toContain('<<Insert Period>>');
    expect(all).not.toContain('August 6, 2026');
    const chartXml = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    const deceased = chartXml.find((xml) => xml.includes('Deceased results'));
    expect(deceased).toBeTruthy();
    expect(deceased).toContain('Jan 2024');
    expect(deceased).toContain('Sep 2025');
    expect(deceased).not.toContain('10/2019');
    expect(chartXml.some((xml) => xml.includes('Patient payments') && xml.includes('Selected range') && xml.includes('Prior year') && xml.includes('15762191'))).toBe(true);
    expect(chartXml.some((xml) => xml.includes('Collection rate') && xml.includes('3-month average') && xml.includes('0.0663'))).toBe(true);
    expect(chartXml.some((xml) => xml.includes('New % and Improved % by month') && xml.includes('Improved %'))).toBe(true);
    expect(chartXml.some((xml) => xml.includes('Return mail results by month') && xml.includes('Equal / verified'))).toBe(true);
    expect(chartXml.some((xml) => xml.includes('Propensity to pay'))).toBe(true);
    expect(await zip.file('ppt/slides/slide5.xml')!.async('string')).not.toContain('<p:pic>');
    expect(await zip.file('ppt/slides/slide14.xml')!.async('string')).not.toContain('<p:pic>');
    expect(await zip.file('ppt/slides/slide18.xml')!.async('string')).not.toContain('<p:pic>');
    expect(await zip.file('ppt/slides/slide27.xml')!.async('string')).not.toContain('<p:pic>');
    expect(chartXml.join('\n')).not.toContain('externalData');
    for (const xml of chartXml) {
      const seriesIndexes = [...xml.matchAll(/<c:ser>[\s\S]*?<c:idx val="(\d+)"/g)].map((match) => match[1]);
      expect(new Set(seriesIndexes).size).toBe(seriesIndexes.length);
      const uniqueIds = [...xml.matchAll(/uniqueId val="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(uniqueIds).size).toBe(uniqueIds.length);
      expect(xml).not.toMatch(/<c:(?:barChart|lineChart|pieChart)>\s*<\/c:(?:barChart|lineChart|pieChart)>/);
    }
    const relXml = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/charts\/_rels\/chart\d+\.xml\.rels$/.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    expect(relXml.join('\n')).not.toContain('TargetMode="External"');
    const styleTargets = relXml.flatMap((rels) => [...rels.matchAll(/Target="(style\d+\.xml|colors\d+\.xml)"/g)].map((m) => m[1]));
    expect(new Set(styleTargets).size).toBe(styleTargets.length);
    const types = await zip.file('[Content_Types].xml')!.async('string');
    for (const target of styleTargets) expect(types).toContain(`PartName="/ppt/charts/${target}"`);
    const notes = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/notesSlides\/_rels\/notesSlide\d+\.xml\.rels$/.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    for (const rels of notes) {
      const target = rels.match(/Target="\.\.\/slides\/(slide\d+\.xml)"/)?.[1];
      if (target) expect(zip.file(`ppt/slides/${target}`)).toBeTruthy();
    }
  });

  it('says when the selected dates contain no ROI review', async () => {
    const all = (await slideTexts(inputFor('maine', { range: { fI: 0, tI: 2 }, rangeLabel: 'Jan 2024 – Mar 2024' }))).join('\n');
    expect(all).toContain('No ROI review loaded for Jan 2024 – Mar 2024');
  });

  it('counts Return Mail by guarantors when that level is selected', async () => {
    const all = (await slideTexts(inputFor('maine', { rmLevel: 'guar' }))).join('\n');
    expect(all).toContain('counted by guarantors');
    expect(all).toContain('1,803');
    expect(all).not.toContain('Avg Guar to Acct');
  });

  it('does not invent workflow slides', async () => {
    const details = presentationDetails(visibleDetails(ds.details.maine, ds.clients.maine), undefined, false, 'all', () => 1);
    expect(details.find((d) => d.name === 'Medicaid')!.empty).toBeTruthy();
    const names = (await slideTexts(inputFor('maine'))).join('\n');
    const workflows = details.filter((d): d is WorkflowDetail => !d.empty);
    for (const d of workflows) expect(names).toContain(d.name.split(' / ')[0]);
  });
});
