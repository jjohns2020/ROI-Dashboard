import { useEffect, useState } from 'react';
import { overallStatus, runChecks } from '../../lib/dataChecks';
import { buildClientDeck, presentationDetails } from '../../lib/pptx/buildDeck';
import { buildSlidePlan, canExport } from '../../lib/exportPlan';
import { useDashboard } from '../../state/DashboardContext';
import { Chip } from '../common/Chip';
import { OverviewDownload } from './OverviewDownload';

/**
 * PowerPoint export. Lists the Utilization Review slides, then downloads a .pptx.
 * Internal pages and notes are not included. Illustrative figures stay labeled in the file.
 */
export function ExportModal() {
  const dash = useDashboard();
  const { ds, state, dispatch, client, details, medSplit, usesEin, medF, insights, rangeLabel, guarRatio } = dash;
  const slides = presentationDetails(details, medSplit, usesEin, state.medSrc, medF);
  const plan = buildSlidePlan(client, slides);
  const ov = overallStatus(runChecks(state.clientKey, client, ds));
  const blocked = !canExport(ov);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ url: string; fileName: string } | null>(null);
  useEffect(() => {
    if (state.exportOpen) setMessage(null);
  }, [state.exportOpen]);
  useEffect(() => {
    if (state.exportOpen || !saved) return;
    URL.revokeObjectURL(saved.url);
    setSaved(null);
  }, [state.exportOpen, saved]);

  async function download() {
    if (state.role === 'client' || blocked || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const pptx = buildClientDeck({
        client,
        range: state.range,
        rangeLabel,
        monthly: ds.monthly[state.clientKey],
        details: slides,
        insights,
        scrub: ds.scrubData[state.clientKey],
        medSrc: state.medSrc,
        medCovFactor: medF('cov'),
        usesEin,
        rmLevel: state.rmLevel,
        guarRatio,
      });
      const savedUrl = await pptx.writeFile({ fileName: plan.fileName });
      if (savedUrl.startsWith('blob:')) {
        setSaved((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return { url: savedUrl, fileName: plan.fileName };
        });
      }
      setMessage('Downloaded ' + plan.fileName + '.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The PowerPoint could not be created.');
    } finally {
      setBusy(false);
    }
  }

  if (state.role === 'client') return null;

  return (
    <div className={`modal ${state.exportOpen ? 'open' : ''}`} id="modal">
      <div className="box">
        <h3 style={{ color: 'var(--blue)', marginTop: 0 }} id="mTitle">
          {plan.fileName}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--gray)' }}>
          Download fills the Utilization Review template for the dates selected above. Period labels use that range, and the charts use the same series as the dashboard. Template example numbers are removed. The executive overview is a separate Word document, not a slide in this deck.
        </p>
        <p id="mStatus" style={{ fontSize: 13 }}>
          Data check status: <Chip status={ov} /> {ov === 'NOT READY' ? '— fix the FIX items on the Data Checks page before exporting.' : ''}
        </p>
        <ol id="mList">
          {plan.slides.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {plan.profileSlides.map((x, i) => (
            <li key={'p' + i} className="slide-add">
              {x} (added for this client's profile)
            </li>
          ))}
        </ol>
        <p className="note" id="exportNote">
          Download creates the .pptx. The Portfolio, Opportunity Sizing and Data Checks pages, other clients' data and internal notes are never included.
          Illustrative sample figures stay labeled in the file.
        </p>
        {message && (
          <p className="note" id="exportMessage">
            {message}{' '}
            {saved && (
              <a id="savePptx" href={saved.url} download={saved.fileName}>
                Save {saved.fileName}
              </a>
            )}
          </p>
        )}
        <button className="btn primary" id="downloadPptx" type="button" disabled={blocked || busy} onClick={() => void download()}>
          {busy ? 'Building…' : 'Download PowerPoint'}
        </button>{' '}
        <OverviewDownload
          id="downloadOverviewModal"
          className="btn"
          label="Download executive overview (.docx)"
          style={{ border: '1px solid #005EB8' }}
        />{' '}
        <button className="btn" id="closeModal" type="button" style={{ border: '1px solid #005EB8' }} onClick={() => dispatch({ type: 'closeExport' })}>
          Close
        </button>
      </div>
    </div>
  );
}
