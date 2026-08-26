import Dexie from 'dexie';

export const db = new Dexie('MoneyVault');

db.version(1).stores({
  transactions: '++id,date,type,category',
  settings: 'key,value'
});

db.version(2).stores({
  transactions: '++id,date,type,category',
  settings: 'key,value'
});

db.version(3).stores({
  accounts: 'id,name,createdAt',
  transactions: '++id,accountId,date,type,category',
  settings: 'key,value'
}).upgrade(async (tx) => {
  const existingSalt = await tx.table('settings').get('salt');
  const existingToken = await tx.table('settings').get('verificationToken');
  const existingPasswordSet = await tx.table('settings').get('passwordSet');

  if (existingSalt || existingToken || existingPasswordSet) {
    await tx.table('accounts').put({
      id: 'default',
      name: 'My Account',
      createdAt: new Date().toISOString()
    });

    if (existingSalt) {
      await tx.table('settings').delete('salt');
      await tx.table('settings').put({ key: 'salt:default', value: existingSalt.value });
    }
    if (existingToken) {
      await tx.table('settings').delete('verificationToken');
      await tx.table('settings').put({ key: 'verificationToken:default', value: existingToken.value });
    }
    if (existingPasswordSet) {
      await tx.table('settings').delete('passwordSet');
      await tx.table('settings').put({ key: 'passwordSet:default', value: existingPasswordSet.value });
    }
  }

  await tx.table('transactions').toCollection().modify((record) => {
    if (!record.accountId) {
      record.accountId = 'default';
    }
  });
});

db.version(4).stores({
  accounts: 'id,name,createdAt',
  transactions: '++id,accountId,date,type,category',
  settings: 'key,value'
});

export default db;
