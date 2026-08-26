// Per-account session key registry. Keys live in module memory only —
// never persisted to any storage.

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
