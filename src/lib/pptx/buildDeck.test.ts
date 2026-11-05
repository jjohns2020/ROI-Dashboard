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
    expect(all).not.toContain('MaineHealth');
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

  it('says when the selected dates contain no ROI review', async () => {
    const all = (await slideTexts(inputFor('maine', { range: { fI: 0, tI: 2 }, rangeLabel: 'Jan 2024 – Mar 2024' }))).join('\n');
    expect(all).toContain('No ROI review loaded for Jan 2024 – Mar 2024');
  });

  it('counts Return Mail by guarantors when that level is selected', async () => {
    const all = (await slideTexts(inputFor('maine', { rmLevel: 'guar' }))).join('\n');
    expect(all).toContain('counted by guarantors');
    expect(all).toContain('2,364');
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
