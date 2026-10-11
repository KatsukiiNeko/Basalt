// Our per-account session key registry. Keys live in this module's memory
// and are never persisted anywhere — no localStorage, no IndexedDB — so
// getting one back means entering the password (services/auth.js derives
// it and hands it to setSessionKey).
//
// AccountSelector sets the active account when you pick one; components
// that need an id (PasswordManager, Dashboard, TransactionForm) read it
// back with getActiveAccountId() rather than threading it down as a prop,
// and getSessionKey()/setSessionKey() fall back to it when no accountId is
// passed. App.jsx calls clearSessionKey() on the 15-minute idle timeout,
// on logout and on account switch; clearAllSessionKeys() drops every
// account plus the active id and is what the test suites reset with.

const _sessionKeys = {};
let _activeAccountId = null;

export function getSessionKey(accountId) {
  const id = accountId || _activeAccountId;
  return id ? _sessionKeys[id] || null : null;
}

export function setSessionKey(key, accountId) {
  const id = accountId || _activeAccountId;
  if (id) {
    _sessionKeys[id] = key;
    _activeAccountId = id;
  }
}

export function clearSessionKey() {
  if (_activeAccountId) {
    delete _sessionKeys[_activeAccountId];
  }
}

export function clearAllSessionKeys() {
  for (const key of Object.keys(_sessionKeys)) {
    delete _sessionKeys[key];
  }
  _activeAccountId = null;
}

export function getActiveAccountId() {
  return _activeAccountId;
}

export function setActiveAccountId(id) {
  _activeAccountId = id;
}
