// Workbook-format and service tests for the .xlsx export (DR-0009).
// Runs against real fake-indexeddb for the service path, and round-trips
// generated files through fflate to assert the actual OOXML bytes.
/* global process */
import { describe, it, expect, beforeEach } from 'vitest';
import { unzipSync } from 'fflate';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  setSessionKey,
  clearAllSessionKeys,
  setActiveAccountId,
  encryptTransactionForStorage,
} from '../src/crypto/crypto';
import { addTransaction, computeSummary } from '../src/services/transactions';
import { aggregateMonthlyTrend } from '../src/utils/chartData';
import {
  sanitizeText,
  clampWidth,
  dateCell,
  assertRowLimit,
  makeAmountCell,
  buildSheets,
  buildFeatures,
  MAX_ROWS,
} from '../src/services/exportWorkbook';
import { exportWorkbook } from '../src/services/exportService';

const ACCT = 'export-test-account';
const FAST = 1000;

async function seedSession() {
  const key = await deriveKey('pw', generateSalt(), FAST);
  setSessionKey(key, ACCT);
  setActiveAccountId(ACCT);
  return key;
}

const ACCOUNT_ROW = { id: ACCT, name: 'Export Acct', createdAt: '2026-01-05T00:00:00.000Z' };

function craftSheets(overrides = {}) {
  return buildSheets({
    transactions: [
      { id: 2, date: '2026-04-05', type: 'expense', category: 'Food', amount: 300, note: 'lunch' },
      { id: 1, date: '2026-04-02', type: 'income', category: 'Salary', amount: 1000, note: null },
      { id: 3, date: '2026-03-20', type: 'expense', category: 'Food', amount: 100, note: 'groceries' },
    ],
    accounts: [ACCOUNT_ROW],
    accountCounts: new Map([[ACCT, 3]]),
    accountId: ACCT,
    currency: 'VND',
    vndDisplayMode: 'scaled',
    skippedCount: 0,
    now: new Date(2026, 3, 10),
    ...overrides,
  });
}

const decode = (bytes) => new TextDecoder().decode(bytes);
const summaryValue = (sheets, label) =>
  sheets[0].data.find((row) => row[0] && row[0].value === label)?.[1]?.value;

beforeEach(async () => {
  await db.transactions.clear();
  await db.accounts.clear();
  await db.settings.clear();
  clearAllSessionKeys();
});

describe('workbook primitives', () => {
  it('sanitizes control characters and truncates to the XLSX cell limit', () => {
    expect(sanitizeText('a\x00b\x0Bc\x0C\x1Fd')).toBe('abcd');
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeNull();
    expect(sanitizeText(42)).toBe('42');
    expect(sanitizeText('x'.repeat(40000))).toHaveLength(32767);
  });

  it('clamps column widths into [10, 50]', () => {
    expect(clampWidth(3)).toBe(10);
    expect(clampWidth(100)).toBe(50);
    expect(clampWidth(30)).toBe(30);
  });

  it('builds UTC-midnight date cells that never day-shift, in any timezone', () => {
    const prevTZ = process.env.TZ;
    try {
      for (const tz of ['Asia/Bangkok', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        // Guard: prove the timezone actually took effect (local midnight
        // would differ from UTC midnight if it did).
        expect(new Date(2026, 3, 1).getTime()).not.toBe(Date.UTC(2026, 3, 1));

        const cell = dateCell('2026-04-01');
        expect(cell.type).toBe(Date);
        expect(cell.value.getTime()).toBe(Date.UTC(2026, 3, 1));
        // convertDateToSerialNumber must yield an exact integer serial.
        const serial = cell.value.getTime() / 86400000 + 25569;
        expect(Number.isInteger(serial)).toBe(true);
      }
    } finally {
      process.env.TZ = prevTZ;
    }
  });

  it('falls back to a text cell for malformed dates', () => {
    expect(dateCell('not-a-date').type).toBe(String);
    expect(dateCell('2026-13-01').type).toBe(String);
    expect(dateCell(null).value).toBeNull();
  });

  it('enforces the 1,048,576-row sheet limit with a typed error code', () => {
    expect(() => assertRowLimit(MAX_ROWS)).not.toThrow();
    try {
      assertRowLimit(MAX_ROWS + 1);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error.code).toBe('ROW_LIMIT');
    }
  });

  it('applies currency formats and VND display-mode scaling', () => {
    expect(makeAmountCell('VND', 'scaled')(50)).toEqual({ value: 50000, type: Number, format: '#,##0' });
    expect(makeAmountCell('VND', 'exact')(1250000)).toEqual({ value: 1250000, type: Number, format: '#,##0' });
    expect(makeAmountCell('USD', 'scaled')(400.555)).toEqual({ value: 400.56, type: Number, format: '#,##0.00' });
    expect(makeAmountCell('VND', 'scaled')(null)).toBeNull();
  });
});

describe('buildSheets', () => {
  it('produces Summary, Transactions, Accounts, Categories in order with frozen headers and clamped widths', () => {
    const sheets = craftSheets();
    expect(sheets.map((s) => s.sheet)).toEqual(['Summary', 'Transactions', 'Accounts', 'Categories']);
    for (const sheet of sheets) {
      expect(sheet.stickyRowsCount).toBe(1);
      expect(sheet.dateFormat).toBe('yyyy-mm-dd');
      for (const column of sheet.columns) {
        expect(column.width).toBeGreaterThanOrEqual(10);
        expect(column.width).toBeLessThanOrEqual(50);
      }
    }
    // Autofilter everywhere except Summary's metric pairs.
    expect(sheets[0].autoFilterRef).toBeUndefined();
    expect(sheets[1].autoFilterRef).toBe('A1:E4'); // 3 txns + header, 5 cols
    expect(sheets[2].autoFilterRef).toBe('A1:F2');
    expect(sheets[3].autoFilterRef).toBe('A1:D3'); // Food + Salary rows
  });

  it('sorts transactions date-ascending and signs amounts (income +, expense -)', () => {
    const rows = craftSheets()[1].data;
    const dates = rows.slice(1).map((row) => row[0].value.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-03-20', '2026-04-02', '2026-04-05']);
    const amounts = rows.slice(1).map((row) => row[3].value);
    expect(amounts).toEqual([-100000, 1000000, -300000]); // scaled VND
    expect(rows[1][1].value).toBe('Expense');
    expect(rows[2][1].value).toBe('Income');
  });

  it('Summary totals match the app calc functions exactly', () => {
    const sheets = craftSheets();
    const transactions = [
      { id: 1, date: '2026-04-02', type: 'income', category: 'Salary', amount: 1000 },
      { id: 2, date: '2026-04-05', type: 'expense', category: 'Food', amount: 300 },
      { id: 3, date: '2026-03-20', type: 'expense', category: 'Food', amount: 100 },
    ];
    const summary = computeSummary(transactions, 2026, 3);
    const trend = aggregateMonthlyTrend(transactions);
    const scale = (v) => v * 1000; // VND scaled display mode

    expect(summaryValue(sheets, 'All-time income')).toBe(scale(trend.income.reduce((a, b) => a + b, 0)));
    expect(summaryValue(sheets, 'All-time expenses')).toBe(scale(trend.expense.reduce((a, b) => a + b, 0)));
    expect(summaryValue(sheets, 'Total balance')).toBe(scale(summary.totalBalance));
    expect(summaryValue(sheets, '2026-04 income')).toBe(scale(summary.monthIncome));
    expect(summaryValue(sheets, '2026-04 expense')).toBe(scale(summary.monthExpenses));
    expect(summaryValue(sheets, 'Transactions exported')).toBe(3);
    expect(summaryValue(sheets, 'Account')).toBe('Export Acct');
    expect(summaryValue(sheets, 'Currency')).toBe('VND');
  });

  it('omits Categories when there are no transactions and reports skipped rows', () => {
    const empty = craftSheets({ transactions: [] });
    expect(empty.map((s) => s.sheet)).toEqual(['Summary', 'Transactions', 'Accounts']);
    expect(summaryValue(empty, 'Rows skipped on decrypt')).toBeUndefined();

    const withSkips = craftSheets({ skippedCount: 2 });
    expect(summaryValue(withSkips, 'Rows skipped on decrypt')).toBe(2);
  });

  it('lists every account with raw counts, money only for the active account', () => {
    const other = { id: 'other', name: 'Other', createdAt: '2026-02-01T00:00:00.000Z' };
    const sheets = craftSheets({
      accounts: [ACCOUNT_ROW, other],
      accountCounts: new Map([[ACCT, 3], ['other', 7]]),
    });
    const rows = sheets[2].data;
    expect(rows).toHaveLength(3);
    // Sorted by createdAt: active first, other second.
    expect(rows[1][0].value).toBe('Export Acct');
    expect(rows[1][2].value).toBe(3);
    expect(rows[1][3].value).toBe(1000000); // active account: all-time income 1000 * 1000 (scaled)
    expect(rows[2][0].value).toBe('Other');
    expect(rows[2][2].value).toBe(7);
    expect(rows[2][3]).toBeNull(); // no session key for other accounts
    expect(rows[2][5]).toBeNull();
  });
});

describe('exportWorkbook service', () => {
  it('returns { empty: true } when there is nothing to export', async () => {
    await seedSession();
    await db.accounts.put(ACCOUNT_ROW);
    const result = await exportWorkbook({ accountId: ACCT, currency: 'VND', vndDisplayMode: 'scaled' });
    expect(result).toEqual({ empty: true });
  });

  it('fails cleanly when the session is locked', async () => {
    clearAllSessionKeys();
    await expect(
      exportWorkbook({ accountId: ACCT, currency: 'VND', vndDisplayMode: 'scaled' })
    ).rejects.toThrow('SESSION_EXPIRED');
  });

  it('builds a blob with a local-date filename and row counts', async () => {
    await seedSession();
    await db.accounts.put(ACCOUNT_ROW);
    await addTransaction({ date: '2026-04-01', type: 'expense', category: 'Food', amount: 400, note: 'coffee' }, ACCT);
    await addTransaction({ date: '2026-04-02', type: 'income', category: 'Salary', amount: 5000000, note: null }, ACCT);

    const result = await exportWorkbook({ accountId: ACCT, currency: 'VND', vndDisplayMode: 'scaled' });
    expect(result.filename).toMatch(/^Basalt_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(result.count).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('reports rows skipped on decrypt', async () => {
    const key = await seedSession();
    await db.accounts.put(ACCOUNT_ROW);
    await addTransaction({ date: '2026-04-01', type: 'expense', category: 'Food', amount: 400 }, ACCT);
    const foreignKey = await deriveKey('other', generateSalt(), FAST);
    const bad = await encryptTransactionForStorage(
      { date: '2026-04-01', type: 'expense', category: 'Food', amount: 100 },
      foreignKey
    );
    bad.accountId = ACCT;
    await db.transactions.add(bad);
    expect(key).toBeDefined();

    const result = await exportWorkbook({ accountId: ACCT, currency: 'VND', vndDisplayMode: 'scaled' });
    expect(result.count).toBe(1);
    expect(result.skippedCount).toBe(1);
  });
});

describe('round-trip (unzip the actual file)', () => {
  let files;
  let result;

  beforeEach(async () => {
    await seedSession();
    await db.accounts.put(ACCOUNT_ROW);
    await addTransaction({ date: '2026-04-01', type: 'expense', category: 'Food', amount: 400, note: 'coffee' }, ACCT);
    await addTransaction({ date: '2026-04-02', type: 'income', category: 'Salary', amount: 5000000, note: null }, ACCT);
    result = await exportWorkbook({ accountId: ACCT, currency: 'VND', vndDisplayMode: 'scaled' });
    files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  });

  it('contains the expected package parts', () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/sharedStrings.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
        'xl/worksheets/sheet3.xml',
        'xl/worksheets/sheet4.xml',
        'docProps/core.xml',
      ])
    );
  });

  it('orders sheets Summary, Transactions, Accounts, Categories', () => {
    const workbook = decode(files['xl/workbook.xml']);
    const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Summary', 'Transactions', 'Accounts', 'Categories']);
    // First sheet active: workbookView exists (activeTab defaults to 0)
    // and sheet1 carries tabSelected="1".
    expect(workbook).toContain('<workbookView');
    expect(decode(files['xl/worksheets/sheet1.xml'])).toContain('tabSelected="1"');
  });

  it('freezes the header row on every sheet', () => {
    for (let i = 1; i <= 4; i++) {
      const xml = decode(files[`xl/worksheets/sheet${i}.xml`]);
      expect(xml).toContain('<pane ');
      expect(xml).toContain('state="frozen"');
    }
  });

  it('adds autofilters to data sheets only, with correct refs', () => {
    expect(decode(files['xl/worksheets/sheet1.xml'])).not.toContain('<autoFilter');
    expect(decode(files['xl/worksheets/sheet2.xml'])).toContain('<autoFilter ref="A1:E3"/>');
    expect(decode(files['xl/worksheets/sheet3.xml'])).toContain('<autoFilter ref="A1:F2"/>');
    expect(decode(files['xl/worksheets/sheet4.xml'])).toContain('<autoFilter ref="A1:D3"/>');
  });

  it('writes true date cells (integer serial), signed amounts, and VND format', () => {
    const sheet2 = decode(files['xl/worksheets/sheet2.xml']);
    const serial = Date.UTC(2026, 3, 1) / 86400000 + 25569; // 2026-04-01
    expect(Number.isInteger(serial)).toBe(true);
    expect(sheet2).toContain(`<v>${serial}</v>`);
    // expense 400 VND-scaled -> -400000, income 5000000 -> 5000000000.
    expect(sheet2).toContain('<v>-400000</v>');
    expect(sheet2).toContain('<v>5000000000</v>');
    const styles = decode(files['xl/styles.xml']);
    expect(styles).toContain('formatCode="#,##0"');
  });

  it('contains no formulas and no external relationships', () => {
    for (const bytes of Object.values(files)) {
      const content = decode(bytes);
      expect(content).not.toMatch(/<f[ >]/);
      expect(content).not.toContain('TargetMode="External"');
    }
  });

  it('writes docProps metadata with the app name and registers it', () => {
    const core = decode(files['docProps/core.xml']);
    expect(core).toContain('<dc:title>Basalt Export</dc:title>');
    expect(core).toContain('<dc:creator>Basalt</dc:creator>');
    expect(decode(files['[Content_Types].xml'])).toContain('PartName="/docProps/core.xml"');
    expect(decode(files['_rels/.rels'])).toContain('Target="docProps/core.xml"');
  });

  it('never emits control characters (canary note is stripped, not corrupted)', async () => {
    const sheets = buildSheets({
      transactions: [
        { id: 1, date: '2026-04-01', type: 'expense', category: 'Cat\x00egory', amount: 100, note: 'a\x00b\x1Fc' },
      ],
      accounts: [ACCOUNT_ROW],
      accountCounts: new Map([[ACCT, 1]]),
      accountId: ACCT,
      currency: 'VND',
      vndDisplayMode: 'scaled',
      now: new Date(2026, 3, 10),
    });
    const { default: writeXlsxFile } = await import('write-excel-file/universal');
    const blob = await writeXlsxFile(sheets, {
      features: buildFeatures({ title: 'Basalt Export', creator: 'Basalt', now: new Date('2026-10-09T00:00:00.000Z') }),
    }).toBlob();
    const canaryFiles = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    for (const bytes of Object.values(canaryFiles)) {
      expect(Array.from(bytes).some((b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)).toBe(false);
    }
    const shared = decode(canaryFiles['xl/sharedStrings.xml']);
    expect(shared).toContain('Category'); // \x00 stripped, text kept
    expect(shared).toContain('abc');      // \x00 and \x1F stripped
  });
});
