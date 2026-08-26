import { describe, it, expect } from 'vitest';

// Smoke check: verifies the Vitest pipeline (jsdom env + Vite transforms) works
// before any protective tests are layered on top of it.
describe('test infrastructure', () => {
  it('runs in a jsdom-like environment with Web Crypto available', () => {
    expect(typeof window).toBe('object');
    expect(typeof crypto.subtle.generateKey).toBe('function');
  });

  it('imports project source through the Vite pipeline', async () => {
    const { calculateForecast } = await import('../src/utils/forecast');
    expect(typeof calculateForecast).toBe('function');

    // Empty input must produce a well-formed, non-throwing result object.
    const result = calculateForecast([], 0);
    expect(result).toHaveProperty('dailySpending');
    expect(result).toHaveProperty('projectedBalance');
  });
});
