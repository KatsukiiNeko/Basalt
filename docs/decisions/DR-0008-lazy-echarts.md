# DR-0008: ECharts is a lazy-loaded chunk

- **Date:** 2026-09-10
- **Status:** Accepted
- **Scope:** `src/components/Dashboard.jsx`, `public/sw.js`, `vite.config.js`

## Context

The single production chunk was 973 KB (gzip 314 KB); ECharts was ~60% of
it and is needed only by the dashboard's chart panel, below the fold.

## Decision

`ChartsSection` is imported via `React.lazy` and wrapped in `Suspense` with
a skeleton fallback. Initial payload drops to 401 KB (gzip 121 KB). The
chart chunk streams in on dashboard mount.

The service-worker precache manifest deliberately does NOT include the
chunk (hashed filenames churn every deploy); the existing network-first
fetch handler caches it after first load, so offline behavior after one
visit is unchanged.

## Chart instance lifecycle

The pre-V2 `useECharts` disposed and re-initialised the chart on every
option change. It now creates the instance once per mount and applies
options via `setOption`. Consumer event handlers (the doughnut's
hover/click center-label) live in `useCallback` closures over data, so a
dedicated effect re-binds them when the callback identity changes —
`off()` first, because ECharts stacks listeners rather than replacing
them. Without the re-bind, instance reuse would have left the center
label reading mount-time data.

## Consequences

- SW `CACHE_NAME` bumped to v6 so installed clients pick up the split.
- Unlock → vault critical path no longer pays the ECharts download.
- The chunk-size warning is gone from build output.
