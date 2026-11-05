import { describe, expect, it } from 'vitest';
import { sampleDataSource } from '../data/dataSource';
import { dashboardReducer, initialState, normalize, type DashboardAction, type DashboardState } from './dashboardState';
import { clientSession } from '../lib/auth';

const ds = sampleDataSource.load();
const reducer = dashboardReducer(ds);
const run = (...actions: DashboardAction[]) =>
  actions.reduce<DashboardState>((s, a) => reducer(s, a), normalize(initialState(ds), ds));

describe('dashboard state', () => {
  it('starts on MaineHealth, Executive Summary, all months', () => {
    const s = run();
    expect(s.clientKey).toBe('maine');
    expect(s.view).toBe('exec');
    expect(s.range).toEqual({ fI: 0, tI: 20 });
  });

  it('presentation mode leaves internal views for Executive Summary', () => {
    expect(run({ type: 'setView', view: 'opps' }, { type: 'setPresent', present: true }).view).toBe('exec');
    expect(run({ type: 'setView', view: 'portfolio' }, { type: 'setPresent', present: true }).view).toBe('exec');
  });

  it('falls back to Executive Summary when the client has no such view', () => {
    expect(run({ type: 'setView', view: 'seg' }, { type: 'selectClient', key: 'washu' }).view).toBe('exec');
  });

  it('turning on the dialer jumps to Dialer Performance', () => {
    expect(run({ type: 'setProfileFlag', flag: 'dialer', value: true }).view).toBe('dialer');
  });

  it('profile toggles are kept per client', () => {
    const s = run({ type: 'setProfileFlag', flag: 'agency', value: true }, { type: 'selectClient', key: 'washu' });
    expect(s.profiles.maine.agency).toBe(true);
    expect(ds.clients.maine.agency).toBe(false);
  });

  it('turning off eInsights resets the Medicaid source to All', () => {
    const s = run({ type: 'selectClient', key: 'washu' }, { type: 'setMedSrc', src: 'ein' }, { type: 'setProfileFlag', flag: 'ein', value: false });
    expect(s.medSrc).toBe('all');
  });

  it('opening a workflow detail selects its scrub trend', () => {
    expect(run({ type: 'openDetail', key: 'bk' }).scrub).toBe('bk');
    expect(run({ type: 'openDetail', key: 'av' }).scrub).toBe('piv');
  });

  it('hidden workflow details fall back to Workflow Results', () => {
    expect(run({ type: 'openDetail', key: 'pfc' }, { type: 'setProfileFlag', flag: 'pfc', value: false }).view).toBe('ops');
  });

  it('Trending drops the PIV scrub tab when PFC is off', () => {
    const s = run({ type: 'openTrending', scrub: 'piv' }, { type: 'setProfileFlag', flag: 'pfc', value: false });
    expect(s.scrub).toBe('rm');
  });

  it('a client session cannot leave that organization or open the consultant view', () => {
    const start = normalize(initialState(ds, clientSession(ds.clients, 'maine')!), ds);
    const s = (
      [
        { type: 'selectClient', key: 'washu' },
        { type: 'setPresent', present: false },
        { type: 'setProfileFlag', flag: 'ein', value: true },
        { type: 'setView', view: 'insights' },
      ] as DashboardAction[]
    ).reduce((st, a) => reducer(st, a), start);
    expect(s.role).toBe('client');
    expect(s.clientKey).toBe('maine');
    expect(s.present).toBe(true);
    expect(s.view).toBe('exec');
    expect(s.profiles.maine.ein).toBe(false);
  });

  it('a client can turn on agency or dialer and open those results', () => {
    const start = normalize(initialState(ds, clientSession(ds.clients, 'maine')!), ds);
    const dialer = reducer(start, { type: 'setProfileFlag', flag: 'dialer', value: true });
    expect(dialer.profiles.maine.dialer).toBe(true);
    expect(dialer.view).toBe('dialer');
    const agency = reducer(start, { type: 'setProfileFlag', flag: 'agency', value: true });
    expect(agency.profiles.maine.agency).toBe(true);
    expect(agency.view).toBe('agency');
    expect(reducer(dialer, { type: 'setProfileFlag', flag: 'pfc', value: false }).profiles.maine.pfc).toBe(true);
  });

  it('custom month pickers keep from ≤ to and switch the preset to Custom', () => {
    const s = run({ type: 'setTo', index: 4 }, { type: 'setFrom', index: 8 });
    expect(s.range).toEqual({ fI: 8, tI: 8 });
    expect(s.preset).toBe('custom');
    expect(run({ type: 'setFrom', index: 10 }, { type: 'setTo', index: 2 }).range).toEqual({ fI: 2, tI: 2 });
  });
});
