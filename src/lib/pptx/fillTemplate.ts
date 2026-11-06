import JSZip from 'jszip';
import { overlaps, sumRange } from '../dateRange';
import { int, money, moneyFull } from '../format';
import { returnMailScale, roiRatio } from '../roi';
import type { DeckInput } from './buildDeck';
import { addedCharts, plotsForTemplate, rewriteChartXml } from './chartFill';

const TEMPLATE_FILE = 'Utilization Review Template_2025.pptx';

/** Slides whose printed dollars belong to the template's example, not this client. */
const EXAMPLE_FIGURE_SLIDES = [28, 30, 38];

async function templateBytes(): Promise<Uint8Array> {
  if (typeof window === 'undefined') {
    const { readFileSync } = await import(/* @vite-ignore */ 'node:fs');
    const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url');
    const path = fileURLToPath(new URL(/* @vite-ignore */ `../../../${TEMPLATE_FILE}`, import.meta.url));
    return new Uint8Array(readFileSync(path));
  }
  const base = new URL('.', window.location.href);
  const response = await fetch(new URL('utilization-review-template.pptx', base));
  if (!response.ok) throw new Error('The Utilization Review template could not be loaded.');
  return new Uint8Array(await response.arrayBuffer());
}

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Replace whole text runs. Placeholders are matched after XML decoding, so `&lt;&lt;insert&gt;&gt;` hits `<<insert>>`. */
function replaceTextNodes(xml: string, replacer: (text: string) => string | null) {
  return xml.replace(/<a:t(\s[^>]*)?>([^<]*)<\/a:t>/g, (full, attrs: string | undefined, inner: string) => {
    const next = replacer(decodeText(inner));
    if (next == null) return full;
    return `<a:t${attrs ?? ''}>${escapeText(next)}</a:t>`;
  });
}

function replaceExact(xml: string, from: string, to: string) {
  return replaceTextNodes(xml, (text) => (text === from ? to : null));
}

function replaceTrimmed(xml: string, from: string, to: string) {
  return replaceTextNodes(xml, (text) => (text.trim() === from ? to : null));
}

function replaceNthExact(xml: string, from: string, values: string[]) {
  let index = 0;
  return replaceTextNodes(xml, (text) => {
    if (text !== from) return null;
    const value = index < values.length ? values[index] : text;
    index += 1;
    return value;
  });
}

function hasWorkflow(input: DeckInput, pattern: RegExp) {
  return input.details.some((detail) => !detail.empty && pattern.test(detail.name));
}

function slidesToRemove(input: DeckInput) {
  const drop = new Set<number>([2, ...EXAMPLE_FIGURE_SLIDES]);
  if (!hasWorkflow(input, /financial clearance|address verification/i)) [4, 5, 6, 7, 8].forEach((n) => drop.add(n));
  if (!hasWorkflow(input, /bankruptcy/i)) [9, 10, 11, 12].forEach((n) => drop.add(n));
  if (!hasWorkflow(input, /deceased/i)) [13, 14, 15, 16].forEach((n) => drop.add(n));
  if (!hasWorkflow(input, /return mail/i)) [17, 18, 20].forEach((n) => drop.add(n));
  if (!input.client.dialer) drop.add(19);
  if (!hasWorkflow(input, /medicaid/i)) [21, 22, 23].forEach((n) => drop.add(n));
  if (!hasWorkflow(input, /charity/i)) [24, 25, 26].forEach((n) => drop.add(n));
  if (!input.client.seg) [27, 29].forEach((n) => drop.add(n));
  if (!input.client.agency) [32, 33, 34, 35, 36, 37].forEach((n) => drop.add(n));
  return drop;
}

function fillSlide1(xml: string, input: DeckInput) {
  let next = replaceExact(xml, 'Health System', input.client.name);
  next = replaceNthExact(next, 'xxxx', [input.rangeLabel, '', 'Sample data, not validated production results.']);
  return replaceExact(next, ' – ', '');
}

/** Write the dashboard date range into every period placeholder and the success-plan date. */
function fillDates(xml: string, input: DeckInput) {
  return replaceTextNodes(xml, (text) => {
    let next = text.replace(/<{2,3}\s*insert period\s*>{2,3}/gi, input.rangeLabel);
    next = next.replace(/\bAugust 6, 2026\b/g, input.rangeLabel);
    if (next.trim() === 'Insert Observations and/or proposals') next = `Selected dates: ${input.rangeLabel}`;
    return next === text ? null : next;
  });
}

function fillValue(xml: string, input: DeckInput) {
  const roi = roiRatio(input.client.quantified, input.client.sub);
  let next = replaceExact(xml, '<<insert sum of dollar value>>', moneyFull(input.client.quantified));
  next = replaceExact(next, '10 : 1 ROI', `${roi.toFixed(1)} : 1 ROI`);
  if (input.client.cash.lift > 0) next = replaceExact(next, '<<Insert lift>>>', moneyFull(input.client.cash.lift));
  if (input.client.fte != null) {
    next = replaceExact(next, '<<insert>> FTE  Hour Savings via Automation (insert # FTE)', `${input.client.fte} FTE hour savings via automation`);
  }
  return next;
}

function fillSegmentation(xml: string, input: DeckInput) {
  const seg = input.client.seg;
  if (!seg) return xml;
  const line = (count: number) => {
    const volume = seg.vol.slice(0, count).reduce((sum, value) => sum + value, 0);
    const payments = seg.pay.slice(0, count).reduce((sum, value) => sum + value, 0);
    return `${Math.round(volume * 100)}% of volume / ${Math.round(payments * 100)}% of payments`;
  };
  let next = replaceExact(xml, '52% of volume / 66% of payments', line(2));
  next = replaceExact(next, '78% of volume / 94% of payments', line(3));
  return next;
}

function fillReturnMail(xml: string, input: DeckInput) {
  const scaled = input.scrub.yoy.rm
    .filter((row) => row[1] != null)
    .map((row) => int(returnMailScale(row[1], input.rmLevel, input.guarRatio) as number));
  const unit = input.rmLevel === 'guar' ? `counted by guarantors ${scaled[0] ?? ''}` : 'Monthly split is illustrative; period totals are from the workbook.';
  let next = replaceExact(xml, 'Insert Observations and/or proposals', unit);
  return replaceExact(next, 'Return Mail results: <<Insert Volume>>', `Return Mail results: ${unit}`);
}

function fillMedicaid(xml: string, input: DeckInput) {
  const detail = input.details.find((item) => /medicaid/i.test(item.name) && !item.empty);
  const workbook = input.client.scrubs.find((row) => row[0] === 'Medicaid');
  const figures = [
    ...(detail?.kpis ?? []).flat(),
    ...(detail?.table?.r ?? []).flat(),
    workbook ? moneyFull(workbook[1]) : '',
  ].filter(Boolean);
  const split = input.medSrc !== 'all' && input.usesEin ? `SOURCE SPLIT = ILLUSTRATIVE. ${figures.join('. ')}` : figures.join('. ');
  return replaceTrimmed(xml, 'Insert summary', split || 'Insert summary');
}

function fillAgency(xml: string, input: DeckInput) {
  const data = input.client.agencyData;
  if (!data) return xml;
  const names = Object.keys(Object.values(data.periods)[0] ?? {});
  return replaceTrimmed(xml, 'Insert summary', `Agency Performance vs. Benchmark. ${names.join(', ')}.`);
}

function fillDialer(xml: string, input: DeckInput) {
  const { fI, tI } = input.range;
  const dialer = input.monthly.dialer;
  const attempts = sumRange(dialer.attempts.slice(fI, tI + 1), 0, tI - fI + 1);
  const payments = sumRange(dialer.payments.slice(fI, tI + 1), 0, tI - fI + 1);
  return replaceExact(
    xml,
    'Total accounts in campaign: <<Insert>>',
    `Dialer Performance. ILLUSTRATIVE SAMPLE DATA. Attempts ${Math.round(attempts).toLocaleString('en-US')}. Payments ${money(payments)}.`,
  );
}

function fillSuccess(xml: string, input: DeckInput) {
  const recommendations = input.client.recs.length ? input.client.recs : ['Sample recommendation'];
  let index = 0;
  return xml.replaceAll('<a:t>Bullet</a:t>', () => {
    const text = recommendations[index] ?? '';
    index += 1;
    return `<a:t>${escapeText(text)}</a:t>`;
  });
}

function fillBenefitSummary(xml: string, input: DeckInput) {
  const inRange = input.client.trend.reviews.some((review) => overlaps(review.s, review.e, input.range));
  if (inRange) return xml;
  return replaceExact(xml, '(ROI)', `(ROI) No ROI review loaded for ${input.rangeLabel}.`);
}

function fillClosing(xml: string, input: DeckInput) {
  return replaceTextNodes(xml, (text) => {
    let next = text.split('University of Utah Health').join(input.client.name);
    next = next.split('University of Utah').join(input.client.name);
    if (next.includes('<<Insert client name>>')) next = next.replaceAll('<<Insert client name>>', input.client.name);
    return next === text ? null : next;
  });
}

/** Titles that would present a workflow this profile does not use. */
function absentPhrases(input: DeckInput) {
  const phrases: string[] = [];
  if (!hasWorkflow(input, /financial clearance|address verification/i)) phrases.push('Patient Financial Clearance');
  if (!hasWorkflow(input, /medicaid/i)) phrases.push('Medicaid Scrub');
  return phrases;
}

function scrubAbsentWorkflows(xml: string, phrases: string[]) {
  if (!phrases.length) return xml;
  return replaceTextNodes(xml, (text) => (phrases.some((phrase) => text.includes(phrase)) ? '' : null));
}

async function removeSlides(zip: JSZip, numbers: Set<number>) {
  let presentation = await zip.file('ppt/presentation.xml')!.async('string');
  let relationships = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
  let contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  for (const number of numbers) {
    const target = `slides/slide${number}.xml`;
    const relationship = relationships.match(new RegExp(`<Relationship\\b[^>]*Target="${target}"[^>]*/>`));
    const id = relationship?.[0].match(/\bId="(rId\d+)"/)?.[1];
    if (relationship && id) {
      relationships = relationships.replace(relationship[0], '');
      presentation = presentation.replace(new RegExp(`<p:sldId\\b[^>]*r:id="${id}"[^>]*/>`), '');
    }
    contentTypes = contentTypes.replace(new RegExp(`<Override\\b[^>]*PartName="/ppt/${target}"[^>]*/>`), '');
    zip.remove(`ppt/slides/slide${number}.xml`);
    zip.remove(`ppt/slides/_rels/slide${number}.xml.rels`);
  }
  zip.file('ppt/presentation.xml', presentation);
  zip.file('ppt/_rels/presentation.xml.rels', relationships);
  zip.file('[Content_Types].xml', contentTypes);
}

const EXAMPLE_PICTURES: Record<number, string[] | 'all'> = {
  19: 'all',
  33: ['Picture 1'],
  34: ['Picture 4'],
  35: ['Picture 1'],
  36: ['Picture 1'],
  37: ['Picture 1'],
};

function removeExamplePictures(xml: string, names: string[] | 'all') {
  return xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (picture) => {
    if (names === 'all') return '';
    const name = picture.match(/<p:cNvPr[^>]*name="([^"]*)"/)?.[1];
    return name && names.includes(name) ? '' : picture;
  });
}

function chartPanel(shapeId: number) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Dashboard chart panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="411480" y="320040"/><a:ext cx="17485440" cy="9647640"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function chartFrame(shapeId: number, relId: string, x: number, y: number, cx: number, cy: number) {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="Dashboard chart ${shapeId}"/><p:cNvGraphicFramePr><a:graphicFrameLocks/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relId}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Payments, collection rate, dialer, and agency charts from the dashboard, placed on the matching template slides. */
async function addDashboardCharts(zip: JSZip, input: DeckInput, dropped: Set<number>) {
  let contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  let nextChart = 1 + Math.max(0, ...Object.keys(zip.files).map((path) => Number(path.match(/^ppt\/charts\/chart(\d+)\.xml$/)?.[1] ?? 0)));
  const charts = addedCharts(input);
  const prepared = new Set<number>();
  if (input.client.agency && input.client.agencyData && !dropped.has(37)) {
    const path = 'ppt/slides/slide37.xml';
    const file = zip.file(path);
    const names = EXAMPLE_PICTURES[37];
    if (file && names) zip.file(path, removeExamplePictures(await file.async('string'), names));
  }
  for (const chart of charts) {
    if (dropped.has(chart.slide)) continue;
    const source = await zip.file(`ppt/charts/chart${chart.sourceChart}.xml`)!.async('string');
    const number = nextChart++;
    zip.file(`ppt/charts/chart${number}.xml`, rewriteChartXml(source, chart.plot));
    zip.file(
      `ppt/charts/_rels/chart${number}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors${chart.sourceChart}.xml"/><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style${chart.sourceChart}.xml"/></Relationships>`,
    );
    const part = `/ppt/charts/chart${number}.xml`;
    if (!contentTypes.includes(`PartName="${part}"`)) {
      contentTypes = contentTypes.replace(
        '</Types>',
        `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
      );
    }
    const relPath = `ppt/slides/_rels/slide${chart.slide}.xml.rels`;
    let rels = await zip.file(relPath)!.async('string');
    const used = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
    const rid = `rId${Math.max(0, ...used) + 1}`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${number}.xml"/></Relationships>`);
    zip.file(relPath, rels);
    const slidePath = `ppt/slides/slide${chart.slide}.xml`;
    let slide = await zip.file(slidePath)!.async('string');
    if (!prepared.has(chart.slide)) {
      const names = EXAMPLE_PICTURES[chart.slide];
      if (names) slide = removeExamplePictures(slide, names);
      if (chart.slide === 39) slide = slide.replace('</p:spTree>', `${chartPanel(4000)}</p:spTree>`);
      prepared.add(chart.slide);
    }
    zip.file(slidePath, slide.replace('</p:spTree>', `${chartFrame(4100 + number, rid, chart.x, chart.y, chart.cx, chart.cy)}</p:spTree>`));
  }
  zip.file('[Content_Types].xml', contentTypes);
}

/** Copy the uploaded Utilization Review template and write this client's figures into it. */
export async function fillReviewTemplate(input: DeckInput): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await templateBytes());
  const edits: Record<number, (xml: string) => string> = {
    1: (xml) => fillSlide1(xml, input),
    18: (xml) => fillReturnMail(xml, input),
    19: (xml) => fillDialer(xml, input),
    20: (xml) => fillReturnMail(xml, input),
    21: (xml) => fillMedicaid(xml, input),
    27: (xml) => fillSegmentation(xml, input),
    32: (xml) => fillAgency(xml, input),
    39: (xml) => fillBenefitSummary(xml, input),
    42: (xml) => fillValue(xml, input),
    46: (xml) => fillSuccess(xml, input),
    50: (xml) => fillClosing(xml, input),
  };
  const dropped = slidesToRemove(input);
  const phrases = absentPhrases(input);
  const slidePaths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
  for (const path of slidePaths) {
    const number = Number(path.match(/slide(\d+)/)![1]);
    if (dropped.has(number)) continue;
    const file = zip.file(path);
    if (!file) continue;
    let xml = await file.async('string');
    const edit = edits[number];
    if (edit) xml = edit(xml);
    xml = fillDates(xml, input);
    xml = scrubAbsentWorkflows(xml, phrases);
    zip.file(path, xml);
  }
  const plots = plotsForTemplate(input);
  for (const path of Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))) {
    const number = Number(path.match(/chart(\d+)/)![1]);
    const plot = plots.get(number);
    const file = zip.file(path);
    if (!plot || !file) continue;
    zip.file(path, rewriteChartXml(await file.async('string'), plot));
  }
  await addDashboardCharts(zip, input, dropped);
  await removeSlides(zip, dropped);
  return zip.generateAsync({ type: 'uint8array' });
}
