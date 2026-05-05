/**
 * Regenerate one fixture's expected.lua from its input.json by running
 * the emitter and writing the output. Used as a one-shot tool for the
 * mechanically-verbose fixtures (e.g. 16-column meter, 128 cells).
 *
 * After regenerating, the human still spot-checks the output. The fact
 * that the generator runs the emitter does NOT make tests circular —
 * the test will fail in any future run if the emitter output drifts
 * from this committed expected file.
 *
 * Usage:
 *   pnpm regen-fixture <fixture-name>
 *
 *   e.g. pnpm regen-fixture meter-16-cols-full
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from '../src/index.ts';
import type { GridLayout } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../__fixtures__/golden');

const fixtureName = process.argv[2];
if (!fixtureName) {
  console.error('usage: regen-fixture.ts <fixture-name>');
  process.exit(1);
}

const inputPath = resolve(FIXTURES_DIR, `${fixtureName}.input.json`);
const outputPath = resolve(FIXTURES_DIR, `${fixtureName}.expected.lua`);

const layout = JSON.parse(readFileSync(inputPath, 'utf8')) as GridLayout;
const lua = emit(layout);
writeFileSync(outputPath, lua);

console.log(`wrote ${outputPath} (${lua.split('\n').length} lines)`);
