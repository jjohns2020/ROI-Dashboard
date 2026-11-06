/**
 * Fills Utilization Review text placeholders from the workflow pages.
 * Figures that are not on the dashboard stay "Not in this review" — nothing is estimated.
 */
import type { Client, WorkflowDetail } from '../../data/types';
import { sumRange } from '../dateRange';
import { count, moneyFull, pct } from '../format';
import { returnMailScale } from '../roi';
import { visibleScrubs } from '../visibility';
import type { DeckInput } from './buildDeck';

const MISSING = 'Not in this review';
const DASH = '—';

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

function replaceNthExact(xml: string, from: string, values: string[]) {
  let index = 0;
  return replaceTextNodes(xml, (text) => {
    if (text !== from) return null;
    const value = index < values.length ? values[index] : text;
    index += 1;
    return value;
  });
}

function swap(xml: string, pairs: [string, string][]) {
  return pairs.reduce((next, [from, to]) => replaceExact(next, from, to), xml);
}

interface Labor {
  hours?: string;
  fte?: string;
  cost?: string;
}

function findDetail(input: DeckInput, pattern: RegExp) {
  return input.details.find((detail) => !detail.empty && pattern.test(detail.name));
}

function addressDetail(input: DeckInput) {
  return findDetail(input, /^address verification/i) ?? findDetail(input, /address verification/i);
}

function kpi(detail: WorkflowDetail | undefined, pattern: RegExp) {
  return detail?.kpis?.find((row) => pattern.test(row[0]));
}

function kpiValue(detail: WorkflowDetail | undefined, pattern: RegExp) {
  return kpi(detail, pattern)?.[1];
}

function reviewMonths(client: Client) {
  const months = client.trend.reviews[client.trend.reviews.length - 1]?.m;
  return months && months > 0 ? months : 0;
}

/** First number in a dashboard label, including $1.2M and $74.9M. */
function parseLooseNumber(value: string) {
  const match = value.match(/\$?\s*([\d,.]+)\s*([KkMm])?/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (match[2] === 'M' || match[2] === 'm') return parsed * 1e6;
  if (match[2] === 'K' || match[2] === 'k') return parsed * 1e3;
  return parsed;
}

function monthlyCount(value: string | undefined, months: number) {
  if (!value || !months || /%/.test(value)) return undefined;
  const parsed = parseLooseNumber(value);
  return parsed == null ? undefined : count(parsed / months);
}

function monthlyMoney(value: string | undefined, months: number) {
  if (!value || !months) return undefined;
  const parsed = parseLooseNumber(value);
  return parsed == null ? undefined : moneyFull(parsed / months);
}

function shown(value: string | undefined, missing = MISSING) {
  return value && value.trim() ? value : missing;
}

function bareMoney(value: string | undefined) {
  return value ? value.replace(/^\$/, '') : DASH;
}

function laborOf(detail: WorkflowDetail | undefined): Labor {
  const labor: Labor = {};
  if (!detail) return labor;
  for (const [label, value] of detail.table?.r ?? []) {
    if (/hour/i.test(label) && !labor.hours) labor.hours = value;
    if (/fte/i.test(label) && !labor.fte) labor.fte = value;
    if (/manual work|labor/i.test(label) && value.includes('$') && !labor.cost) labor.cost = value;
  }
  for (const [label, value, note] of detail.kpis ?? []) {
    if (!/automation|manual|fte|hour|labor/i.test(label)) continue;
    const hours = note.match(/([\d,.]+)\s*hours?/i)?.[1] ?? value.match(/([\d,.]+)\s*hours?/i)?.[1];
    const fte = note.match(/([\d,.]+)\s*fte/i)?.[1] ?? value.match(/([\d,.]+)\s*fte/i)?.[1];
    if (hours && !labor.hours) labor.hours = hours;
    if (fte && !labor.fte) labor.fte = fte;
    if (/^fte/i.test(label) && !labor.fte) labor.fte = value;
    if (value.includes('$') && !labor.cost) labor.cost = value;
  }
  return labor;
}

function laborText(labor: Labor) {
  const parts: string[] = [];
  if (labor.hours) parts.push(/hour/i.test(labor.hours) ? labor.hours : `${labor.hours} hours`);
  if (labor.fte) parts.push(/fte/i.test(labor.fte) ? labor.fte : `${labor.fte} FTE`);
  return parts.length ? parts.join(' or ') : undefined;
}

function laborPhrase(detail: WorkflowDetail | undefined) {
  const labor = laborOf(detail);
  const effort = laborText(labor);
  if (effort && labor.cost) return `${effort}; ${labor.cost}`;
  return effort ?? labor.cost;
}

function statementOf(detail: WorkflowDetail | undefined) {
  return detail?.table?.r.find((row) => /statement/i.test(row[0]))?.[1] ?? kpiValue(detail, /statement/i);
}

function chartPct(detail: WorkflowDetail | undefined, title: RegExp, category: RegExp) {
  const chart = detail?.charts?.find((item) => title.test(item.t));
  if (!chart) return undefined;
  const index = chart.cats.findIndex((cat) => category.test(cat.replace(/[–—-]/g, '-')));
  if (index < 0) return undefined;
  const value = chart.v[index];
  return chart.f === 'p' || value <= 1 ? pct(value) : count(value);
}

function percentIn(value: string | undefined) {
  return value?.match(/[\d.]+%/)?.[0];
}

function at(volume: string | undefined, dollars: string | undefined) {
  if (volume && dollars) return `${volume} @ ${dollars.startsWith('$') ? dollars : `$${dollars}`}`;
  return volume ?? dollars;
}

function observation(detail: WorkflowDetail | undefined) {
  if (detail?.take) return detail.take;
  const lines = (detail?.kpis ?? []).slice(0, 4).map((row) => `${row[0]} ${row[1]}`);
  return lines.length ? lines.join('; ') : MISSING;
}

function monitored(detail: WorkflowDetail | undefined) {
  const rows = (detail?.kpis ?? []).filter((row) => /monitored/i.test(row[0]));
  if (!rows.length) return undefined;
  if (rows.length === 1) return rows[0][1];
  return rows.map((row) => `${row[1]} ${row[0].replace(/\s*monitored/i, '')}`).join('; ');
}

function totalNewImproved(address: WorkflowDetail | undefined, pfc: WorkflowDetail | undefined) {
  const direct = kpiValue(address, /new \+ improved|total new/i) ?? kpiValue(pfc, /new \+ improved|total new/i);
  if (direct) return direct;
  const newer = percentIn(kpiValue(address, /new address/i));
  const improved = percentIn(kpiValue(address, /improved/i));
  if (!newer || !improved) return undefined;
  return `${(Number(newer.replace('%', '')) + Number(improved.replace('%', ''))).toFixed(1)}%`;
}

/** Return-mail counts follow the dashboard's guarantor toggle. Dollars and percents do not. */
function scaleCount(value: string | undefined, input: DeckInput) {
  if (!value) return undefined;
  if (input.rmLevel !== 'guar' || /%|\$/.test(value)) return value;
  const parsed = parseLooseNumber(value);
  if (parsed == null) return value;
  return `${count(returnMailScale(parsed, 'guar', input.guarRatio) as number)} counted by guarantors`;
}

function fteHeadline(input: DeckInput) {
  if (input.client.fte != null) return `${input.client.fte} FTE hour savings via automation`;
  let sum = 0;
  let found = false;
  for (const detail of input.details) {
    if (detail.empty) continue;
    const fte = laborOf(detail).fte;
    if (!fte) continue;
    const parsed = Number(fte.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) continue;
    sum += parsed;
    found = true;
  }
  if (!found) return MISSING;
  return `${(Math.round(sum * 100) / 100).toString()} FTE hour savings via automation`;
}

function dialerTotals(input: DeckInput) {
  const { fI, tI } = input.range;
  const dialer = input.monthly.dialer;
  const months = tI - fI + 1;
  return {
    attempts: sumRange(dialer.attempts.slice(fI, tI + 1), 0, months),
    payments: sumRange(dialer.payments.slice(fI, tI + 1), 0, months),
    months,
  };
}

function agencyRates(input: DeckInput) {
  const data = input.client.agencyData;
  if (!input.client.agency || !data) return undefined;
  const period = Object.keys(data.periods)[0];
  if (!period) return undefined;
  return (
    Object.entries(data.periods[period])
      .map(([name, values]) => `${name} ${pct(values[values.length - 1])}`)
      .join('; ') + ` (${period} total)`
  );
}

function fillUsedBy(xml: string, name: string) {
  return replaceTextNodes(xml, (text) => {
    if (!/used by/i.test(text) || !/insert/i.test(text)) return null;
    return text.replace(/<{2,3}\s*insert\s*>{2,3}/gi, name);
  });
}

function cleanLabels(xml: string) {
  return replaceTextNodes(xml, (text) => (/fte hours or xxx fte/i.test(text) ? ' Saved for automation' : null));
}

function fillAddress(xml: string, input: DeckInput) {
  const detail = addressDetail(input);
  const pfc = findDetail(input, /financial clearance/i);
  const months = reviewMonths(input.client);
  const searches = kpiValue(detail, /total searches|piv volume|piv transactions/i);
  const average = kpiValue(detail, /avg monthly/i) ?? monthlyCount(searches, months);
  return swap(xml, [
    ['<<Insert>>> total address searches', `${shown(searches)} total address searches`],
    ['<<<Insert>>> average monthly transaction', `${shown(average)} average monthly transactions`],
    ['New Addresses Results:  <<Insert %>>', `New Addresses Results:  ${shown(kpiValue(detail, /new address/i))}`],
    ['Improved Address Results:  <<Insert %>>', `Improved Address Results:  ${shown(kpiValue(detail, /improved/i))}`],
    ['Total New & Improved:  <<Insert %>>', `Total New & Improved:  ${shown(totalNewImproved(detail, pfc))}`],
    ['<<Insert>>', shown(statementOf(detail))],
    ['<<Insert hours, FTE and wage impact>>', shown(laborPhrase(detail))],
    ['<<Insert>> in initial patient responsibility', `${shown(kpiValue(detail, /impacted/i))} in initial patient responsibility`],
    ['Insert observations for this ', observation(detail)],
    ['Increased monthly volume since last period (458k vs 498k).  ', ''],
  ]);
}

function fillClearance(xml: string, input: DeckInput) {
  const detail = findDetail(input, /financial clearance/i);
  const months = reviewMonths(input.client);
  const searches = kpiValue(detail, /pfc searches|financial clearance searches/i);
  const average = monthlyCount(searches, months);
  const propensity = (category: RegExp) => shown(chartPct(detail, /propensity/i, category));
  const fpl = (category: RegExp) => shown(chartPct(detail, /fpl/i, category));
  return swap(xml, [
    ['<<Insert>>> total financial clearance searches ', `${shown(searches)} total financial clearance searches`],
    ['<<<Insert>>> average monthly transaction', `${shown(average)} average monthly transactions`],
    ['High:  <<Insert %>>', `High:  ${propensity(/^high/i)}`],
    ['Medium:  <<Insert %>>', `Medium:  ${propensity(/^medium/i)}`],
    ['Low:  <<Insert %>>', `Low:  ${propensity(/^low/i)}`],
    ['No Credit or Unknown:  <<Insert %>>', `No Credit or Unknown:  ${propensity(/^nc$|no credit|unknown/i)}`],
    ['1-100%:       <<Insert %>>', `1-100%:       ${fpl(/^1-100%/)}`],
    ['101-200%:   <<Insert %>>', `101-200%:   ${fpl(/^101-200%/)}`],
    ['201-300%:   <<Insert %>>', `201-300%:   ${fpl(/^201-300%/)}`],
    ['301-400%:   <<Insert %>>', `301-400%:   ${fpl(/^301-400%/)}`],
    ['401-500%:   <<Insert %>>', `401-500%:   ${fpl(/^401-500%/)}`],
    ['501%+         <<Insert %>>', `501%+         ${fpl(/^501/)}`],
  ]);
}

function fillBankruptcy(xml: string, input: DeckInput) {
  const detail = findDetail(input, /bankruptcy/i);
  const months = reviewMonths(input.client);
  const volume = kpiValue(detail, /bankruptcy results/i);
  const dollars = kpiValue(detail, /impacted balance/i);
  const labor = laborOf(detail);
  const average = at(monthlyCount(volume, months), monthlyMoney(dollars, months));
  return swap(xml, [
    ['Bankruptcy Scrub:  <<Insert>>', `Bankruptcy Scrub:  ${input.rangeLabel}`],
    ['Total accounts monitored for Bankruptcy:  <<Insert>>', `Total accounts monitored for Bankruptcy:  ${shown(monitored(detail))}`],
    ['Total bankruptcies identified:  <<Insert Volume @ Insert Dollars>>', `Total bankruptcies identified:  ${shown(at(volume, dollars))}`],
    ['Average monthly:  1,985 @ $617k**', `Average monthly:  ${shown(average)}`],
    ['Chapter 7:  <<insert %>>', `Chapter 7:  ${MISSING}`],
    ['<<Insert %>> Petitioned', MISSING],
    ['<<Insert %>> Discharged', MISSING],
    ['<<Insert %>> Dismissed', MISSING],
    ['Chapter 13:  <<Insert %>>', `Chapter 13:  ${MISSING}`],
    ['Compliance Mitigation:  <<Insert Bankruptcy Result Volume>>', `Compliance Mitigation:  ${shown(volume)}`],
    ['<<Insert>> hours or <<insert>> FTEs in automation', shown(laborText(labor))],
    ['<<Insert>> FTE Cost Savings ', shown(labor.cost)],
    ['Summarize process workflow', shown(detail?.sub, detail?.sub ?? MISSING)],
    ['Recovery:  <<Insert Total Payments minus contingency>>  or <<Insert Net Recovery Rate>> ', `Recovery: ${MISSING}`],
    ['Recovery Since Go Live (Insert Go Live Date):  <<Insert Total Payment minus contingency) or <<insert net recovery>>', `Recovery since go-live: ${MISSING}`],
  ]);
}

function fillDeceased(xml: string, input: DeckInput) {
  const detail = findDetail(input, /deceased/i);
  const months = reviewMonths(input.client);
  const results = kpiValue(detail, /deceased results/i);
  const labor = laborOf(detail);
  const collections = kpiValue(detail, /collections/i);
  return swap(xml, [
    ['Total accounts scrubbed for Deceased (recurring):  <<Insert>>', `Total accounts scrubbed for Deceased (recurring):  ${shown(monitored(detail))}`],
    ['Deceased results: <<Insert Volume>>', `Deceased results: ${shown(results)}`],
    ['Average monthly:  <<Insert>>>', `Average monthly:  ${shown(monthlyCount(results, months))}`],
    ['  <<insert>>hours or <<insert>> FTE’s', shown(laborText(labor))],
    ['<<insert>> FTE Cost savings', shown(labor.cost)],
    ['Deceased Collections:  $<<insert>> ', `Deceased Collections:  ${shown(collections)}`],
    ['Describe process / workflow', shown(detail?.sub)],
    ['Recovery:  <<Insert Total Payments minus contingency>>  or <<Insert Net Recovery Rate>> ', `Recovery: ${MISSING}`],
    ['Recovery Since Go Live (Insert Go Live Date):  <<Insert Total Payment minus contingency) or <<insert net recovery>>', `Recovery since go-live: ${MISSING}`],
  ]);
}

function fillReturnMail(xml: string, input: DeckInput) {
  const detail = findDetail(input, /return mail/i);
  const months = reviewMonths(input.client);
  const accounts = scaleCount(kpiValue(detail, /accounts$|return mail results/i), input);
  const resultSource = kpiValue(detail, /searches|new \+ improved/i) ?? kpiValue(detail, /return mail results/i);
  const results = scaleCount(resultSource, input);
  const hit = kpiValue(detail, /hit rate/i);
  const labor = laborOf(detail);
  const collections = kpiValue(detail, /collections/i);
  const volume = hit && results && !results.includes(hit) ? `${results} (${hit} hit rate)` : results;
  const perMonth = monthlyCount(resultSource, months);
  const average = perMonth && input.rmLevel === 'guar' ? scaleCount(perMonth, input) : perMonth;
  const note = 'Monthly split is illustrative; period totals are from the workbook.';
  return swap(xml, [
    ['Total accounts scrubbed for Return Mail: <<Insert>>', `Total accounts scrubbed for Return Mail: ${shown(accounts)}`],
    ['Return Mail results: <<Insert Volume>>', `Return Mail results: ${shown(volume)}`],
    ['Average monthly:  <<Insert Volume>>>', `Average monthly:  ${shown(average)}`],
    [' <<insert>>hours or <<insert>> FTE’s', shown(laborText(labor))],
    [' <<insert>> FTE Cost savings', shown(labor.cost)],
    ['Return Mail Collections:  $<<insert>> ', `Return Mail Collections:  ${shown(collections)}`],
    ['Insert Observations and/or proposals', `${observation(detail)} ${note}`],
  ]);
}

function fillDialer(xml: string, input: DeckInput) {
  if (!input.client.dialer) {
    return swap(xml, [
      ['Total accounts in campaign: <<Insert>>', `Total accounts in campaign: ${MISSING}`],
      ['Average monthly:  <<Insert Volume>>>', `Average monthly:  ${MISSING}`],
      [' <<insert>>hours or <<insert>> FTE’s', MISSING],
      [' <<insert>> FTE Cost savings', MISSING],
      ['Campaign Attributed Payments:  $<<insert>> ', `Campaign Attributed Payments:  ${MISSING}`],
    ]);
  }
  const { attempts, payments, months } = dialerTotals(input);
  return swap(xml, [
    ['Total accounts in campaign: <<Insert>>', `Dialer Performance. ILLUSTRATIVE SAMPLE DATA. Call attempts ${count(attempts)}`],
    ['Average monthly:  <<Insert Volume>>>', `Average monthly:  ${count(attempts / months)} call attempts`],
    [' <<insert>>hours or <<insert>> FTE’s', MISSING],
    [' <<insert>> FTE Cost savings', MISSING],
    ['Campaign Attributed Payments:  $<<insert>> ', `Campaign Attributed Payments:  ${moneyFull(payments)}`],
  ]);
}

function fillMedicaid(xml: string, input: DeckInput) {
  const detail = findDetail(input, /medicaid/i);
  const months = reviewMonths(input.client);
  const records = kpi(detail, /records scrubbed/i);
  const coverage = kpi(detail, /active coverage|hit rate/i);
  const balance = kpi(detail, /active balance/i);
  const payments = kpiValue(detail, /medicaid payments/i);
  const recordDollars = records?.[2].match(/\$[\d,.]+[KkMm]?/)?.[0];
  const labor = laborOf(detail);
  const hit = kpi(detail, /hit rate/i);
  const volumeRate = percentIn(hit?.[1]) ?? percentIn(coverage?.[2]) ?? percentIn(coverage?.[1]);
  const dollarRate = percentIn(balance?.[2]);
  return swap(xml, [
    ['Total records scrubbed:  <<Insert Volume @ $Insert Dollars>>', `Total records scrubbed:  ${shown(at(records?.[1], recordDollars))}`],
    ['Average monthly:  <<Insert Volume @ $Insert Dollars>>', `Average monthly:  ${shown(at(monthlyCount(records?.[1], months), monthlyMoney(recordDollars, months)))}`],
    ['Total Active Medicaid Finds:  <<Insert Volume @ $Insert Dollars>>', `Total Active Medicaid Finds:  ${shown(at(coverage?.[1], balance?.[1]))}`],
    ['Find Rate: <<insert %>> of volume / <<Insert %>> of dollars', `Find Rate: ${shown(volumeRate, DASH)} of volume / ${shown(dollarRate, DASH)} of dollars`],
    ['Medicaid Payments:  $<<Insert>>', `Medicaid Payments:  ${shown(payments)}`],
    ['Average Monthly:  $<<Insert>>', `Average Monthly:  ${shown(monthlyMoney(payments, months))}`],
    [' <<insert>>hours or <<insert>> FTE’s', shown(laborText(labor))],
    [' <<insert>> FTE Cost savings', shown(labor.cost)],
    ['Insert Observations and/or proposals', observation(detail)],
  ]);
}

function fillCharity(xml: string, input: DeckInput) {
  const detail = findDetail(input, /charity/i);
  const months = reviewMonths(input.client);
  const accounts = kpiValue(detail, /qualified accounts/i);
  const balance = kpiValue(detail, /qualified balance/i);
  const averageVolume = kpiValue(detail, /avg monthly/i) ?? monthlyCount(accounts, months);
  const labor = laborOf(detail);
  return swap(xml, [
    ['Charity Results:  <<Insert Volume @ $Insert Dollars>>', `Charity Results:  ${shown(at(accounts, balance))}`],
    ['Average monthly:  <<Insert Volume @ $Insert Dollars>>', `Average monthly:  ${shown(at(averageVolume, monthlyMoney(balance, months)))}`],
    [' <<insert>>hours or <<insert>> FTE’s', shown(laborText(labor))],
    [' <<insert>> FTE Cost savings', shown(labor.cost)],
    ['Statement Cost Avoidance:  $<<insert>>', `Statement Cost Avoidance:  ${shown(statementOf(detail))}`],
    ['Insert summary', observation(detail)],
    ['Insert Observations and/or proposals', observation(detail)],
    ['<<Insert volume & charity amount>>', shown(at(accounts, balance))],
  ]);
}

function fillValueTables(xml: string, slide: number, input: DeckInput) {
  const address = addressDetail(input);
  const bankruptcy = findDetail(input, /bankruptcy/i);
  const deceased = findDetail(input, /deceased/i);
  const mail = findDetail(input, /return mail/i);
  const medicaid = findDetail(input, /medicaid/i);
  const charity = findDetail(input, /charity/i);
  if (slide === 40) {
    const addressLabor = laborOf(address);
    const bankruptcyLabor = laborOf(bankruptcy);
    const deceasedLabor = laborOf(deceased);
    let next = replaceNthExact(xml, 'xxxxx', [
      bareMoney(statementOf(address)),
      laborText(addressLabor) ?? DASH,
      bareMoney(addressLabor.cost),
      laborText(bankruptcyLabor) ?? DASH,
      bareMoney(bankruptcyLabor.cost),
      laborText(deceasedLabor) ?? DASH,
      bareMoney(deceasedLabor.cost),
    ]);
    next = replaceNthExact(next, 'xxxxxx', [DASH, DASH]);
    return replaceExact(next, '(Insert Total Payments – above number is minus contingency fee of xxx%)', MISSING);
  }
  if (slide === 41) {
    const mailLabor = laborOf(mail);
    const medicaidLabor = laborOf(medicaid);
    let next = replaceNthExact(xml, 'xxxxx', [
      bareMoney(kpiValue(deceased, /collections/i)),
      laborText(mailLabor) ?? DASH,
      bareMoney(mailLabor.cost),
      DASH,
      DASH,
      bareMoney(kpiValue(medicaid, /medicaid payments/i)),
      laborText(medicaidLabor) ?? DASH,
      bareMoney(medicaidLabor.cost),
    ]);
    return replaceNthExact(next, 'xxxxxx', [DASH]);
  }
  if (slide === 42) {
    let next = replaceNthExact(xml, '<<$ Statement Cost Avoidance>>', [shown(statementOf(medicaid), DASH), shown(statementOf(charity), DASH)]);
    next = replaceExact(next, '<<Insert lift>>>', input.client.cash.lift > 0 ? moneyFull(input.client.cash.lift) : DASH);
    return replaceExact(next, '<<insert>> FTE  Hour Savings via Automation (insert # FTE)', fteHeadline(input));
  }
  return xml;
}

function fillAdditional(xml: string, input: DeckInput) {
  const address = addressDetail(input);
  const pfc = findDetail(input, /financial clearance/i);
  const bankruptcy = findDetail(input, /bankruptcy/i);
  const deceased = findDetail(input, /deceased/i);
  const mail = findDetail(input, /return mail/i);
  const medicaid = findDetail(input, /medicaid/i);
  const collections = kpiValue(mail, /collections/i);
  const dialer = input.client.dialer ? moneyFull(dialerTotals(input).payments) : DASH;
  const records = kpi(medicaid, /records scrubbed/i);
  const coverage = kpi(medicaid, /active coverage/i);
  const balance = kpi(medicaid, /active balance/i);
  const recordDollars = records?.[2].match(/\$[\d,.]+[KkMm]?/)?.[0];
  let next = swap(xml, [
    ['<Insert Volume>', shown(kpiValue(address, /total searches|piv volume|piv transactions/i))],
    ['Insert % New, % Improved, Total New & Improved %', `New ${shown(kpiValue(address, /new address/i), DASH)}; Improved ${shown(kpiValue(address, /improved/i), DASH)}; Total ${shown(totalNewImproved(address, pfc), DASH)}`],
    ['<Insert $>', shown(kpiValue(address, /impacted/i))],
    ['<Insert volume>', shown(kpiValue(pfc, /pfc searches/i) ?? kpiValue(pfc, /piv volume|piv transactions|total searches/i))],
    ['<Insert volume monitored>', shown(monitored(bankruptcy))],
    ['<Insert % Chapter 7 and % Chapter 13>', MISSING],
    ['<Insert volume scrubbed>', shown(monitored(deceased) ?? kpiValue(deceased, /deceased results/i))],
    ['<Insert deceased hit volume>', shown(kpiValue(deceased, /deceased results/i))],
    ['<Insert Volume Scrubbed / Balance Scrubbed>', shown(at(records?.[1], recordDollars))],
    ['<Insert active volume / balance>', shown(at(coverage?.[1], balance?.[1]))],
    ['<Insert Find %>', shown(percentIn(coverage?.[2]) ?? percentIn(coverage?.[1]))],
    ['>> - insert collections (Dashboard)', ''],
    ['>> - insert Dialer Call Attribution', input.client.dialer ? ' ILLUSTRATIVE SAMPLE DATA' : ''],
  ]);
  next = replaceNthExact(next, '<<$', [shown(collections, DASH), dialer]);
  return replaceNthExact(next, 'xxxx', ['', '']);
}

function fillClosingFigures(xml: string, input: DeckInput) {
  const top = visibleScrubs(input.client)[0];
  const shine = top ? `${top[0]} ${moneyFull(top[1])}` : MISSING;
  const recommendations = input.client.recs.length ? input.client.recs : ['Sample recommendation'];
  return replaceTextNodes(xml, (text) => {
    if (text === '<<Insert where shine – example below>>') return shine;
    if (text.includes('Keep it up!')) return shine;
    if (text === '<<Insert where to improved – example below>>') return recommendations[0];
    if (text.trim() === '<<Insert area>>') return ` ${top ? top[0] : MISSING}`;
    return null;
  });
}

function fillCloser(xml: string, input: DeckInput) {
  const recommendations = input.client.recs.length ? input.client.recs : ['Sample recommendation'];
  let next = replaceNthExact(xml, 'Insert proposed action', [recommendations[0] ?? '', recommendations[1] ?? '']);
  next = replaceExact(next, 'Insert proposed action ', recommendations[2] ?? '');
  next = replaceExact(next, 'Insert ', recommendations.slice(3).join('; ') || MISSING);
  return replaceExact(next, '<<Insert>>', input.client.name);
}

const OBSERVATION_SLIDES: Record<number, RegExp> = {
  6: /address verification/i,
  8: /financial clearance/i,
  12: /bankruptcy/i,
  16: /deceased/i,
  23: /medicaid/i,
  26: /charity/i,
};

/** Write dashboard volumes, rates, dollars, and FTE into one slide's placeholders. */
export function fillSlideFigures(xml: string, slide: number, input: DeckInput) {
  let next = fillUsedBy(xml, input.client.name);
  if (slide === 5) next = fillAddress(next, input);
  if (slide === 7) next = fillClearance(next, input);
  if (slide === 9 || slide === 10 || slide === 11) next = fillBankruptcy(next, input);
  if (slide === 13 || slide === 14 || slide === 15) next = fillDeceased(next, input);
  if (slide === 18 || slide === 20) next = fillReturnMail(next, input);
  if (slide === 19) next = fillDialer(next, input);
  if (slide === 22 || slide === 23) next = fillMedicaid(next, input);
  if (slide === 24 || slide === 25 || slide === 26 || slide === 44) next = fillCharity(next, input);
  if (slide === 40 || slide === 41 || slide === 42) next = fillValueTables(next, slide, input);
  if (slide === 43) next = fillAdditional(next, input);
  if (slide === 44) next = replaceExact(next, '<<Insert volume & dollars>>', shown(agencyRates(input)));
  if (slide === 49) next = fillCloser(next, input);
  if (slide === 50) next = fillClosingFigures(next, input);
  const observationSlide = OBSERVATION_SLIDES[slide];
  if (observationSlide) {
    const detail = slide === 6 ? addressDetail(input) : findDetail(input, observationSlide);
    next = replaceExact(next, 'Insert Observations and/or proposals', observation(detail));
  }
  return cleanLabels(next);
}
