# DR-0010: Design language — a cut-stone ledger room

- **Date:** 2026-11-19
- **Status:** Accepted
- **Scope:** `src/index.css`, `src/styles/{tokens,base,layout,components}.css`,
  `src/components/*.jsx`, `src/i18n/translations.js`, `index.html`,
  `public/{manifest.json,sw.js,favicon.svg}`, `public/fonts/*`,
  `tests/i18n.parity.test.js`

## Context

The app worked but looked like a generic generated dashboard: hue gradients
and coloured glows around the brand violet, 78 near-duplicate hex colours,
pill buttons, uppercase tracked labels, flag SVGs, a ✓ glyph, a split-font
hero balance, and a rainbow ECharts palette. None of it said "private,
offline, exact". This record fixes one visual direction and the token set
that enforces it, with no change to behaviour, storage, crypto, backup
format or export output.

Credit: the audit method and anti-slop rules come from the **unslop** skill
by Damir Sokolovsky ([@heydamir](https://github.com/heydamir)), used under
CC BY 4.0. The direction below is Basalt's own.

## Direction

- **Product:** a private, offline finance vault for Vietnamese students and
  young adults — a ledger you keep, not a dashboard you watch.
- **Character:** exact, sealed, unhurried.
- **World:** a cut-stone ledger room. Warm paper in light, cold stone in
  dark; hairline rules instead of cards-on-cards; figures in a mono face.
- **Moments:** the month ledger (balance, totals, closing rule) and the
  unseal screen. Everything else recedes.
- **Signature:** the closing rule — two 1 px hairlines under the month
  totals, like a ruled ledger page closed.

## Decision

**Tokens (`src/styles/tokens.css`).** One stone ramp (`--stone-0…6`), one
accent (`#814DE5`, kept as brand), three text roles (primary, secondary,
tertiary), two semantic inks (green income, rust expense) and one
violet-to-stone category ramp. Spacing is a 4 px grid; radii are 2/4/6 px,
never pills; motion is 120/180/260 ms on one ease. No gradient, glow,
text-shadow or backdrop-filter tokens survive — `--shadow-lg`,
`--shadow-glow`, `--gradient-accent` are kept only as `none`/flat aliases
for older components.

Contrast: every text role is ≥ 4.5:1 on `--bg`, `--surface` and
`--surface-raised` in both themes (checked by `/tmp/contrast.mjs`). The
tertiary role was lightened in dark and darkened in light specifically to
pass; it is never placed on `--surface-hover`, where it would fail.

**Type.** IBM Plex Sans (400/500/600) replaces DM Sans: DM Sans had no
Vietnamese coverage, Plex has complete coverage (zero missing Vietnamese
code points) with fixed-width digits. JetBrains Mono stays for every figure
so columns align. Fonts are self-hosted woff2, same-origin, precached by the
service worker (`basalt-cache-v8`); no CDN, no `data:` URLs.

**Shell.** A 56 px top bar (brand mark, account name, theme/language/settings/
switch/lock) over a 1280 px workspace: primary ledger column plus a 360 px
sticky rail holding entry and forecast. Settings is an in-shell full-width
view, not a modal. Below 1024 px the workspace becomes a flex column with an
explicit order: ledger → entry → forecast → history → charts. Panels use
`align-items: stretch` so no panel shrinks to its content.

**Screens.** Month ledger, entry form, history, forecast, charts, settings,
accounts, lock, onboarding, confirmation dialogs, error boundary — all
restyled against the same tokens. Copy rewritten in EN + VI: no exclamation
marks, no "successfully!", no joke toast; states say what happened. Flags
become an `EN / VI` text toggle. The onboarding checkmark becomes an inline
SVG. The derived transaction type becomes quiet text instead of an empty
input. Lock and account headers get the double-hairline unseal rule.

**Charts.** Same three charts, same lazy ECharts chunk (DR-0008), same
`chartData.js`. Area fills are flat, lines are unsmoothed, bars lose their
rounded corners, category colours come from the violet ramp, and the pie
drops its outside labels and duplicate legend because the adjacent
"Largest categories" list already names and colours every slice. The centre
readout is width-capped so a VND total cannot overlap the ring.

**Modals.** One `Modal` primitive on native `<dialog>`: `showModal()` gives
inert background and a real focus trap, Escape is cancellable, focus
restores on close. `ConfirmDialog` and onboarding use it; onboarding is
non-dismissible (backdrop/Escape do nothing) so setup is only skipped via
its visible Skip button.

## Consequences

- Visual only. No change under `src/crypto/` or `src/db/`; `forecast.js`,
  `currency.js`, `lockout.js`, `chartData.js` untouched; backup format and
  XLSX output unchanged; amounts stay unit-neutral integers.
- Bundle: initial JS gzip 118.9 KB (baseline 120.4 KB), charts chunk
  191.9 KB (baseline 192.4 KB, still lazy), CSS 7.2 KB (baseline 11.6 KB).
  Added font bytes are the three Plex woff2 files, replacing two DM Sans
  files.
- `package.json` dependencies are unchanged; no new runtime dependency.
- PWA: manifest/theme colours move to `#101012`; favicon is a flat
  single-accent ledger mark; SW cache version bumps because the font list
  changed.
- Known limit: the lock/account double rule uses two pseudo-elements rather
  than a reusable rule element; if a third screen needs it, extract it.
