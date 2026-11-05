import { useState, type FormEvent } from 'react';
import { clientSessionByLogin, consultantSession, passwordMatches, SAMPLE_PASSWORD } from '../lib/auth';
import type { Session } from '../lib/auth';

/**
 * Sign-in landing. A client opens only that organization's dashboard.
 * A consultant opens every dashboard, including internal insights.
 */
export function Login({ clients, onSignedIn }: { clients: Record<string, { name: string }>; onSignedIn: (session: Session) => void }) {
  const loginNames = Object.keys(clients);
  const [loginName, setLoginName] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [consultantPassword, setConsultantPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function signInClient(event: FormEvent) {
    event.preventDefault();
    if (!passwordMatches(clientPassword)) {
      setError('That password does not match the sample sign-in.');
      return;
    }
    const session = clientSessionByLogin(clients, loginName);
    if (!session) {
      setError('That login name is not a sample account.');
      return;
    }
    setError(null);
    onSignedIn(session);
  }

  function signInConsultant(event: FormEvent) {
    event.preventDefault();
    if (!passwordMatches(consultantPassword)) {
      setError('That password does not match the sample sign-in.');
      return;
    }
    setError(null);
    onSignedIn(consultantSession());
  }

  return (
    <div className="login" id="login">
      <div className="panel">
        <p className="eyebrow">Experian Health</p>
        <h1>Collections Optimization</h1>
        <p className="sub">Sign in to a utilization review. This is a sample sign-in for the mockup, not a production directory.</p>
        <div className="doors">
          <form onSubmit={signInClient}>
            <h2>Client</h2>
            <p>Your organization's dashboard only. Analyst insights, other clients, and internal notes stay hidden.</p>
            <label htmlFor="loginUser">Login name</label>
            <input
              id="loginUser"
              autoComplete="username"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
            />
            <label htmlFor="loginClientPass">Password</label>
            <input id="loginClientPass" type="password" autoComplete="current-password" value={clientPassword} onChange={(e) => setClientPassword(e.target.value)} />
            <button className="btn primary" id="loginClientSubmit" type="submit">
              Sign in as client
            </button>
          </form>
          <form onSubmit={signInConsultant}>
            <h2>Consultant</h2>
            <p>Every client dashboard, plus internal insights, data checks, and opportunity sizing.</p>
            <label htmlFor="loginConsultantPass">Password</label>
            <input
              id="loginConsultantPass"
              type="password"
              autoComplete="current-password"
              value={consultantPassword}
              onChange={(e) => setConsultantPassword(e.target.value)}
            />
            <button className="btn primary" id="loginConsultantSubmit" type="submit">
              Sign in as consultant
            </button>
          </form>
        </div>
        {error && (
          <p className="error" id="loginError">
            {error}
          </p>
        )}
        <div className="accounts">
          <b>Login names:</b> {loginNames.join(', ')}
          <br />
          <b>Password:</b> {SAMPLE_PASSWORD}
          <br />
          Ochsner also accepts the login name oschner. The consultant side opens every organization.
        </div>
      </div>
    </div>
  );
}
