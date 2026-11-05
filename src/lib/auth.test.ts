import { describe, expect, it } from 'vitest';
import { clientSession, consultantSession, passwordMatches, SAMPLE_PASSWORD } from './auth';

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
});
