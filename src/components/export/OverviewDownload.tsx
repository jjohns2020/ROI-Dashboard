import { useState, type CSSProperties } from 'react';
import { overallStatus, runChecks } from '../../lib/dataChecks';
import { saveExecutiveOverview } from '../../lib/docx/executiveOverview';
import { canExport } from '../../lib/exportPlan';
import { useDashboard } from '../../state/DashboardContext';

/**
 * Downloads the Executive Highlights as a Word document.
 * Separate from the Utilization Review PowerPoint. Hidden from the parity snapshot
 * when rendered inside #overviewExport.
 */
export function OverviewDownload({ id, className, label, style }: { id?: string; className?: string; label?: string; style?: CSSProperties }) {
  const { ds, state, client, insights, rangeLabel } = useDashboard();
  const blocked = !canExport(overallStatus(runChecks(state.clientKey, client, ds)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    if (blocked || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveExecutiveOverview({
        client,
        range: state.range,
        rangeLabel,
        insights: state.role === 'client' ? [] : insights,
      });
      setMessage('Downloaded ' + saved.fileName + '.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The overview could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span id={id}>
      <button className={className ?? 'btn primary'} type="button" style={style} disabled={blocked || busy} onClick={() => void download()}>
        {busy ? 'Building…' : (label ?? 'Download executive overview')}
      </button>
      {message && (
        <span className="note" style={{ marginInlineStart: 8 }}>
          {message}
        </span>
      )}
    </span>
  );
}
