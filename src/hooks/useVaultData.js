import { useEffect, useState } from 'react';
import { loadAllDecrypted } from '../services/transactions';
import { SessionExpiredError } from '../services/errors';

// Our single decrypt pass for the whole dashboard.
//
// Dashboard calls this once per (accountId, refreshKey); every child —
// History, Forecast, ChartsSection — reads the transactions it returns
// instead of decrypting on its own. That's deliberate: before this hook
// each panel ran its own full-table decrypt, so one save meant three
// identical passes over the vault. Bumping refreshKey (after any add /
// edit / delete) is how we tell everyone to re-read.
//
// loadAllDecrypted gives us plain records plus a skippedCount — rows whose
// ciphertext failed to decrypt. We surface that count rather than dropping
// it silently, so the UI can warn instead of showing a quietly shorter list.
//
// Two states this can land in, and the caller has to branch on both:
//   'ready'  — transactions + skippedCount are populated.
//   'error'  — errorCode tells the UI what to say. 'session-expired' means
//              the in-memory key is gone (lock/timeout), so offer re-unlock;
//              anything else is a real load failure.
// 'loading' is the initial state before the effect resolves.
//
// The `cancelled` flag is the standard abort-on-dep-change guard: if
// accountId or refreshKey changes while the decrypt is in flight, the stale
// response must not overwrite the fresh one. Without it you get the classic
// flicker where an older account's data paints over the newer selection.
export function useVaultData(accountId, refreshKey) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { transactions, skippedCount } = await loadAllDecrypted(accountId);
        if (!cancelled) {
          setState({ status: 'ready', transactions, skippedCount });
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          errorCode: err instanceof SessionExpiredError ? 'session-expired' : 'load-failed',
        });
      }
    })();

    return () => { cancelled = true; };
  }, [accountId, refreshKey]);

  return state;
}
