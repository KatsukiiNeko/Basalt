import { describe, it, expect } from 'vitest';

// Smoke check: we verify the Vitest pipeline itself — jsdom env plus Vite
// transforms — before any protective tests are layered on top. When this
// file fails, the harness is broken, not the code under test.
describe('test infrastructure', () => {
  it('runs in a jsdom-like environment with Web Crypto available', () => {
    expect(typeof window).toBe('object');
    expect(typeof crypto.subtle.generateKey).toBe('function');
  });

  it('imports project source through the Vite pipeline', async () => {
    const { calculateForecast } = await import('../src/utils/forecast');
    expect(typeof calculateForecast).toBe('function');

    // Empty input is the degenerate case: calculateForecast still has to
    // hand back a well-formed result object instead of throwing.
    const result = calculateForecast([], 0);
    expect(result).toHaveProperty('dailySpending');
    expect(result).toHaveProperty('projectedBalance');
  });
});
