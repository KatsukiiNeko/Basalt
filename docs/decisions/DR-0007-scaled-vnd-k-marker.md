# DR-0007: Scaled VND renders full digit grouping (revised; K marker reverted)

- **Date:** 2026-09-10
- **Status:** Accepted
- **Scope:** `src/utils/currency.js`, Settings currency section, onboarding wizard

## Context

Pre-V2 scaled mode multiplied by 1000 at render: a stored `1250` displayed
as `1.250.000 VND`. That output is character-for-character what exact mode
produces for a stored `1250000` — two different stored values, one visual.
Users who entered amounts in thousands read the result as plain đồng; this
ambiguity is the audit's most damaging UX finding and the reason the
display-mode choice exists at all.

## Decision

Scaled mode renders the stored thousands multiplied to full đồng:
`1250 → "1.250.000 VND"`. Exact mode: `1250000 → "1.250.000 VND"`.

**Revision (2026-09-10):** the K-marker variant shipped first, but the
product owner preferred full `000` digit grouping over abbreviated
notation. The ambiguity the marker solved is instead handled by the
explicit onboarding choice and the Settings section's descriptions/live
example, which state the unit in words. K-marker history is preserved
below for traceability.

Display-only, per DR-0003: stored values, backups, and all aggregation
paths are untouched. A user switching modes sees a different **view** of
the same stored number, never a migration.

## Settings

The bare USD/VND flag toggle is replaced by a full Currency & Display
section: currency choice, Full-VND/Thousand-VND format choice, and a
live-updating example that re-renders as the user changes modes. The same
visual language as the onboarding wizard so first-run choice and later
adjustment read as one continuous setting.

## Consequences

- Legacy scaled users see smaller numbers with a K suffix after update —
  an intentional, visible change that states the unit, consistent with the
  brief's example ("1,250 thousand ₫").
- `formatMoney` tests pin the exact strings for all three mode/currency
  combinations.
