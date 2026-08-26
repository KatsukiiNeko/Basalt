# DR-0004: Beta-feature finding is stale; dead code removed after reference verification

**Status:** Accepted
**Date:** 2026-08-25
**Scope:** `src/crypto/backupService.js`, `src/crypto/crypto.js`, `src/utils/currency.js`, audit backlog

## Context

The V2 audit (§2, §9) claimed "existing beta functionality may no longer match
the repository's actual architecture" and §28 required a production-cleanup
sweep. The Reasoning Protocol (§0) requires verifying both against the actual
repository before acting.

## Evidence

Beta finding — **stale**:

- `grep -ri 'beta|experimental|coming soon'` over `src/` and `README.md`: zero hits.
- No TODO/FIXME/deprecated markers anywhere in `src/`.
- `git log --all --grep='beta'`: no commits.
- The v6.0.0 overhaul (`e9279a5`) already removed the last experimental UI
  (sunburst chart files); `grep -rn sunburst src/` is empty.

There is no beta feature to investigate. The finding described a repository
state that no longer exists.

Production-cleanup sweep — three verified-dead artifacts found:

1. `exportTransactionsCSV()` in `backupService.js` — its only UI caller was
   removed in commit `e196eeb` ("Remove export CSV from SettingsPanel").
   Repo-wide grep finds no remaining callers or references. It also violated
   two brief rules on its way out: silent `catch {}` around per-row decryption
   (§13) and DOM download-triggering inside a service (§10's named example).
2. crypto.js default-export barrel + its supporting import block — a
   compatibility shim left over from the Phase 4 module split. Every consumer
   imports named exports directly; zero `import crypto from './crypto'`
   usages repo-wide.
3. `CURRENCIES` / `VND_DISPLAY_MODES` constants in `currency.js` — exported
   but never imported. OnboardingOverlay keeps its own labeled lists (it needs
   i18n label keys, which plain arrays can't carry).

## Decision

Remove all three. Do not invent a beta-flag mechanism for a feature that does
not exist.

## Alternatives rejected

- **Keep the barrel "just in case"** — dead compatibility shims mislead the
  next reader about which API surface is real. Git history preserves it.
- **Move `CURRENCIES` into OnboardingOverlay's import** — the overlay needs
  display labels bound to each option; a bare string array adds nothing.

## Consequences

- Smaller bundle, one less silent-catch site, services no longer touch the DOM.
- Anyone needing CSV export later must rebuild it at the UI layer per §10
  (service returns data, component triggers the download).

## Risk

None identified: all three symbols have zero references in `src/` or `tests/`,
verified by grep immediately before deletion. Full build + test suite re-run
after removal as regression proof.
