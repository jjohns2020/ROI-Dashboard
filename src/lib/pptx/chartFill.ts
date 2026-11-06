import type { DeckInput } from './buildDeck';

export interface ChartSeries {
  name: string;
  values: number[];
  /** Excel format code. Percent values stay in the 0–1 range. */
  format?: string;
}

export interface ChartPlot {
  title: string;
  categories: string[];
  series: ChartSeries[];
}

const COUNT = '#,##0';
const DOLLARS = '$#,##0';
const PERCENT = '0.0%';

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(value: number) {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 10000) / 10000);
}

function points(values: string[]) {
  return `<c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${escapeText(value)}</c:v></c:pt>`)
    .join('')}`;
}

function selectedMonths(input: DeckInput) {
  const months = input.monthly.months.slice(input.range.fI, input.range.tI + 1);
  return months.length ? months : [input.rangeLabel];
}

function selectedValues(input: DeckInput, values: number[]) {
  const slice = values.slice(input.range.fI, input.range.tI + 1).map((value) => (Number.isFinite(value) ? value : 0));
  return slice.length ? slice : [0];
}

function rolling(values: number[]) {
  return values.map((_, index) => {
    const part = values.slice(Math.max(0, index - 2), index + 1);
    return part.reduce((sum, value) => sum + value, 0) / part.length;
  });
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

/** One plot per template chart. Categories and values come from the dashboard date range. */
export function plotsForTemplate(input: DeckInput): Map<number, ChartPlot> {
  const months = selectedMonths(input);
  const label = input.rangeLabel;
  const piv = selectedValues(input, input.scrub.piv.vol);
  const rmNew = selectedValues(input, input.scrub.rm.new);
  const rmImp = selectedValues(input, input.scrub.rm.imp);
  const rmEq = selectedValues(input, input.scrub.rm.eq);
  const rmNh = selectedValues(input, input.scrub.rm.nh);
  const rmVol = rmNew.map((value, index) => value + rmImp[index] + rmEq[index] + rmNh[index]);
  const mailDollars = input.monthly.wf['Return Mail collections ($)'];
  const mc = input.scrub.yoy.mc;
  const ch = input.scrub.yoy.ch;
  const seg = input.client.seg;
  const plots = new Map<number, ChartPlot>();
  plots.set(1, {
    title: `Address verification · ${label}`,
    categories: months,
    series: [
      { name: 'PIV volume', values: piv, format: COUNT },
      { name: '3-month average', values: rolling(piv), format: COUNT },
    ],
  });
  plots.set(2, {
    title: `PFC transactions · ${label}`,
    categories: months,
    series: [
      { name: 'Transactions', values: piv, format: COUNT },
      { name: '3-month average', values: rolling(piv), format: COUNT },
    ],
  });
  plots.set(3, distribution(input, /propensity/i, 'Propensity to pay'));
  plots.set(4, distribution(input, /fpl/i, 'FPL distribution'));
  plots.set(5, {
    title: `Bankruptcy results · ${label}`,
    categories: months,
    series: [{ name: 'Bankruptcy results', values: selectedValues(input, input.scrub.bk), format: COUNT }],
  });
  plots.set(6, {
    title: `Chapter split is not in this review · ${label}`,
    categories: [label],
    series: [
      { name: 'Chapter 7', values: [0], format: PERCENT },
      { name: 'Chapter 13', values: [0], format: PERCENT },
    ],
  });
  plots.set(7, {
    title: `Deceased results · ${label}`,
    categories: months,
    series: [{ name: 'Deceased results', values: selectedValues(input, input.scrub.dc), format: COUNT }],
  });
  plots.set(8, {
    title: `Deceased results · ${label}`,
    categories: months,
    series: [{ name: 'Deceased results', values: selectedValues(input, input.scrub.dc), format: COUNT }],
  });
  plots.set(9, {
    title: `Return mail · ${label}`,
    categories: months,
    series: [
      { name: 'Return mail volume', values: rmVol, format: COUNT },
      { name: 'New', values: rmNew, format: COUNT },
      { name: 'Improved', values: rmImp, format: COUNT },
    ],
  });
  plots.set(10, {
    title: `Return mail collections · ${label}`,
    categories: months,
    series: [{ name: 'Collections', values: mailDollars ? selectedValues(input, mailDollars) : rmVol, format: mailDollars ? DOLLARS : COUNT }],
  });
  plots.set(11, {
    title: `Medicaid · ${label}`,
    categories: mc.length ? mc.map((row) => String(row[0])) : [label],
    series: [
      { name: 'Payments', values: mc.length ? mc.map((row) => Number(row[1]) || 0) : [0], format: DOLLARS },
      { name: 'Hit rate', values: mc.length ? mc.map((row) => Number(row[2]) || 0) : [0], format: PERCENT },
    ],
  });
  plots.set(12, {
    title: `Charity · ${label}`,
    categories: ch.length ? ch.map((row) => String(row[0])) : [label],
    series: [
      { name: 'Qualified accounts', values: ch.length ? ch.map((row) => Number(row[1]) || 0) : [0], format: COUNT },
      { name: 'Qualified balance', values: ch.length ? ch.map((row) => Number(row[2]) || 0) : [0], format: DOLLARS },
    ],
  });
  plots.set(13, {
    title: `Segment volume · ${label}`,
    categories: ['Segment 1', 'Segment 2', 'Segment 3', 'Segment 4', 'Segment 5'],
    series: [{ name: '% of volume', values: seg?.vol ?? [0, 0, 0, 0, 0], format: PERCENT }],
  });
  plots.set(14, {
    title: `Segment payments · ${label}`,
    categories: ['Segment 1', 'Segment 2', 'Segment 3', 'Segment 4', 'Segment 5'],
    series: [{ name: '% of payments', values: seg?.pay ?? [0, 0, 0, 0, 0], format: PERCENT }],
  });
  for (let index = 0; index < 5; index++) plots.set(15 + index, segmentMix(input, index));
  const included = [
    ['PFC', input.details.some((detail) => /financial clearance|address/i.test(detail.name) && !detail.empty)],
    ['Bankruptcy', input.details.some((detail) => /bankruptcy/i.test(detail.name) && !detail.empty)],
    ['Deceased', input.details.some((detail) => /deceased/i.test(detail.name) && !detail.empty)],
    ['Return mail', input.details.some((detail) => /return mail/i.test(detail.name) && !detail.empty)],
    ['Medicaid', input.details.some((detail) => /medicaid/i.test(detail.name) && !detail.empty)],
    ['Charity', input.details.some((detail) => /charity/i.test(detail.name) && !detail.empty)],
    ['Segmentation', !!input.client.seg],
    ['Agency', !!input.client.agency],
    ['Dialer', !!input.client.dialer],
  ] as const;
  plots.set(20, {
    title: `Workflows in this review · ${label}`,
    categories: included.map((row) => row[0]),
    series: [{ name: 'Included', values: included.map((row) => (row[1] ? 1 : 0)), format: COUNT }],
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

/** Dashboard graphs that the template does not already chart: payments, collection rate, dialer, and agency. */
export function addedCharts(input: DeckInput): AddedChart[] {
  const months = selectedMonths(input);
  const label = input.rangeLabel;
  const charts: AddedChart[] = [
    {
      slide: 39,
      sourceChart: 8,
      x: emu(0.7),
      y: emu(0.55),
      cx: emu(9.15),
      cy: emu(10.05),
      plot: {
        title: `Patient payments · ${label}`,
        categories: months,
        series: [{ name: 'Patient payments', values: selectedValues(input, input.monthly.pay), format: DOLLARS }],
      },
    },
    {
      slide: 39,
      sourceChart: 8,
      x: emu(10.0),
      y: emu(0.55),
      cx: emu(9.15),
      cy: emu(10.05),
      plot: {
        title: `Collection rate · ${label}`,
        categories: months,
        series: [{ name: 'Collection rate', values: selectedValues(input, input.monthly.rate), format: PERCENT }],
      },
    },
  ];
  if (input.client.dialer) {
    charts.push({
      slide: 19,
      sourceChart: 8,
      x: emu(8.2),
      y: emu(1.55),
      cx: emu(8.7),
      cy: emu(8.15),
      plot: {
        title: `Dialer payments · ${label}`,
        categories: months,
        series: [{ name: 'Dialer payments', values: selectedValues(input, input.monthly.dialer.payments), format: DOLLARS }],
      },
    });
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
      charts.push({
        slide,
        sourceChart: 9,
        x: emu(box.x),
        y: emu(box.y),
        cx: emu(box.cx),
        cy: emu(box.cy),
        plot: {
          title: `${period} placements · ${label}`,
          categories: agency.buckets,
          series: Object.entries(series).map(([name, values]) => ({ name, values, format: PERCENT })),
        },
      });
    });
  }
  return charts;
}

function rewriteSection(block: string, section: 'cat' | 'val', values: string[], format: string | undefined, numeric: boolean) {
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

/** Replace cached chart points with dashboard series and drop the template's external workbook link. */
export function rewriteChartXml(xml: string, plot: ChartPlot): string {
  let next = xml.replace(/<c15:filtered\w+Series>[\s\S]*?<\/c15:filtered\w+Series>/g, '');
  next = next.replace(/<c:externalData[\s\S]*?<\/c:externalData>/g, '');
  next = next.replace(/(<c:title>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/, `$1${escapeText(plot.title)}$2`);
  let index = 0;
  next = next.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (block) => {
    const series = plot.series[index++];
    return series ? rewriteSeries(block, plot.categories, series) : '';
  });
  if (plot.categories.length > 8) next = next.replaceAll('<c:showVal val="1"/>', '<c:showVal val="0"/>');
  const format = plot.series[0]?.format;
  if (format && plot.series.every((series) => series.format === format)) {
    const code = escapeText(format);
    next = next.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, (axis) =>
      axis.replace(/<c:numFmt[^/]*\/>/, `<c:numFmt formatCode="${code}" sourceLinked="0"/>`),
    );
  }
  return next;
}
