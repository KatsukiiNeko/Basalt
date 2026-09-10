# DR-0006: Unlock uses the same lockout engine as backup restore

- **Date:** 2026-09-10
- **Status:** Accepted
- **Scope:** `src/components/LockScreen.jsx`, `src/utils/lockout.js`

## Context

The app had two parallel brute-force protection systems. Backup restore and
password change used `utils/lockout.js` (triple-store mirroring, tier
lockouts, 20-attempt session cap, proof-of-work, tested — 27 tests). The
**most exposed surface**, password unlock, ran a weaker inline system inside
LockScreen: its own tier table, no session cap, no PoW, zero tests.

## Decision

LockScreen gates attempts through the same pwd-lockout functions. Legacy
unlock state (`mv_cumulative_attempts` in localStorage,
`lockoutData:<id>` in IDB) is folded into reads by **taking the maximum**
(across all stores) so a returning user's accumulated failures gate their
first V2 attempt — history is never reset. The first successful unlock or
failure-write clears the legacy keys so counts are never double-tracked.

## Deliberate non-change: no escalated PBKDF2 at unlock verification

Verification always derives at the vault's stored iteration count. The
stored verification token can only be decrypted by the exact key that
created it; deriving at an escalated count would reject correct passwords
after failures — a lockout of the legitimate user. Attackers pay through
tier lockouts, the session cap, and PoW instead. (Escalated iterations
remain in the **backup-restore** path, where the backup records its own
iteration count and wrong-password rejection is the intended outcome.)

## Consequences

- One engine, one test suite, one set of tiers everywhere.
- `recordPwdSuccessfulAttempt`/`recordPwdFailedAttempt` clear legacy stores;
  the merge is read-time only, so it self-retires as legacy keys vanish.
- Corrupted legacy JSON degrades to empty (fail-open on *reads* only makes
  the account no less protected than the new stores alone), never blocks
  an unlock.
