import { priorYearAligned, rolling } from '../dateRange';
import { returnMailScale } from '../roi';
import { visibleScrubs } from '../visibility';
import type { DeckInput } from './buildDeck';

export interface ChartSeries {
  name: string;
  /** Null leaves a gap, matching a dashboard point that is not loaded yet. */
  values: Array<number | null>;
  /** Excel format code. Percent values stay in the 0–1 range. */
  format?: string;
}

export interface ChartPlot {
  title: string;
  categories: string[];
  series: ChartSeries[];
  /** Draw bar series one on top of another, matching the dashboard stacked charts. */
  stack?: boolean;
}

const COUNT = '#,##0';
const DOLLARS = '$#,##0';
const PERCENT = '0.0%';

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Math.round(value * 10000) / 10000);
}

function points(values: Array<string | null>) {
  return `<c:ptCount val="${values.length}"/>${values
    .map((value, index) => (value == null ? '' : `<c:pt idx="${index}"><c:v>${escapeText(value)}</c:v></c:pt>`))
    .join('')}`;
}

function selectedMonths(input: DeckInput) {
  const months = input.monthly.months.slice(input.range.fI, input.range.tI + 1);
  return months.length ? months : [input.rangeLabel];
}

function detailChart(input: DeckInput, title: RegExp) {
  for (const detail of input.details) {
    const chart = detail.charts?.find((item) => title.test(item.t));
    if (chart && chart.cats.length && chart.v.length) return chart;
  }
  return null;
}

function distribution(input: DeckInput, title: RegExp, fallbackName: string): ChartPlot {
  const chart = detailChart(input, title);
  if (!chart) {
    return { title: `${fallbackName} · ${input.rangeLabel}`, categories: [input.rangeLabel], series: [{ name: fallbackName, values: [0], format: PERCENT }] };
  }
  return {
    title: `${chart.t} · ${input.rangeLabel}`,
    categories: chart.cats,
    series: [{ name: input.rangeLabel, values: chart.v, format: chart.f === 'p' ? PERCENT : COUNT }],
  };
}

function segmentMix(input: DeckInput, index: number): ChartPlot {
  const years = input.client.trend.seg?.years;
  const row = input.client.trend.seg?.vol[index];
  if (years && row && years.length === row.length) {
    return {
      title: `Segment ${index + 1} · ${input.rangeLabel}`,
      categories: years,
      series: [{ name: `Segment ${index + 1}`, values: row, format: PERCENT }],
    };
  }
  return {
    title: `Segment ${index + 1} · ${input.rangeLabel}`,
    categories: [input.rangeLabel],
    series: [{ name: `Segment ${index + 1}`, values: [input.client.seg?.vol[index] ?? 0], format: PERCENT }],
  };
}

function ranged(input: DeckInput, values: Array<number | null>) {
  const slice = values.slice(input.range.fI, input.range.tI + 1);
  return slice.length ? slice : [0];
}

function monthlyCount(input: DeckInput, values: number[], title: string, seriesName: string): ChartPlot {
  return {
    title: `${title} · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [{ name: seriesName, values: ranged(input, values), format: COUNT }],
  };
}

/** Return-mail counts, scaled the same way as the dashboard when the view is guarantors. */
function returnMailCounts(input: DeckInput) {
  const scale = (values: number[]) => values.map((value) => returnMailScale(value, input.rmLevel, input.guarRatio) ?? 0);
  const rows = {
    new: scale(input.scrub.rm.new),
    imp: scale(input.scrub.rm.imp),
    eq: scale(input.scrub.rm.eq),
    nh: scale(input.scrub.rm.nh),
  };
  const vol = rows.new.map((_, index) => rows.new[index] + rows.imp[index] + rows.eq[index] + rows.nh[index]);
  return { ...rows, vol };
}

/** New %, Improved %, and their sum — the address chart on the dashboard. */
function pivRates(input: DeckInput): ChartPlot {
  const piv = input.scrub.piv;
  const combined = piv.new.map((value, index) => value + piv.imp[index]);
  return {
    title: `New % and Improved % by month · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'New %', values: ranged(input, piv.new), format: PERCENT },
      { name: 'Improved %', values: ranged(input, piv.imp), format: PERCENT },
      { name: 'New + Improved %', values: ranged(input, combined), format: PERCENT },
    ],
  };
}

function returnMailMix(input: DeckInput): ChartPlot {
  const mail = returnMailCounts(input);
  return {
    title: `Return mail results by month · ${input.rangeLabel}`,
    stack: true,
    categories: selectedMonths(input),
    series: [
      { name: 'New', values: ranged(input, mail.new), format: COUNT },
      { name: 'Improved', values: ranged(input, mail.imp), format: COUNT },
      { name: 'Equal / verified', values: ranged(input, mail.eq), format: COUNT },
      { name: 'No hit', values: ranged(input, mail.nh), format: COUNT },
    ],
  };
}

function returnMailRates(input: DeckInput): ChartPlot {
  const mail = returnMailCounts(input);
  const improved = mail.new.map((value, index) => (mail.vol[index] ? (value + mail.imp[index]) / mail.vol[index] : 0));
  const hit = mail.new.map((value, index) => (mail.vol[index] ? (value + mail.imp[index] + mail.eq[index]) / mail.vol[index] : 0));
  return {
    title: `New + Improved rate and hit rate · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'New + Improved %', values: ranged(input, improved), format: PERCENT },
      { name: 'Hit rate', values: ranged(input, hit), format: PERCENT },
    ],
  };
}

function patientPayments(input: DeckInput): ChartPlot {
  return {
    title: `Patient payments — ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'Prior year', values: priorYearAligned(input.monthly.pay, input.range), format: DOLLARS },
      { name: 'Selected range', values: ranged(input, input.monthly.pay), format: DOLLARS },
    ],
  };
}

function collectionRate(input: DeckInput): ChartPlot {
  return {
    title: `Collection rate by month · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'Monthly', values: ranged(input, input.monthly.rate), format: PERCENT },
      { name: '3-month average', values: ranged(input, rolling(input.monthly.rate, 3)), format: PERCENT },
    ],
  };
}

function medicaidCoverage(input: DeckInput): ChartPlot {
  const factor = input.medCovFactor ?? 1;
  const found = input.scrub.mc.cov.map((value, index) => (input.scrub.mc.rec[index] ? Math.round(value * factor) : 0));
  const rate = found.map((value, index) => (input.scrub.mc.rec[index] ? value / input.scrub.mc.rec[index] : 0));
  return {
    title: `Active coverage found by month · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'Coverage found', values: ranged(input, found), format: COUNT },
      { name: 'Hit rate', values: ranged(input, rate), format: PERCENT },
    ],
  };
}

function segmentCompare(input: DeckInput): ChartPlot {
  const seg = input.client.seg;
  return {
    title: `% of volume vs. % of payments by segment · ${input.rangeLabel}`,
    categories: ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5'],
    series: [
      { name: '% Volume', values: seg?.vol ?? [0, 0, 0, 0, 0], format: PERCENT },
      { name: '% Payments', values: seg?.pay ?? [0, 0, 0, 0, 0], format: PERCENT },
    ],
  };
}

function dialerPayments(input: DeckInput): ChartPlot {
  return {
    title: `Dialer payments by month · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [
      { name: 'Dialer payments', values: ranged(input, input.monthly.dialer.payments), format: DOLLARS },
      { name: '3-month average', values: ranged(input, rolling(input.monthly.dialer.payments, 3)), format: DOLLARS },
    ],
  };
}

function dialerContactRate(input: DeckInput): ChartPlot {
  const rate = input.monthly.dialer.contacts.map((contacts, index) => {
    const attempts = input.monthly.dialer.attempts[index];
    return attempts ? contacts / attempts : 0;
  });
  return {
    title: `Contact rate by month · ${input.rangeLabel}`,
    categories: selectedMonths(input),
    series: [{ name: 'Contact rate', values: ranged(input, rate), format: PERCENT }],
  };
}

/** One plot per template chart, using the series the dashboard draws for that workflow. */
export function plotsForTemplate(input: DeckInput): Map<number, ChartPlot> {
  const label = input.rangeLabel;
  const plots = new Map<number, ChartPlot>();
  plots.set(1, pivRates(input));
  plots.set(2, monthlyCount(input, input.scrub.piv.vol, 'PIV volume by month', 'PIV transactions'));
  plots.set(3, distribution(input, /propensity/i, 'Propensity to pay'));
  plots.set(4, distribution(input, /fpl/i, 'FPL distribution'));
  plots.set(5, monthlyCount(input, input.scrub.bk, 'Bankruptcy results by month', 'Bankruptcy results'));
  const bankruptcyYears = input.scrub.yoy.bk.filter((row) => row[1] != null);
  plots.set(6, {
    title: `Bankruptcy results, year over year · ${label}`,
    categories: bankruptcyYears.length ? bankruptcyYears.map((row) => String(row[0])) : [label],
    series: [{ name: 'Results', values: bankruptcyYears.length ? bankruptcyYears.map((row) => Number(row[1])) : [0], format: COUNT }],
  });
  plots.set(7, monthlyCount(input, input.scrub.dc, 'Deceased results by month', 'Deceased results'));
  plots.set(8, monthlyCount(input, input.scrub.dc, 'Deceased results by month', 'Deceased results'));
  plots.set(9, returnMailMix(input));
  plots.set(10, returnMailRates(input));
  plots.set(11, medicaidCoverage(input));
  plots.set(12, monthlyCount(input, input.scrub.ch, 'Charity accounts qualified by month', 'Charity accounts qualified'));
  const seg = input.client.seg;
  plots.set(13, {
    title: `Segment volume · ${label}`,
    categories: ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5'],
    series: [{ name: '% Volume', values: seg?.vol ?? [0, 0, 0, 0, 0], format: PERCENT }],
  });
  plots.set(14, {
    title: `Segment payments · ${label}`,
    categories: ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5'],
    series: [{ name: '% Payments', values: seg?.pay ?? [0, 0, 0, 0, 0], format: PERCENT }],
  });
  for (let index = 0; index < 5; index++) plots.set(15 + index, segmentMix(input, index));
  const value = visibleScrubs(input.client);
  plots.set(20, {
    title: `Where the value came from · ${label}`,
    categories: value.length ? value.map((row) => row[0]) : [label],
    series: [{ name: 'Quantified benefit', values: value.length ? value.map((row) => row[1]) : [0], format: DOLLARS }],
  });
  return plots;
}

export interface AddedChart {
  slide: number;
  sourceChart: number;
  plot: ChartPlot;
  x: number;
  y: number;
  cx: number;
  cy: number;
}

const emu = (inches: number) => Math.round(inches * 914400);

function place(slide: number, sourceChart: number, plot: ChartPlot, x: number, y: number, cx: number, cy: number): AddedChart {
  return { slide, sourceChart, plot, x: emu(x), y: emu(y), cx: emu(cx), cy: emu(cy) };
}

/**
 * Dashboard graphs placed on top of the template's example screenshots, plus payments,
 * collection rate, dialer, and agency where the template has no chart for them.
 */
export function addedCharts(input: DeckInput): AddedChart[] {
  const charts: AddedChart[] = [
    place(39, 8, patientPayments(input), 0.7, 0.55, 9.15, 10.05),
    place(39, 8, collectionRate(input), 10.0, 0.55, 9.15, 10.05),
    place(5, 2, monthlyCount(input, input.scrub.piv.vol, 'PIV volume by month', 'PIV transactions'), 10.58, 3.36, 7.24, 4.54),
    place(7, 2, distribution(input, /propensity/i, 'Propensity to pay'), 10.75, 4.27, 5.42, 2.38),
    place(7, 2, distribution(input, /fpl/i, 'FPL distribution'), 10.74, 7.44, 5.18, 2.88),
    place(10, 2, monthlyCount(input, input.scrub.bk, 'Bankruptcy results by month', 'Bankruptcy results'), 12.3, 1.55, 5.2, 8.8),
    place(11, 2, monthlyCount(input, input.scrub.bk, 'Bankruptcy results by month', 'Bankruptcy results'), 0.7, 5.12, 18.2, 5.2),
    place(14, 2, monthlyCount(input, input.scrub.dc, 'Deceased results by month', 'Deceased results'), 8.17, 2.12, 11.5, 7.0),
    place(15, 2, monthlyCount(input, input.scrub.dc, 'Deceased results by month', 'Deceased results'), 0.75, 4.62, 16.0, 5.7),
    place(18, 9, returnMailMix(input), 7.61, 2.3, 10.5, 6.85),
    place(25, 2, monthlyCount(input, input.scrub.ch, 'Charity accounts qualified by month', 'Charity accounts qualified'), 0.75, 4.96, 17.2, 5.6),
    place(27, 9, segmentCompare(input), 1.5, 2.15, 14.9, 2.3),
  ];
  if (input.client.dialer) {
    charts.push(place(19, 8, dialerPayments(input), 8.2, 1.45, 8.7, 4.35));
    charts.push(place(19, 8, dialerContactRate(input), 8.2, 5.85, 8.7, 3.85));
  }
  const agency = input.client.agencyData;
  if (input.client.agency && agency) {
    const slides = [33, 34, 35, 36];
    const boxes = [
      { x: 0.45, y: 1.65, cx: 12.7, cy: 8.15 },
      { x: 0.4, y: 1.5, cx: 12.6, cy: 8.4 },
      { x: 0.4, y: 1.5, cx: 18.7, cy: 8.7 },
      { x: 0.45, y: 1.45, cx: 16.9, cy: 8.55 },
    ];
    Object.entries(agency.periods).forEach(([period, series], index) => {
      const slide = slides[index];
      const box = boxes[index];
      if (!slide || !box) return;
      charts.push(
        place(slide, 9, {
          title: `${period} placements · ${input.rangeLabel}`,
          categories: agency.buckets,
          series: Object.entries(series).map(([name, values]) => ({ name, values, format: PERCENT })),
        }, box.x, box.y, box.cx, box.cy),
      );
    });
  }
  return charts;
}

function rewriteSection(block: string, section: 'cat' | 'val', values: Array<string | null>, format: string | undefined, numeric: boolean) {
  const sectionRe = new RegExp(`<c:${section}>[\\s\\S]*?</c:${section}>`);
  if (!sectionRe.test(block)) return block;
  return block.replace(sectionRe, (sectionXml) => {
    const tag = numeric ? 'numCache' : 'strCache';
    if (!sectionXml.includes(`<c:${tag}>`)) return sectionXml;
    return sectionXml.replace(new RegExp(`<c:${tag}>[\\s\\S]*?</c:${tag}>`), (cache) => {
      const kept = !format && numeric ? (cache.match(/<c:formatCode>[\s\S]*?<\/c:formatCode>/)?.[0] ?? '') : '';
      const code = format ? `<c:formatCode>${escapeText(format)}</c:formatCode>` : kept;
      return `<c:${tag}>${code}${points(values)}</c:${tag}>`;
    });
  });
}

function rewriteSeries(block: string, categories: string[], series: ChartSeries) {
  const named = block.replace(/(<c:tx>[\s\S]*?<c:v>)[^<]*(<\/c:v>)/, `$1${escapeText(series.name)}$2`);
  const withCats = rewriteSection(named, 'cat', categories, undefined, false);
  return rewriteSection(withCats, 'val', series.values.map(num), series.format, true);
}

function withSeriesCount(xml: string, count: number) {
  const series = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? [];
  if (!series.length || series.length >= count) return xml;
  const last = series[series.length - 1];
  let extra = '';
  for (let index = series.length; index < count; index++) {
    extra += last.replace(/<c:idx val="\d+"\/>/, `<c:idx val="${index}"/>`).replace(/<c:order val="\d+"\/>/, `<c:order val="${index}"/>`);
  }
  const at = xml.lastIndexOf(last);
  return xml.slice(0, at + last.length) + extra + xml.slice(at + last.length);
}

function applyAxisFormat(axis: string, format: string) {
  return axis.replace(/<c:numFmt[^/]*\/>/, `<c:numFmt formatCode="${escapeText(format)}" sourceLinked="0"/>`);
}

/** Replace cached chart points with dashboard series and drop the template's external workbook link. */
export function rewriteChartXml(xml: string, plot: ChartPlot): string {
  let next = xml.replace(/<c15:filtered\w+Series>[\s\S]*?<\/c15:filtered\w+Series>/g, '');
  next = next.replace(/<c:externalData[\s\S]*?<\/c:externalData>/g, '');
  next = withSeriesCount(next, plot.series.length);
  next = next.replace(/(<c:title>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/, `$1${escapeText(plot.title)}$2`);
  let index = 0;
  next = next.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (block) => {
    const series = plot.series[index++];
    return series ? rewriteSeries(block, plot.categories, series) : '';
  });
  if (plot.categories.length > 8) next = next.replaceAll('<c:showVal val="1"/>', '<c:showVal val="0"/>');
  if (plot.stack) {
    next = next.replaceAll('<c:grouping val="clustered"/>', '<c:grouping val="stacked"/>');
    next = next.replaceAll(/<c:overlap val="-?\d+"\/>/g, '<c:overlap val="100"/>');
  }
  const axes = [...next.matchAll(/<c:valAx>[\s\S]*?<\/c:valAx>/g)];
  const shared = plot.series[0]?.format;
  if (axes.length === 1 && shared && plot.series.every((series) => series.format === shared)) {
    next = next.replace(axes[0][0], applyAxisFormat(axes[0][0], shared));
  } else {
    plot.series.forEach((series, axisIndex) => {
      const axis = axes[axisIndex];
      if (!series.format || !axis) return;
      next = next.replace(axis[0], applyAxisFormat(axis[0], series.format));
    });
  }
  return next;
}
