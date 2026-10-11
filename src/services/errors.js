// Our typed service errors. Components map these to localized user
// guidance; session expiry (re-unlock) needs different messaging from
// data corruption (backup/restore), so they must not collapse into a
// generic failure string. useVaultData is the concrete consumer: it
// checks `instanceof SessionExpiredError` to choose "session-expired"
// (offer re-unlock) over "load-failed".
export class SessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}
