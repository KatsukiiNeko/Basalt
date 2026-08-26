# DR-0002: Constant-time comparison in verifyPassword

**Status:** Accepted
**Date:** 2026-08-25
**Scope:** `src/crypto/crypto.js` → `verifyPassword()`

## Context

`verifyPassword(key, token)` decrypts the account's verification token with a
candidate session key and checks the result against a hardcoded sentinel,
`VERIFICATION_PLAINTEXT = 'BASALT_VERIFY_v1'`, using JavaScript `===`.

String comparison in JS short-circuits on the first differing byte, so its
duration varies with the number of matching leading characters. The V1 audit
flagged this as a potential timing side channel.

## Severity assessment (honest read)

This is a **low-severity, defense-in-depth** issue, not an exploitable hole:

1. **The compared value is public.** `VERIFICATION_PLAINTEXT` ships in the
   bundle. A timing leak reveals how many bytes of a known constant matched —
   zero bits of secret information.
2. **Real authentication happens earlier.** AES-GCM verifies its auth tag
   inside `decryptData` *before* any comparison. A wrong key fails there,
   inside WebCrypto (native, non-observable timing), and `verifyPassword`
   returns `false` via the catch path. The JS-level comparison never even
   runs for wrong keys.
3. **No remote oracle exists.** Password unlock is gated by the lockout
   system (tiers, PoW, hard cap), which throttles any high-resolution timing
   enumeration attempt.

## Decision

Replace the `===` check with a constant-time comparison anyway:

```js
// Hash both sides to fixed-length digests, then XOR-fold.
async function secureConstantTimeEquals(a, b)
```

Rationale:

- Cost is negligible (one extra SHA-256 over ~20 bytes per login attempt).
- Hashing both operands hides length differences and yields fixed-size
  buffers for the XOR fold.
- It closes the audit finding permanently and removes the need for future
  reviewers to re-litigate severity each audit cycle.
- If the sentinel is ever changed to carry per-account entropy (a plausible
  V3 evolution — e.g., binding the token to the accountId), the comparison
  becomes genuinely secret-bearing and must already be timing-safe.

## Consequences

- `verifyPassword` keeps its exact signature and boolean contract; callers
  (LockScreen, AccountSelector, PasswordManager) are unaffected.
- Behavior change is unobservable except by microarchitectural measurement;
  existing tests pass unchanged.
- The helper lives beside the other primitives (`primitives.js`) so future
  secret comparisons reuse one vetted implementation.

## Alternatives rejected

- **Do nothing** — defensible given (1)–(3), but leaves the finding open and
  the fix costs almost nothing.
- **Manual byte loop over UTF-8 of both strings** — equivalent outcome but
  requires careful length-mismatch handling; hashing first is simpler and
  hides lengths.
