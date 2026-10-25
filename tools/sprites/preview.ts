import { writeFile } from 'node:fs/promises';
import { contactSheet } from './output';
import { buildSprites } from './generate';

/** Writes a magnified sheet of the sprites whose keys match every regex argument to the given path. */
async function main(): Promise<void> {
  const [outPath, scaleArg, ...patterns] = process.argv.slice(2);
  const matchers = patterns.map((p) => new RegExp(p));
  const defs = buildSprites().filter((d) => matchers.some((m) => m.test(d.key)));
  console.log(`${defs.length} sprites`);
  await writeFile(outPath, await contactSheet(defs, { width: 700, scale: Number(scaleArg) }));
}

await main();
