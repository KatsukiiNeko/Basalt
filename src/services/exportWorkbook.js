// Our pure builders for the multi-sheet .xlsx export (DR-0009) — this is
// where the workbook format itself lives: cell types, sanitization,
// sheet layout.
//
// No Dexie, no DOM, no network: decrypted records in, write-excel-file
// sheet specs + feature plugins out. We keep this separate from
// exportService.js so the format is unit testable without touching the
// DB or the crypto layer — tests/export.test.js drives every function
// here directly.

import { computeSummary } from './transactions';
import { aggregateMonthlyTrend } from '../utils/chartData';

// XLSX hard limit: 1,048,576 rows per sheet, header row included. We
// check against it in assertRowLimit instead of shipping a file that
// Excel refuses to open.
export const MAX_ROWS = 1048576;
// XLSX hard limit: 32,767 characters per cell — sanitizeText enforces it.
const MAX_CELL_LENGTH = 32767;
// Control characters are illegal in OOXML text nodes. write-excel-file
// strips them as well, but the export path does it explicitly — and it
// strips before truncating, so a stripped character can never hide an
// overlong tail.
// eslint-disable-next-line no-control-regex -- matching control chars is the entire point
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
// Column widths are a usability clamp, not a measurement: below 10 chars
// content is unreadable, above 50 it wastes the viewport, so clampWidth
// folds every width into [10, 50].
const MIN_WIDTH = 10;
const MAX_WIDTH = 50;
// Full-VND export (DR-0003): VND always carries zero decimals, USD keeps
// its two. The format only sets display precision — the multiply-by-1000
// scaling decision lives in makeAmountCell, not here.
const MONEY_FORMAT = { VND: '#,##0', USD: '#,##0.00' };

// null/undefined become empty cells; everything else is coerced to a
// string, stripped of control characters, and capped at MAX_CELL_LENGTH.
export function sanitizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(CONTROL_CHARS, '').slice(0, MAX_CELL_LENGTH);
}

export function clampWidth(width) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

// We turn 'YYYY-MM-DD' into a Date at UTC midnight, which
// convertDateToSerialNumber then reads as an exact integer serial in
// EVERY timezone (it divides getTime() by a day). A local-midnight Date
// would day-shift for anyone east of UTC: 00:00 UTC+7 is 17:00 UTC of
// the previous day. Malformed dates fall back to a text cell instead of
// silently becoming a different day.
export function dateCell(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date == null ? '' : String(date));
  if (match) {
    const [, y, m, d] = match;
    const value = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const valid =
      value.getUTCFullYear() === Number(y) &&
      value.getUTCMonth() === Number(m) - 1 &&
      value.getUTCDate() === Number(d);
    if (valid) return { value, type: Date };
  }
  return { value: sanitizeText(date), type: String };
}

export function assertRowLimit(rowCount) {
  if (rowCount > MAX_ROWS) {
    const error = new Error(
      `Workbook would have ${rowCount} rows; the XLSX limit is ${MAX_ROWS}.`
    );
    error.code = 'ROW_LIMIT';
    throw error;
  }
}

// Amount cell factory for the active currency, used by every money
// column and every Summary metric. Stored amounts are unit-neutral
// (DR-0003): in 'scaled' display mode the stored value means thousands,
// so the exported file multiplies by 1000 to hold full VND — exactly
// what the user reads on screen. USD is rounded to its 2 decimals; an
// unknown currency falls back to the USD format.
export function makeAmountCell(currency, vndDisplayMode) {
  const format = MONEY_FORMAT[currency] || MONEY_FORMAT.USD;
  return (amount) => {
    if (amount === null || amount === undefined) return null;
    let value = amount;
    if (currency === 'VND') {
      value = vndDisplayMode === 'exact' ? Math.round(value) : Math.round(value * 1000);
    } else {
      value = Math.round(value * 100) / 100;
    }
    return { value, type: Number, format };
  };
}

// 0-based column index -> Excel column letter ("0" -> "A", "26" -> "AA").
// We only need it for the autoFilter ref that makeSheet builds.
function colLetter(index) {
  let result = '';
  let i = index;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

function cellText(value) {
  return { value: sanitizeText(value), type: String };
}

function headerCell(value) {
  return { value: String(value), type: String, fontWeight: 'bold' };
}

function numberCell(value) {
  return { value, type: Number, format: '#,##0' };
}

// One shape for every sheet: frozen header row, clamped column widths,
// and (except the Summary's metric pairs, passed as filter: false) an
// autofilter over the header.
function makeSheet(name, data, widths, { filter = true } = {}) {
  const sheet = {
    data,
    sheet: name,
    stickyRowsCount: 1,
    dateFormat: 'yyyy-mm-dd',
    columns: widths.map((width) => ({ width: clampWidth(width) })),
  };
  if (filter) {
    sheet.autoFilterRef = `A1:${colLetter(widths.length - 1)}${data.length}`;
  }
  return sheet;
}

// Builds the full workbook: Summary, Transactions, Accounts, Categories
// (the last one only when observed transactions exist). Transactions go
// in sorted date ascending with id as tiebreak so re-exporting the same
// data stays byte-stable.
export function buildSheets({
  transactions,
  accounts,
  accountCounts,
  accountId,
  currency,
  vndDisplayMode = 'scaled',
  skippedCount = 0,
  now = new Date(),
}) {
  const amountCell = makeAmountCell(currency, vndDisplayMode);
  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  // Summary totals come from the app's own calc functions (parity with
  // the dashboard): month/all-time balance from computeSummary,
  // per-month income/expense from aggregateMonthlyTrend — and we sum
  // that trend's arrays for the all-time income/expense lines, so one
  // calculation serves two views.
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const summaryOf = computeSummary(sorted, now.getFullYear(), now.getMonth());
  const trend = aggregateMonthlyTrend(sorted);
  const allTimeIncome = trend.income.reduce((sum, value) => sum + value, 0);
  const allTimeExpense = trend.expense.reduce((sum, value) => sum + value, 0);
  const accountName = (accounts.find((account) => account.id === accountId) || {}).name || '';

  const summaryRows = [
    [headerCell('Metric'), headerCell('Value')],
    [cellText('Account'), cellText(accountName)],
    [cellText('Currency'), cellText(currency)],
    [cellText('Transactions exported'), numberCell(sorted.length)],
    [cellText('All-time income'), amountCell(allTimeIncome)],
    [cellText('All-time expenses'), amountCell(allTimeExpense)],
    [cellText('Total balance'), amountCell(summaryOf.totalBalance)],
    [cellText('Months with data'), numberCell(summaryOf.monthsWithData.size)],
    [cellText(`${monthKey} income`), amountCell(summaryOf.monthIncome)],
    [cellText(`${monthKey} expense`), amountCell(summaryOf.monthExpenses)],
  ];
  // Rows we skipped during decrypt are reported in the file itself
  // rather than lost (same precedent as backup metadata reporting
  // skipped rows).
  if (skippedCount > 0) {
    summaryRows.push([cellText('Rows skipped on decrypt'), numberCell(skippedCount)]);
  }
  summaryRows.push(
    [headerCell('Month'), headerCell('Income'), headerCell('Expense'), headerCell('Net')]
  );
  trend.months.forEach((month, i) => {
    summaryRows.push([
      cellText(month),
      amountCell(trend.income[i]),
      amountCell(trend.expense[i]),
      amountCell(trend.net[i]),
    ]);
  });

  const transactionRows = [
    [headerCell('Date'), headerCell('Type'), headerCell('Category'), headerCell('Amount'), headerCell('Note')],
  ];
  for (const tx of sorted) {
    transactionRows.push([
      dateCell(tx.date),
      cellText(tx.type === 'income' ? 'Income' : 'Expense'),
      cellText(tx.category),
      // Signed on this sheet: income positive, expense negative.
      amountCell(tx.type === 'income' ? tx.amount : -tx.amount),
      cellText(tx.note ?? null),
    ]);
  }

  const sortedAccounts = [...accounts].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  );
  const accountRows = [
    [headerCell('Account'), headerCell('Created'), headerCell('Transactions'),
      headerCell('Income'), headerCell('Expense'), headerCell('Balance')],
  ];
  for (const account of sortedAccounts) {
    // Transaction counts need no decryption (accountId is a plain
    // index), so we fill them for every account. Money columns are only
    // computable for the exported (active) account, whose session key we
    // hold — other accounts get empty cells.
    const isActive = account.id === accountId;
    accountRows.push([
      cellText(account.name),
      dateCell(account.createdAt ? String(account.createdAt).slice(0, 10) : null),
      numberCell(accountCounts.get(account.id) || 0),
      isActive ? amountCell(allTimeIncome) : null,
      isActive ? amountCell(allTimeExpense) : null,
      isActive ? amountCell(summaryOf.totalBalance) : null,
    ]);
  }

  // Categories derived from observed transactions, grouped per
  // (type, category) so income and expense are never summed together.
  // We deliberately don't reuse aggregateExpensesByCategory here: that
  // one merges into "Other" for the chart and would lose the
  // per-category totals this sheet owes the user.
  const categoryMap = new Map();
  for (const tx of sorted) {
    const key = `${tx.type}\u0000${tx.category ?? ''}`;
    const entry = categoryMap.get(key) || {
      category: tx.category ?? '',
      type: tx.type,
      count: 0,
      total: 0,
    };
    entry.count += 1;
    entry.total += tx.amount;
    categoryMap.set(key, entry);
  }
  const categoryList = [...categoryMap.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type)
  );

  const sheets = [
    // Summary gets no autofilter: it is metric/value pairs plus a
    // trend block, not a uniform table.
    makeSheet('Summary', summaryRows, [26, 18, 16, 16], { filter: false }),
    makeSheet('Transactions', transactionRows, [14, 12, 24, 18, 40]),
    makeSheet('Accounts', accountRows, [24, 14, 14, 18, 18, 18]),
  ];
  if (categoryList.length > 0) {
    const categoryRows = [
      [headerCell('Category'), headerCell('Type'), headerCell('Transactions'), headerCell('Total')],
    ];
    for (const entry of categoryList) {
      categoryRows.push([
        cellText(entry.category),
        cellText(entry.type === 'income' ? 'Income' : 'Expense'),
        numberCell(entry.count),
        amountCell(entry.total),
      ]);
    }
    sheets.push(makeSheet('Categories', categoryRows, [24, 12, 14, 18]));
  }

  const maxRows = sheets.reduce((max, sheet) => Math.max(max, sheet.data.length), 0);
  assertRowLimit(maxRows);
  return sheets;
}

// Our <autoFilter/> injector: it splices the element in immediately
// after </sheetData>, which is where XLSX element order wants it — right
// after sheetData, before mergeCells / pageMargins. Note this has to be
// the `transform` hook, not the feature's `insert`: insert would append
// after <drawing/>, the wrong position, so transforming the sheet XML is
// the correct hook.
const autoFilterFeature = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform: (xml, sheetOptions) => {
          if (!sheetOptions.autoFilterRef) return xml;
          return xml.replace(
            '</sheetData>',
            `</sheetData><autoFilter ref="${sheetOptions.autoFilterRef}"/>`
          );
        },
      },
    },
  },
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// write-excel-file has no docProps generator, so we write the
// title/creator metadata ourselves as docProps/core.xml and register it
// in [Content_Types].xml and _rels/.rels — the three places OOXML
// requires for core properties.
export function metadataFeature({ title, creator, now }) {
  const iso = now.toISOString();
  const coreXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dc:creator>${escapeXml(creator)}</dc:creator>` +
    `<cp:lastModifiedBy>${escapeXml(creator)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    '</cp:coreProperties>';

  return {
    files: {
      write: {
        files: () => ({ 'docProps/core.xml': coreXml }),
      },
      transform: {
        '[Content_Types].xml': {
          transform: (xml) =>
            xml.replace(
              '</Types>',
              '<Override ContentType="application/vnd.openxmlformats-package.core-properties+xml" ' +
                'PartName="/docProps/core.xml"/></Types>'
            ),
        },
        '_rels/.rels': {
          transform: (xml) =>
            xml.replace(
              '</Relationships>',
              '<Relationship Id="rId-core-properties" ' +
                'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ' +
                'Target="docProps/core.xml"/></Relationships>'
            ),
        },
      },
    },
  };
}

// Hands write-excel-file both of our features: the autoFilter shim plus
// the docProps metadata writer.
// @param {{title: string, creator: string, now: Date}} metadata
export function buildFeatures(metadata) {
  return [autoFilterFeature, metadataFeature(metadata)];
}
