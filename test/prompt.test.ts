import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as prompt from '../src/prompt.ts';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/prompts.json', 'utf8')) as Record<
  string,
  string
>;

describe('prompt verbatim port (AC6)', () => {
  for (const [key, expected] of Object.entries(fixture)) {
    it(`${key} matches Python prompt.py exactly`, () => {
      expect((prompt as Record<string, string>)[key], key).toBe(expected);
    });
  }
});
