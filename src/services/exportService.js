// Export application service (DR-0005): turns the decrypted vault into a
// downloadable multi-sheet .xlsx (DR-0009). The XLSX writer is imported
// as a lazy chunk (DR-0008) so it stays off the unlock critical path and
// the service worker can precache it for offline exports. Read-only with
// respect to storage: no schema change, no network — the file is built in
// memory and handed to the caller as a Blob.

import { db } from '../db/db';
import { loadAllDecrypted } from './transactions';
import { buildSheets, buildFeatures } from './exportWorkbook';

const APP_NAME = 'Basalt';

// Local date components (unlike backup filenames, which use the UTC date):
// "Basalt_2026-10-09.xlsx" must read as today for the user, not as UTC
// today, which can be yesterday or tomorrow depending on the timezone.
function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Builds the workbook and returns it with download metadata.
 * @param {{accountId: string, currency: string, vndDisplayMode?: string}} params
 * @returns {Promise<{empty: true} | {blob: Blob, filename: string, count: number, skippedCount: number}>}
 */
export async function exportWorkbook({ accountId, currency, vndDisplayMode }) {
  const { transactions, skippedCount } = await loadAllDecrypted(accountId);
  if (transactions.length === 0) return { empty: true };

  const accounts = await db.accounts.toArray();
  // Raw per-account transaction counts — accountId is a plain index, so
  // this needs no decryption and works for accounts outside the session.
  const counts = await Promise.all(
    accounts.map((account) =>
      db.transactions.where('accountId').equals(account.id).count()
    )
  );
  const accountCounts = new Map(accounts.map((account, i) => [account.id, counts[i]]));

  const now = new Date();
  const sheets = buildSheets({
    transactions,
    accounts,
    accountCounts,
    accountId,
    currency,
    vndDisplayMode,
    skippedCount,
    now,
  });

  // Lazy chunk: write-excel-file + fflate (~50 KB gzip) load only here.
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const blob = await writeXlsxFile(sheets, {
    features: buildFeatures({ title: `${APP_NAME} Export`, creator: APP_NAME, now }),
  }).toBlob();

  return {
    blob,
    filename: `${APP_NAME}_${localDate(now)}.xlsx`,
    count: transactions.length,
    skippedCount,
  };
}
