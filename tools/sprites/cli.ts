import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contactSheet } from './output';
import { buildSprites } from './generate';

const sheetDirectory = new URL('../../docs/art/', import.meta.url).pathname;

/** Writes one contact sheet PNG per top-level sprite group (paths, water, rides, ...). */
async function main(): Promise<void> {
  const groups = new Map<string, ReturnType<typeof buildSprites>>();
  for (const def of buildSprites()) {
    const group = def.key.split('/')[0];
    groups.set(group, [...(groups.get(group) ?? []), def]);
  }
  await mkdir(sheetDirectory, { recursive: true });
  for (const [group, defs] of groups) {
    const sheet = await contactSheet(defs, { columns: 12, scale: 2 });
    await writeFile(join(sheetDirectory, `contact-sheet-${group}.png`), sheet);
    console.log(`${group}: ${defs.length} sprites`);
  }
}

await main();
