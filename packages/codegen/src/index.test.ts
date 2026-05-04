import { describe, it, expect } from 'vitest';
import { VERSION } from './index.ts';

describe('codegen scaffold', () => {
  it('exports a VERSION string', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
