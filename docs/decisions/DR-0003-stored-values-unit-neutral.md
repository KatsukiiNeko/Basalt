# DR-0003: Stored amounts are unit-neutral; display scaling happens only at render time

**Status:** Accepted
**Date:** 2026-08-25
**Scope:** `src/utils/currency.js`, `src/context/CurrencyContext.jsx`, all amount-rendering call sites

## Context

The pre-V2 app displayed VND amounts in "thousands" (a stored `50` rendered as
"50,000 VND"). Users read this as plain đồng and recorded real-world amounts
under the wrong mental model — the audit's most damaging finding. The V2 brief
(§6, §7, §27) requires an explicit user choice between full-VND and
thousand-VND display while keeping stored values internally consistent.

## Decision

Stored transaction/account amounts are **unit-neutral integers**. The database
never learns what display unit the user prefers. `formatMoney(amount,
currency, vndDisplayMode)` is the single formatting authority:

- `USD` — verbatim, 2 decimals.
- `VND + 'scaled'` — legacy semantics: stored value interpreted as thousands,
  ×1000 at render ("50" → "50,000 VND").
- `VND + 'exact'` — verbatim ("1250000" → "1,250,000 VND").

The choice is captured at onboarding (OnboardingOverlay step 3, VND-only),
persisted via CurrencyContext, and changeable later from Settings.

## Invariant

A value saved as `1250000` must never become `1250` (or vice versa) in any
read/write path. Scaling exists in exactly one function and runs only for
display. Any new rendering path must go through `formatMoney`; multiplying or
dividing amounts anywhere else is a bug.

## Consequences

- Existing users' data keeps its legacy meaning under `'scaled'`; nothing
  migrates, so no data can be corrupted by the change.
- Switching display modes is lossless and reversible — it touches no rows.
- Backups store raw values, so a backup restored on a device with a different
  display mode still shows correct numbers *for that mode's convention*. This
  ambiguity predates V2 and is resolved by the explicit onboarding choice.
