import { describe, expect, it } from 'vitest';
import { clientSession, clientSessionByLogin, consultantSession, matchClientKey, passwordMatches, SAMPLE_PASSWORD } from './auth';

const clients = { maine: { name: 'MaineHealth' }, washu: { name: 'WashU' } };

describe('sample sign-in', () => {
  it('uses one sample password for every account', () => {
    expect(passwordMatches(SAMPLE_PASSWORD)).toBe(true);
    expect(passwordMatches('nope')).toBe(false);
  });

  it('opens a client session only for a known organization', () => {
    expect(clientSession(clients, 'maine')).toEqual({ role: 'client', clientKey: 'maine', label: 'MaineHealth' });
    expect(clientSession(clients, 'other')).toBeNull();
  });

  it('opens a consultant session with no client lock', () => {
    expect(consultantSession()).toEqual({ role: 'consultant', clientKey: null, label: 'Consultant' });
  });

  it('matches a typed login name, including the Oschner spelling', () => {
    const named = { ...clients, saintlukes: { name: "Saint Luke's" }, ochsner: { name: 'Ochsner' } };
    expect(matchClientKey(named, 'Saint Luke\'s')).toBe('saintlukes');
    expect(matchClientKey(named, 'oschner')).toBe('ochsner');
    expect(matchClientKey(named, 'MaineHealth')).toBe('maine');
    expect(clientSessionByLogin(named, 'oschner')).toEqual({ role: 'client', clientKey: 'ochsner', label: 'Ochsner' });
    expect(clientSessionByLogin(named, 'nobody')).toBeNull();
  });
});
