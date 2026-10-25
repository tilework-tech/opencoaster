import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSprites } from './generate';
import { contactSheet } from './output';
import type { SpriteDef } from './output';

const sheetDirectory = new URL('../../docs/art/', import.meta.url).pathname;

/** Writes one contact sheet PNG per top-level sprite group (paths, water, ...). */
async function main(): Promise<void> {
  const groups = new Map<string, SpriteDef[]>();
  for (const def of buildSprites()) {
    const parts = def.key.split('/');
    const group = parts[0];
    if (
      group.startsWith('coaster-') &&
      /\/view-\d+\/cell-/.test(def.key) &&
      !/\/view-0\/cell-/.test(def.key)
    )
      continue;
    groups.set(group, [...(groups.get(group) ?? []), def]);
  }
  await mkdir(sheetDirectory, { recursive: true });
  for (const [group, defs] of groups) {
    const sheet = await contactSheet(defs, { width: 900, scale: 2 });
    await writeFile(join(sheetDirectory, `contact-sheet-${group}.png`), sheet);
    console.log(`${group}: ${defs.length} sprites`);
  }
}

await main();
