import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { translations } from '../src/i18n/translations';

const collect = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (/\.(js|jsx)$/.test(entry) && !entry.endsWith('.test.js')) out.push(path);
  }
  return out;
};

const source = collect(join(process.cwd(), 'src'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

// Keys passed through a ternary are still static strings in the source.
const used = new Set([
  ...[...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...source.matchAll(/'((?:form|cat|month|dashboard|settings)\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]),
]);

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translation parity', () => {
  it('defines English and Vietnamese for every key', () => {
    for (const [key, entry] of Object.entries(translations)) {
      expect(typeof entry.en, `${key} en`).toBe('string');
      expect(entry.en.length, `${key} en`).toBeGreaterThan(0);
      expect(typeof entry.vi, `${key} vi`).toBe('string');
      expect(entry.vi.length, `${key} vi`).toBeGreaterThan(0);
    }
  });

  it('keeps placeholders identical across languages', () => {
    for (const [key, entry] of Object.entries(translations)) {
      expect(placeholders(entry.vi), key).toEqual(placeholders(entry.en));
    }
  });

  it('has no key requested by the UI that is missing from the dictionary', () => {
    for (const key of used) {
      if (key.endsWith('.')) continue; // dynamic prefix such as 'month.' + key
      expect(translations[key], `missing translation: ${key}`).toBeTruthy();
    }
  });
});
