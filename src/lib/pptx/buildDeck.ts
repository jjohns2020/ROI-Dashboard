/**
 * Client ROI PowerPoint.
 *
 * The downloaded file is `Utilization Review Template_2025.pptx` with this client's
 * name, the selected dates, workflow coverage, ROI, and recommendations written into it.
 * Chart series use the dashboard for that date range. Example figures and the template's
 * external workbook link are removed.
 * Internal pages and other clients are not added.
 */
import type { Client, Insight, MedicaidSplit, MonthlySeries, ScrubData, WorkflowDetail, WorkflowKey } from '../../data/types';
import type { MonthRange } from '../dateRange';
import { medicaidDetail } from '../medicaid';
import type { MedicaidSource, ReturnMailLevel } from '../roi';
import { fillReviewTemplate } from './fillTemplate';

export interface DeckInput {
  client: Client;
  range: MonthRange;
  rangeLabel: string;
  monthly: MonthlySeries;
  /** Profile-filtered workflow slides, with the Medicaid source split already applied. */
  details: WorkflowDetail[];
  /** Profile-filtered insights. Internal-audience items are dropped while building the file. */
  insights: Insight[];
  scrub: ScrubData;
  medSrc: MedicaidSource;
  /** Multiplier applied to Medicaid coverage on the dashboard. Defaults to 1. */
  medCovFactor?: number;
  usesEin: boolean;
  rmLevel: ReturnMailLevel;
  guarRatio: number;
}

/** Workflow slides in deck order, with Medicaid figures restated for the selected delivery source. */
export function presentationDetails(
  details: Partial<Record<WorkflowKey, WorkflowDetail>>,
  medSplit: MedicaidSplit | undefined,
  ein: boolean,
  medSrc: MedicaidSource,
  medF: (kind: 'cov' | 'pay') => number,
): WorkflowDetail[] {
  return Object.entries(details)
    .filter((entry): entry is [string, WorkflowDetail] => !!entry[1])
    .map(([k, d]) => (k === 'mc' ? medicaidDetail(d, medSplit, ein, medSrc, medF) : d));
}

export function buildClientDeck(input: DeckInput) {
  const ready = fillReviewTemplate(input);
  return {
    async write(_options?: { outputType?: string }) {
      return ready;
    },
    async writeFile({ fileName }: { fileName: string }) {
      const bytes = await ready;
      if (typeof window === 'undefined') {
        const { writeFileSync } = await import(/* @vite-ignore */ 'node:fs');
        writeFileSync(fileName, bytes);
        return fileName;
      }
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
      }, 1000);
      return fileName;
    },
  };
}
