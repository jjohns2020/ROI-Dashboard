# Collections Optimization · ROI Dashboard

React + TypeScript (Vite) build of the CO ROI Dashboard. The single-file prototype
`CO_ROI_Dashboard_Mockup (1).html` remains in the repo as the source of truth for design and business logic.

All data is **sample data** from the prototype. Values labelled *illustrative* / *sample* in the UI are not validated
production data. No production systems, Microsoft 365, APIs, databases or client data are connected.

## Run

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm test           # unit tests for ROI logic, visibility rules, data checks, export plan, state rules
npm run parity     # after build: compares the app against the prototype in headless Chrome
```

`npm run parity` drives the prototype and the built app through the same clicks (every client, date preset,
custom ranges, presentation mode, profile toggle, view, workflow detail and in-page toggle) and diffs visible text,
SVG chart geometry and computed styles after each step. Set `CHROME_PATH` if Chrome is not at `/usr/local/bin/google-chrome`.

## Structure

```
src/
  data/
    types.ts            Dataset shape the whole UI reads
    dataSource.ts       DataSource seam; sampleDataSource loads the prototype's sample data
    sample/             clients, monthly trend, scrub trends, workflow slides, insights, opportunities, …
  lib/                  Pure business logic (no React)
    roi.ts              ROI ratio, total value, % change, annualizing, Medicaid attribution, Return Mail guarantor scaling
    dateRange.ts        Presets, range label, truncation of monthly series, rolling averages
    visibility.ts       Nav per client profile, internal-only views, PFC filtering, insight audience
    dataChecks.ts       Pre-export checklist and overall status
    exportPlan.ts       PowerPoint slide list and export gate
    medicaid.ts         Medicaid detail re-stated by delivery source
    format.ts           Number / currency / percent formatting
  state/
    dashboardState.ts   Reducer + normalization (presentation-mode and profile fallbacks)
    DashboardContext.tsx
  components/           Layout (header, sidebar), charts (SVG), shared widgets, scrub trends, export modal
  views/                One component per page; views/internal/ holds Opportunity Sizing, Data Checks, Portfolio
  styles/global.css     Prototype CSS, unchanged
```

## Sign-in

The app opens on a sample sign-in. It is not connected to a directory. The sample password for every account is `roi`.

- **Client** — type a login name (`maine`, `washu`, `novant`, `banner`, `saintlukes`, `rush`, or `ochsner`; `oschner` also opens Ochsner). That session shows only that organization's dashboard. Analyst Insights, the insight notes on other pages, downloads, other clients, Opportunity Sizing, Data Checks, and Portfolio stay hidden. The client can turn on collection agencies or a dialer to add those results. MaineHealth and WashU keep their workbook ROI figures; Oct–Dec 2025 and the other five organizations are illustrative sample data.
- **Consultant** — every client dashboard, the client switcher, and the internal pages and notes. Presentation mode still previews the client view.

Log out is in the header and at the bottom of the view list. Either one returns to the sign-in screen. The choice is remembered for the browser tab until then.

## Internal vs client-facing

- Opportunity Sizing, Data Checks and Portfolio are internal only: hidden from navigation in presentation mode and
  never listed in the export.
- Presentation mode also hides the client profile panel, locks the client selector, and removes internal insights,
  data-load tables, source notes, data flags and illustrative-split labels that the prototype marks as internal.

## PowerPoint export

Export to PowerPoint downloads a copy of `Utilization Review Template_2025.pptx` with this client's name, period, ROI, and recommendations written in. Slides for workflows the profile does not use are removed, along with the consultant instruction slide and slides that still contain another example's dollar figures. Portfolio, Opportunity Sizing, Data Checks, other clients, and internal notes are not added. Illustrative sample figures keep that label. Data Checks status NOT READY (a FIX item) disables the download; REVIEW does not. The file is filled in the browser from the template. No Microsoft 365 connection is used.

The Executive Highlights page has its own download: a Word document (`.docx`) with the headline figures, value sources, analyst highlights, and executive message. It is not a slide in the PowerPoint. The same file can be downloaded from the export dialog. Internal notes are left out, and NOT READY disables it the same way.

## Connecting real data later

Implement `DataSource` (see `src/data/dataSource.ts`) to return a `Dataset` and pass it to `<App dataSource={…} />`.
Views and business logic only read the `Dataset` shape.
