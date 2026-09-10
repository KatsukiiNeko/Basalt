// Regression protection for the Dexie v1→v4 schema history (src/db/db.js).
//
// The v3 upgrade is the only stateful migration in the app: it converts the
// pre-multi-account layout (global salt/token settings, transactions without
// accountId) into the namespaced-per-account layout. Breaking it strands real
// user vaults, so it is exercised against a real IndexedDB (fake-indexeddb)
// rather than mocks.
import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';
import { db } from '../src/db/db';

// Wipe the physical database between scenarios. Dexie.delete resolves only
// once every open connection has released the DB, so the shared `db` handle
// must be closed first; it transparently re-opens (and re-runs migrations)
// on its next operation.
async function resetDatabase() {
  db.close();
  await Dexie.delete('Basalt');
}

// Recreate a v2-era database (pre-multi-account) with the exact stores the
// app declared at that version, so reopening at v4 is forced to run the
// v3 upgrade — same flow a returning v2 user's browser takes.
async function seedLegacyV2(seed) {
  const legacy = new Dexie('Basalt');
  legacy.version(2).stores({
    transactions: '++id,date,type,category',
    settings: 'key,value',
  });
  await legacy.open();
  await seed(legacy);
  legacy.close();
}

// First query on the shared v4 handle after seeding triggers the migration.
// The handle was explicitly closed by resetDatabase(); Dexie does not
// transparently reopen in v4, so open it before querying.
const runUpgrade = async () => {
  await db.open();
  await db.accounts.toArray();
};

const LEGACY_TX = [
  { date: '2025-11-03', type: 'expense', category: 'Food & Dining', amount: 1250 },
  { date: '2025-12-14', type: 'income', category: 'Salary', amount: 30000 },
];

describe('v3 migration: single-account vault becomes the "default" account', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedLegacyV2(async (legacy) => {
      await legacy.settings.bulkPut([
        { key: 'salt', value: [1, 2, 3, 4] },
        { key: 'verificationToken', value: { iv: [0], ciphertext: [9] } },
        { key: 'passwordSet', value: true },
      ]);
      await legacy.transactions.bulkAdd(LEGACY_TX);
    });
    await runUpgrade();
  });

  it('creates a default account and remaps the global auth settings to it', async () => {
    const accounts = await db.accounts.toArray();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('default');

    expect(await db.settings.get('salt:default')).toEqual({ key: 'salt:default', value: [1, 2, 3, 4] });
    expect((await db.settings.get('verificationToken:default')).value)
      .toEqual({ iv: [0], ciphertext: [9] });
    expect((await db.settings.get('passwordSet:default')).value).toBe(true);

    // The un-namespaced originals must be gone — a duplicate would make the
    // account look uninitialized to first-time-setup detection.
    expect(await db.settings.get('salt')).toBeUndefined();
    expect(await db.settings.get('verificationToken')).toBeUndefined();
    expect(await db.settings.get('passwordSet')).toBeUndefined();
  });

  it('backfills accountId onto existing transactions', async () => {
    const rows = await db.transactions.toArray();
    expect(rows).toHaveLength(LEGACY_TX.length);
    for (const row of rows) {
      expect(row.accountId).toBe('default');
    }
  });

  it('preserves transaction content through the migration', async () => {
    const rows = await db.transactions.orderBy('date').toArray();
    expect(rows[0].date).toBe('2025-11-03');
    expect(rows[0].amount).toBe(1250);
    expect(rows[1].category).toBe('Salary');
  });
});

describe('v3 migration: vault with no password set creates no default account', () => {
  // A v2 user who never set a password has nothing to migrate into an
  // account; creating one anyway would show a phantom "My Account".
  beforeAll(async () => {
    await resetDatabase();
    await seedLegacyV2(async (legacy) => {
      await legacy.transactions.bulkAdd(LEGACY_TX);
    });
    await runUpgrade();
  });

  it('leaves the accounts table empty but still backfills accountId', async () => {
    expect(await db.accounts.toArray()).toEqual([]);
    const rows = await db.transactions.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.accountId === 'default')).toBe(true);
  });
});

describe('fresh install: schema is created at v4 without running upgrades', () => {
  beforeAll(async () => {
    await resetDatabase();
    await runUpgrade();
  });

  it('opens with empty tables and the v4 indexes available', async () => {
    expect(await db.accounts.toArray()).toEqual([]);
    expect(await db.transactions.toArray()).toEqual([]);

    // The accountId index is the v3+ addition — verify a scoped query works.
    const scoped = await db.transactions.where('accountId').equals('any').toArray();
    expect(scoped).toEqual([]);
  });
});
