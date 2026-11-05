/**
 * Client-profile and presentation-mode visibility rules.
 * Internal-only views and content must never surface in presentation mode or a client export.
 */
import type { Client, Insight, WorkflowDetail, WorkflowKey } from '../data/types';

export type ViewKey =
  | 'exec'
  | 'roi'
  | 'ops'
  | 'cash'
  | 'trend'
  | 'seg'
  | 'agency'
  | 'dialer'
  | 'insights'
  | 'recs'
  | 'opps'
  | 'checks'
  | 'portfolio';

/** A view key, or `d_<workflow>` for a workflow detail page. */
export type ViewId = ViewKey | `d_${WorkflowKey}`;

export const INTERNAL_VIEWS: ViewKey[] = ['portfolio', 'opps', 'checks'];

export interface NavItem {
  key: ViewKey;
  label: string;
  tag?: 'Agency' | 'Dialer' | 'Internal only';
}

export function navItems(c: Client, present: boolean, options?: { insights?: boolean }): NavItem[] {
  const v: NavItem[] = [
    { key: 'exec', label: 'Executive Summary' },
    { key: 'roi', label: 'ROI Detail' },
    { key: 'ops', label: 'Workflow Results' },
    { key: 'cash', label: 'Cash Impact' },
    { key: 'trend', label: 'Trending' },
  ];
  if (c.seg) v.push({ key: 'seg', label: 'Segmentation' });
  if (c.agency) v.push({ key: 'agency', label: 'Agency Performance', tag: 'Agency' });
  if (c.dialer) v.push({ key: 'dialer', label: 'Dialer Performance', tag: 'Dialer' });
  if (options?.insights !== false) v.push({ key: 'insights', label: 'Analyst Insights' });
  v.push({ key: 'recs', label: 'Success Plan' });
  if (!present) {
    v.push({ key: 'opps', label: 'Opportunities', tag: 'Internal only' });
    v.push({ key: 'checks', label: 'Data Checks', tag: 'Internal only' });
    v.push({ key: 'portfolio', label: 'Portfolio', tag: 'Internal only' });
  }
  return v;
}

const PFC_KEYS: string[] = ['pfc', 'av'];
const PFC_AREAS: string[] = ['pfc', 'av'];

export const usesPfc = (c: Pick<Client, 'pfc'>) => c.pfc !== false;
export const usesEin = (c: Pick<Client, 'ein'>) => c.ein === true;

export function visibleDetails(
  details: Partial<Record<WorkflowKey, WorkflowDetail>>,
  c: Pick<Client, 'pfc'>,
): Partial<Record<WorkflowKey, WorkflowDetail>> {
  return Object.fromEntries(Object.entries(details).filter(([k]) => usesPfc(c) || !PFC_KEYS.includes(k)));
}

export const visibleInsights = (insights: Insight[] | undefined, c: Pick<Client, 'pfc'>) =>
  (insights || []).filter((i) => usesPfc(c) || !PFC_AREAS.includes(i.area));

export const visibleScrubs = (c: Pick<Client, 'pfc' | 'scrubs'>) =>
  c.scrubs.filter((r) => c.pfc !== false || !/^(Patient Financial Clearance|PFC)/.test(r[0]));

/** Insights allowed on screen: client-facing only in presentation mode. */
export const audienceFilter = (present: boolean) => (i: Insight) => !present || i.aud === 'client';
