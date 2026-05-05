import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './index.ts';
import type { GridLayout } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../__fixtures__/golden');

describe('golden tests', () => {
  const inputs = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.input.json'))
    .sort();

  for (const input of inputs) {
    const name = input.replace(/\.input\.json$/, '');
    it(name, () => {
      const layout = JSON.parse(
        readFileSync(resolve(FIXTURES_DIR, input), 'utf8'),
      ) as GridLayout;
      const expectedPath = resolve(FIXTURES_DIR, `${name}.expected.lua`);
      const expected = readFileSync(expectedPath, 'utf8');
      const actual = emit(layout);
      expect(actual).toBe(expected);
    });
  }
});
