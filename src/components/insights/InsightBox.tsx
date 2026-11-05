import type { InsightType } from '../../data/types';
import { audienceFilter } from '../../lib/visibility';
import { useDashboard } from '../../state/DashboardContext';
import { C } from '../../theme/colors';

const TYPE_COLOR: Record<InsightType, string> = {
  Observation: C.blue,
  Risk: C.magenta,
  Opportunity: C.teal,
  'Data quality': C.orange,
};

const pill = { color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9 } as const;

/** Analyst insights for the given areas. Internal-audience items are hidden in presentation mode. */
export function InsightBox({ areas, title }: { areas: string[]; title?: string }) {
  const { insights, state } = useDashboard();
  if (state.role === 'client') return null;
  const L = insights.filter((i) => areas.includes(i.area)).filter(audienceFilter(state.present));
  if (!L.length) return null;
  return (
    <div className="card" style={{ borderInlineStart: '5px solid #662D91' }}>
      <h4 style={{ color: '#662D91' }}>{title || 'Analyst view'}</h4>
      {L.map((i, idx) => (
        <div key={idx} style={{ padding: '10px 0', borderBlockEnd: '1px solid #EEE' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...pill, background: TYPE_COLOR[i.type] }}>{i.type.toUpperCase()}</span>
            {i.aud === 'internal' && <span style={{ ...pill, background: '#53565A' }}>🔒 INTERNAL</span>}
            <b style={{ fontSize: 14 }}>{i.title}</b>
            <span className="spacer"></span>
            <span style={{ fontSize: 12, color: '#662D91', fontWeight: 600 }}>{i.metric}</span>
          </div>
          <p style={{ margin: '6px 0 2px', fontSize: 13 }}>{i.obs}</p>
          <p style={{ margin: '2px 0', fontSize: 13, color: '#53565A' }}>
            <b>So what:</b> {i.so}
          </p>
          <p style={{ margin: '2px 0', fontSize: 13, color: '#00756E' }}>
            <b>Recommendation:</b> {i.rec}
          </p>
        </div>
      ))}
    </div>
  );
}
