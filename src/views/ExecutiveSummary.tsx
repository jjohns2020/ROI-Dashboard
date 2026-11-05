import { HBar } from '../components/charts/HBar';
import { TrendLine } from '../components/charts/TrendLine';
import { VBars } from '../components/charts/VBars';
import { Kpi, KpiRow } from '../components/common/Kpi';
import { Card, Grid2, MockTag, PageHead, Takeaway } from '../components/common/Labels';
import { OverviewDownload } from '../components/export/OverviewDownload';
import { overlaps, priorYearAligned } from '../lib/dateRange';
import { money } from '../lib/format';
import { roiRatio, totalValueCreation } from '../lib/roi';
import { visibleScrubs } from '../lib/visibility';
import { useDashboard } from '../state/DashboardContext';
import { C } from '../theme/colors';

export function ExecutiveSummary() {
  const { ds, state, client: c, rangeLabel, insights } = useDashboard();
  const roi = roiRatio(c.quantified, c.sub);
  const lr = c.trend.reviews[c.trend.reviews.length - 1];
  const M = ds.monthly[state.clientKey];
  const { fI, tI } = state.range;
  const top = insights.filter((i) => i.aud === 'client').slice(0, 3);
  return (
    <>
      <PageHead title="Executive Highlights" subtitle="performance snapshot for executive and operational stakeholders" />
      <div id="overviewExport" style={{ margin: '0 0 14px' }}>
        <OverviewDownload id="downloadOverview" />
        <p className="note" style={{ marginTop: 6 }}>
          Word document of this page for delivery. It is separate from the PowerPoint review.
        </p>
      </div>
      {!overlaps(lr.s, lr.e, state.range) && (
        <div className="card" style={{ background: '#FFF6EC' }}>
          <b>Note:</b> headline ROI figures are from the {c.period} review, which falls outside the selected dates ({rangeLabel}). Trend charts
          follow the date filter.
        </div>
      )}
      <KpiRow>
        <Kpi label="Quantified Benefit" value={money(c.quantified)} note="Workbook ROI value" color={C.purple} />
        <Kpi label="Additional Value" value={money(c.additional)} note="Supporting value identified" color={C.magenta} />
        <Kpi label="Total Value Creation" value={money(totalValueCreation(c))} note="Quantified + additional" color={C.blue} />
        <Kpi label="ROI" value={roi.toFixed(1) + ' : 1'} note="Benefit vs subscription" color={C.teal} />
      </KpiRow>
      <Grid2>
        <Card title="Where the value came from">
          <HBar rows={visibleScrubs(c)} color={[C.blue, C.purple, C.magenta, C.teal, C.orange, C.gray]} fmt={money} />
        </Card>
        <Card title="Benefit vs. investment">
          <VBars cats={['Quantified benefit', 'Subscription']} series={[{ n: 'Dollars', c: C.blue, v: [c.quantified, c.sub] }]} fmt={money} />
        </Card>
      </Grid2>
      <Card
        title={
          <>
            Patient payments — {rangeLabel}{' '}
            <MockTag gray style={{ fontSize: 10, marginInlineStart: 8 }}>
              ILLUSTRATIVE
            </MockTag>
          </>
        }
      >
        <TrendLine
          cats={M.months.slice(fI, tI + 1)}
          series={[
            { n: 'Prior year', c: '#A7A9AC', v: priorYearAligned(M.pay, state.range), dash: true, nolabel: true },
            { n: 'Selected range', c: C.blue, v: M.pay.slice(fI, tI + 1), w: 3 },
          ]}
          fmt={money}
        />
        <p className="note">Full detail on the Trending page.</p>
      </Card>
      {state.role !== 'client' && top.length > 0 && (
        <div className="card" style={{ borderInlineStart: '5px solid #662D91' }}>
          <h4 style={{ color: '#662D91' }}>Analyst highlights</h4>
          {top.map((i, idx) => (
            <p key={idx} style={{ margin: '8px 0', fontSize: 13 }}>
              <b>{i.title}.</b> {i.obs}
            </p>
          ))}
          <p className="note">Full detail on the Analyst Insights page.</p>
        </div>
      )}
      <Takeaway label="Executive message:">
        For every $1 invested, {c.name} realized approximately ${roi.toFixed(2)} in measurable financial benefit during the review period.
      </Takeaway>
    </>
  );
}
