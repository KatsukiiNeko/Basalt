# DR-0001: Adopt Vitest as the test framework

- **Date:** 2026-08-25
- **Status:** Accepted
- **Phase:** 3a (protective testing infrastructure)

## Context

The V2 refactor plan (brief §30) requires regression-protection tests to be written
BEFORE any architectural refactoring. The project currently has zero tests and zero
test infrastructure. Any refactor of `crypto.js`, `forecast.js`, or `lockout.js`
would proceed without a safety net.

## Decision

Add **Vitest** (with **jsdom** environment) as dev-only dependencies.

- `vitest` was chosen over Jest because it shares Vite's transform pipeline and
  config, requires no separate transpiler setup, and is the de-facto standard for
  Vite projects.
- `jsdom` is required because `lockout.js` reads/writes `localStorage` /
  `sessionStorage`, which do not exist in the default Node environment.
- React Testing Library is deliberately NOT added yet. Phase 3b targets are pure
  logic modules (crypto, forecast, lockout); component-level testing will be
  reconsidered when screen redesigns (Phase 6) begin.
- Tests live in a top-level `tests/` directory (`tests/*.test.js`), keeping them
  out of the production bundle path entirely.

## Consequences

- New devDependencies: `vitest`, `jsdom`. No production dependency changes;
  none of this ships in the built PWA.
- Two new scripts: `npm test` (watch mode) and `npm run test:run` (single run,
  CI-friendly).
- `vite.config.js` gains a `test` section and switches its `defineConfig` import
  to `vitest/config` so the `test` key type-checks.
