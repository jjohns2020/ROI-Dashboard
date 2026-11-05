import type { Dataset } from './types';
import { assembleSampleDataset } from './sample/library';

/**
 * Seam for future real data sources (workbook uploads, Tableau extracts, etc.).
 * The dashboard only ever reads a `Dataset`; swap the implementation, not the views.
 */
export interface DataSource {
  load(): Dataset;
}

/** Development data source: workbook samples plus illustrative two-year and mock-client data. */
export const sampleDataSource: DataSource = {
  load: () => assembleSampleDataset(),
};
