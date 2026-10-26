import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../src/ui/icons';
import { renderUiIcons } from './ui-icons';

const SIZES = [16, 24] as const;
const BASE = '/opencoaster/';

describe('UI icons in a production build served under a subpath', () => {
  let dist = '';

  beforeAll(async () => {
    await renderUiIcons(resolve('public/sprites'));
    dist = mkdtempSync(join(tmpdir(), 'oc-dist-'));
    await build({ base: BASE, logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } });
  }, 240_000);

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('ships every icon id at every size', () => {
    const missing = ICON_NAMES.flatMap((name) =>
      SIZES.map((size) => `sprites/ui-icons/${size}/${name}.png`),
    ).filter((file) => !existsSync(join(dist, file)));
    expect(missing).toEqual([]);
  });

  it('precaches every icon in the service worker', () => {
    const worker = readFileSync(join(dist, 'service-worker.js'), 'utf8');
    for (const name of ICON_NAMES)
      for (const size of SIZES) expect(worker).toContain(`sprites/ui-icons/${size}/${name}.png`);
  });
});
