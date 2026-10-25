export interface TextureRun {
  start: number;
  count: number;
  pages: number[];
}

/** Groups ordered atlas page IDs into draw runs with at most `maxPages` per run. */
export function buildTextureRuns(
  pageIds: ArrayLike<number>,
  maxPages: number,
): { runs: TextureRun[]; slots: number[] } {
  const runs: TextureRun[] = [];
  const slots: number[] = [];
  let run: TextureRun | undefined;

  for (let index = 0; index < pageIds.length; index++) {
    const page = pageIds[index];
    let slot = run?.pages.indexOf(page) ?? -1;
    if (!run || (slot < 0 && run.pages.length === maxPages)) {
      run = { start: index, count: 0, pages: [] };
      runs.push(run);
      slot = -1;
    }
    if (slot < 0) slot = run.pages.push(page) - 1;
    run.count++;
    slots.push(slot);
  }

  return { runs, slots };
}
