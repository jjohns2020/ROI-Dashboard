import { DATE_PRESETS, type DatePreset } from '../../lib/dateRange';
import { useDashboard } from '../../state/DashboardContext';

export function Header() {
  const { ds, state, dispatch, calendar, client } = useDashboard();
  return (
    <header>
      <div>
        <h1>Collections Optimization · ROI Dashboard</h1>
        <div className="sub">{state.role === 'client' ? `Experian Health · ${client.name}` : 'Experian Health · Internal use only'}</div>
      </div>
      <span className="mock">MOCKUP</span>
      <div className="spacer"></div>
      {state.role === 'client' ? (
        <>
          <span className="sub">Client</span>
          <span id="clientName">{client.name}</span>
        </>
      ) : (
        <>
          <label htmlFor="client" className="sub">
            Client
          </label>
          <select
            id="client"
            value={state.clientKey}
            disabled={state.present}
            onChange={(e) => dispatch({ type: 'selectClient', key: e.target.value })}
          >
            {Object.entries(ds.clients).map(([k, c]) => (
              <option key={k} value={k}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="sub" htmlFor="preset">
        Dates
      </label>
      <select id="preset" value={state.preset} onChange={(e) => dispatch({ type: 'setPreset', preset: e.target.value as DatePreset })}>
        {DATE_PRESETS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select
        id="fromM"
        aria-label="From month"
        value={String(state.range.fI)}
        onChange={(e) => dispatch({ type: 'setFrom', index: Number(e.target.value) })}
      >
        {calendar.map((m, i) => (
          <option key={i} value={i}>
            {m}
          </option>
        ))}
      </select>
      <span className="sub">to</span>
      <select
        id="toM"
        aria-label="To month"
        value={String(state.range.tI)}
        onChange={(e) => dispatch({ type: 'setTo', index: Number(e.target.value) })}
      >
        {calendar.map((m, i) => (
          <option key={i} value={i}>
            {m}
          </option>
        ))}
      </select>
      {state.role === 'consultant' && (
        <label
          className="sub"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.15)', padding: '6px 10px', borderRadius: 6 }}
        >
          <input type="checkbox" id="present" checked={state.present} onChange={(e) => dispatch({ type: 'setPresent', present: e.target.checked })} />{' '}
          Client presentation mode
        </label>
      )}
      {state.role === 'consultant' && (
        <button className="btn primary" id="exportBtn" type="button" onClick={() => dispatch({ type: 'openExport' })}>
          Export to PowerPoint
        </button>
      )}
    </header>
  );
}
