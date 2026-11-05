import type { ClientProfileFlags } from '../../data/types';
import { moneyFull } from '../../lib/format';
import { navItems } from '../../lib/visibility';
import { useDashboard } from '../../state/DashboardContext';

const PROFILE_TOGGLES: [keyof ClientProfileFlags, string, string][] = [
  ['pfc', 'hasPfc', 'Uses Patient Financial Clearance'],
  ['ein', 'hasEin', 'Medicaid also worked by eInsights'],
  ['agency', 'hasAgency', 'Uses collection agencies'],
  ['dialer', 'hasDialer', 'Uses a dialer'],
];

export function Sidebar() {
  const { state, dispatch, client, signOut } = useDashboard();
  const activeKey = state.view.startsWith('d_') ? 'ops' : state.view;
  return (
    <nav>
      <div
        id="presBanner"
        style={{
          display: state.present ? undefined : 'none',
          background: '#E6F7F6',
          color: '#00756E',
          fontSize: 12,
          padding: 8,
          borderRadius: 6,
          marginBottom: 8,
        }}
      >
        {state.role === 'client'
          ? `Signed in as ${client.name}. This dashboard is limited to your organization.`
          : 'Presentation mode: internal views, other clients and consultant notes are hidden.'}
      </div>
      <h3>Views</h3>
      <div id="tabs">
        {navItems(client, state.present, { insights: state.role !== 'client' }).map((x) => (
          <button
            key={x.key}
            type="button"
            className={`tab ${x.key === activeKey ? 'active' : ''}`}
            data-v={x.key}
            onClick={() => dispatch({ type: 'setView', view: x.key })}
          >
            {x.label}
            {x.tag && (
              <span className="tag" style={x.tag === 'Internal only' ? { background: '#53565A' } : undefined}>
                {x.tag === 'Internal only' ? '🔒 ' : ''}
                {x.tag}
              </span>
            )}
          </button>
        ))}
      </div>
      <div id="internalPanel" style={{ display: state.present ? 'none' : undefined }}>
        <h3>Client profile</h3>
        {PROFILE_TOGGLES.map(([flag, id, label]) => (
          <label key={flag} className="toggle">
            <input
              type="checkbox"
              id={id}
              checked={client[flag] === true}
              onChange={(e) => dispatch({ type: 'setProfileFlag', flag, value: e.target.checked })}
            />{' '}
            {label}
          </label>
        ))}
        <div className="profile" id="profile">
          <b>{client.name}</b>
          <br />
          Period: {client.period}
          <br />
          Subscription (period): {moneyFull(client.sub)}
          <br />
          Source: {client.source}
        </div>
        <p className="note">
          Toggles mimic the Uses PFC / Has Agency / Has Dialer flags on the workbook's Client Profile tab — tick one to see the extra views
          appear.
        </p>
      </div>
      <button id="signOut" className="btn" type="button" style={{ marginTop: 16, border: '1px solid #005EB8', width: '100%' }} onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}
