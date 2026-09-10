// Typed service errors. Components map these to localized user guidance;
// session expiry (re-unlock) needs different messaging from data corruption
// (backup/restore), so they must not collapse into a generic failure string.
export class SessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}
