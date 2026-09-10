import { useEffect, useState } from 'react';
import { loadAllDecrypted } from '../services/transactions';
import { SessionExpiredError } from '../services/errors';

// View-model for the decrypted vault contents. Dashboard loads once per
// (accountId, refreshKey) and every child consumes the result — the app
// performs exactly one full-table decrypt per data change instead of one
// per component.
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
