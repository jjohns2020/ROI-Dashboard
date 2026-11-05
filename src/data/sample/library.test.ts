import { describe, expect, it } from 'vitest';
import rawMonthly from './monthly.json';
import { assembleSampleDataset } from './library';

describe('sample library', () => {
  const ds = assembleSampleDataset();

  it('keeps the workbook months and adds Oct–Dec 2025', () => {
    expect(ds.monthly.maine.months).toHaveLength(24);
    expect(ds.monthly.maine.months[0]).toBe('Jan 2024');
    expect(ds.monthly.maine.months.at(-1)).toBe('Dec 2025');
    expect(ds.monthly.maine.pay.slice(0, 21)).toEqual(rawMonthly.maine.pay);
    expect(ds.monthly.washu.rate.slice(0, 21)).toEqual(rawMonthly.washu.rate);
    expect(ds.clients.maine.quantified).toBe(485089);
    expect(ds.clients.washu.quantified).toBe(3219869);
    expect(ds.loads.maine[2].p).toBe('Jan 2024 – Dec 2025');
    expect(ds.loads.maine[2].e).toBe(23);
  });

  it('loads the five mock organizations on the same calendar', () => {
    for (const key of ['novant', 'banner', 'saintlukes', 'rush', 'ochsner']) {
      expect(ds.clients[key].name.length).toBeGreaterThan(0);
      expect(ds.monthly[key].months).toEqual(ds.monthly.maine.months);
      expect(ds.scrubData[key].rm.new).toHaveLength(24);
      expect(ds.clients[key].agencyData?.buckets).toHaveLength(4);
      expect(ds.monthly[key].dialer.attempts).toHaveLength(24);
    }
    expect(ds.clients.saintlukes.name).toBe("Saint Luke's");
    expect(ds.clients.ochsner.name).toBe('Ochsner');
    expect(ds.clients.maine.agency).toBe(false);
    expect(ds.clients.maine.agencyData).toBeTruthy();
  });
});
