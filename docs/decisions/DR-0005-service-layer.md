# DR-0005: Service layer owns all vault data access; one decrypt pass per refresh

- **Date:** 2026-09-10
- **Status:** Accepted
- **Scope:** `src/services/*`, `src/hooks/useVaultData.js`, Dashboard/History/Forecast/ChartsSection

## Context

Pre-V2, four components (Dashboard, History, Forecast, ChartsSection) each
fetched the full encrypted transactions table and decrypted every row on
their own — four complete AES-GCM passes per refreshKey/month change. All
four also imported Dexie and crypto directly, so business logic (aggregation,
re-encryption, validation) lived inside render components.

## Decision

A service layer (`src/services/`) is the only code (besides
`crypto/backupService.js`, which predates it) that touches the transactions
table:

- `transactions.js` — load/add/update/delete/summary. `loadAllDecrypted`
  returns **self-contained records** (`id` and `accountId` stamped onto the
  decrypted payload) precisely so consumers can pass them back to
  `updateTransaction` without reconstruction.
- `auth.js` — unlock, first-time setup, and ONE rekey routine
  (`rekeyVault`) shared by password change and PBKDF2 upgrade.
- `backup.js` — quick-backup create/restore; DOM download stays in the
  component per DR-0004's rule.

Dashboard loads the vault once per (accountId, refreshKey) via
`useVaultData` and passes plain records down; History/Forecast/ChartsSection
hold zero DB/crypto imports. One decrypt pass per data change instead of
four.

## Invariant added along the way

`updateTransaction` resolves the owning account when callers omit it
(History's inline editor legitimately does). A write with `accountId:
undefined` would make the row invisible to every scoped query AND every
backup while still occupying the DB — the single most dangerous silent
failure this schema allows. Pinned by `tests/transactionService.test.js`.

## Consequences

- Forecast's month re-computation is a pure `useMemo` over shared data.
- Adding a new vault-consuming screen means receiving `transactions` as a
  prop, never querying directly.
- Corrupt rows are skipped at load but **counted** (`skippedCount`), so the
  UI can warn instead of silently hiding data.
