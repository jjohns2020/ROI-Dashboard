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

export function clientSession(clients: Record<string, { name: string }>, clientKey: string): Session | null {
  if (!clients[clientKey]) return null;
  return { role: 'client', clientKey, label: clients[clientKey].name };
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
