/**
 * Sample sign-in for this mockup. It is not production authentication:
 * the accounts and the shared password live in the page so a reviewer can open a client or consultant view.
 * Nothing here is checked against a directory, and no client system is contacted.
 */
export type Role = 'client' | 'consultant';

export interface Session {
  role: Role;
  /** The one client a client session may open. Null for a consultant. */
  clientKey: string | null;
  label: string;
}

export const SAMPLE_PASSWORD = 'roi';

const STORAGE_KEY = 'co-roi-session';

/** True when the password matches the sample password. The same password opens every sample account. */
export function passwordMatches(password: string) {
  return password === SAMPLE_PASSWORD;
}

/** Spellings that should still open the right organization. */
const LOGIN_ALIASES: Record<string, string> = {
  oschner: 'ochsner',
  stlukes: 'saintlukes',
  saintluke: 'saintlukes',
  mainehealth: 'maine',
  washingtonuniversity: 'washu',
};

/** Letters and digits only, so "Saint Luke's" and "saintlukes" are the same login. */
export function normalizeLogin(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The sample organization for a typed login name, or null when it is not one of the sample accounts. */
export function matchClientKey(clients: Record<string, { name: string }>, login: string): string | null {
  const normalized = normalizeLogin(login);
  if (!normalized) return null;
  const alias = LOGIN_ALIASES[normalized];
  if (alias && clients[alias]) return alias;
  for (const [key, client] of Object.entries(clients)) {
    if (normalizeLogin(key) === normalized || normalizeLogin(client.name) === normalized) return key;
  }
  return null;
}

export function clientSession(clients: Record<string, { name: string }>, clientKey: string): Session | null {
  if (!clients[clientKey]) return null;
  return { role: 'client', clientKey, label: clients[clientKey].name };
}

export function clientSessionByLogin(clients: Record<string, { name: string }>, login: string): Session | null {
  const key = matchClientKey(clients, login);
  if (!key) return null;
  return clientSession(clients, key);
}

export function consultantSession(): Session {
  return { role: 'consultant', clientKey: null, label: 'Consultant' };
}

export function loadSession(knownClients: readonly string[]): Session | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (parsed.role === 'consultant') return consultantSession();
    if (parsed.role === 'client' && typeof parsed.clientKey === 'string' && knownClients.includes(parsed.clientKey)) {
      return { role: 'client', clientKey: parsed.clientKey, label: typeof parsed.label === 'string' ? parsed.label : parsed.clientKey };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}
