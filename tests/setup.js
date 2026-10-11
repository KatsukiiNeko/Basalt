// Our Vitest setup: we hand every test an in-memory IndexedDB (fake-indexeddb)
// because jsdom ships no real one — without this import the Dexie-based modules
// would fail the moment they touch the database.
import 'fake-indexeddb/auto';
