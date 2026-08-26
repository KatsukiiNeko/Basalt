// Vitest setup: provide an in-memory IndexedDB (fake-indexeddb) so Dexie-based
// modules can run under jsdom, which lacks a real IndexedDB implementation.
import 'fake-indexeddb/auto';
