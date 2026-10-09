# DR-0009: Multi-sheet .xlsx export (browser-only, offline)

- **Date:** 2026-10-09
- **Status:** Accepted
- **Scope:** `src/services/exportWorkbook.js`, `src/services/exportService.js`,
  `src/components/{Dashboard,SettingsPanel,BackupRestore}.jsx`,
  `src/i18n/translations.js`, `index.html`, `public/_headers`, `public/sw.js`,
  `vite.config.js`

## Context

Backups are JSON blobs that only this app can read. Users asked for a
spreadsheet export they can open in Excel/Sheets — built entirely in the
browser (zero network, `connect-src 'none'`), usable offline on first try,
and without touching the encrypted Dexie schema.

## Decision

**Library: `write-excel-file@4.1.1`** (exact pin, only runtime dep added:
`fflate`). Chosen over SheetJS on npm (0.18.5, stale + CVEs), ExcelJS
(node-centric, heavy) and hand-rolled OOXML. `fflate@0.8.3` is a devDep for
round-tripping generated files in tests (`unzipSync`).

**Workbook format.** Four sheets — Summary, Transactions, Accounts,
Categories (last one only when observed data exists). Frozen header row on
every sheet (`stickyRowsCount`), autofilter on the three data sheets via a
custom feature that injects `<autoFilter/>` after `</sheetData>` (the `insert`
hook appends after `<drawing/>`, which is the wrong OOXML sibling order).
True date cells are built as `Date.UTC(y, m-1, d)` so the library's
`getTime()/day + 25569` serial is an exact integer in every timezone — a
local-midnight Date day-shifts for anyone east of UTC. Amounts are signed
(income +, expense −), VND always full-VND `#,##0` with display-mode scaling
applied at export (DR-0003), USD `#,##0.00`; a single global currency means
no cross-currency sums are possible. Text is stripped of control characters
and truncated to 32,767; nulls become empty cells; Summary totals come from
`computeSummary`/`aggregateMonthlyTrend` so the file matches the dashboard.
Core metadata (`dc:title = "Basalt Export"`, `dc:creator = "Basalt"`) is
written as `docProps/core.xml` through the feature API — the library has no
docProps generator.

**CSP: `worker-src 'self' blob:`** added to `index.html` and
`public/_headers`. fflate's async zip spawns a Blob-URL `Worker` for parts
≥160 KB uncompressed (i.e. any export beyond a few hundred rows). Without
the directive, `worker-src` falls back to `script-src 'self'` and large
exports would hang; `connect-src 'none'` still holds, so zero network is
preserved.

**Chunking: three stable URLs, precached.** Unlike DR-0008's chart chunk
(hashed, self-caches after one visit), the export must work offline on
*first* use, so `vite.config.js` `chunkFileNames` pins
`assets/export-xlsx.js` (entry), `assets/export-xlsx-writer.js`
(write-excel-file + fflate, 71 KB / gzip 19 KB) and `assets/chartData.js`
(shared with ChartsSection), and `public/sw.js` (`CACHE_NAME` v7) precaches
all three. Those names must stay in sync with the SW manifest — a mismatch
fails SW install, so bump `CACHE_NAME` whenever they change.

## Consequences

- Export adds 78 KB raw / 23 KB gzip to the first export only; unlock path
  unaffected (entry chunk is 5.9 KB).
- UI gains an "Export, Excel (.xlsx)" button beside the backup controls with
  spinner/disabled states, `role="status"`/`role="alert"` feedback, and a
  visible "not encrypted" privacy notice; EN + VI strings.
- `.xlsx` core properties have no `quotePrefix` support in this library —
  string cells are typed (`t="s"`) but not quote-prefixed.
- File naming uses the **local** date (`Basalt_YYYY-MM-DD.xlsx`), diverging
  from backup filenames which use the UTC date.
