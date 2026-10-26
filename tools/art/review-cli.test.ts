import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('art review command', () => {
  it('prints usage without starting a browser when help is requested', () => {
    const result = spawnSync('corepack', ['pnpm', 'art:review', '--', '--help'], {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
      encoding: 'utf8',
      env: process.env,
      timeout: 10_000,
    });

    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm art:review');
    expect(result.stdout).toContain('--help');
    expect(result.stdout).toContain('docs/art/review');
  });
});
