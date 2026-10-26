import { FIRST_INSTANCE_OBJECT_ID } from './object-kinds';

export interface PairScore {
  /** Pixels where the oracle shows the first kind and the renderer the second. */
  mismatched: number;
  /** Pixels covered by both kinds (in either order), where the two compete for the pixel. */
  contested: number;
}

export interface OcclusionScore {
  /** Pixels where the oracle or the renderer shows an object other than ground or water. */
  objectPixels: number;
  /** Object pixels the renderer gives to an object that is covered there but hidden. */
  mismatched: number;
  /** Object pixels the renderer gives to an object kind that does not cover the pixel at all. */
  coverage: number;
  /** Keyed `oracleKind>renderedKind`. */
  pairs: Record<string, PairScore>;
  /** Per pixel: 0 agree or ignored, 1 occlusion mismatch, 2 coverage mismatch. */
  heat: Uint8Array;
}

export interface OcclusionScoreInput {
  oracle: Int32Array;
  rendered: Int32Array;
  /** The oracle's union of covering kind bits per pixel. */
  kindMasks: Uint32Array;
  kinds: ReadonlyMap<number, string>;
  kindBit: (kind: string) => number;
  /** Pixels left out of the score, such as the oracle's ambiguous samples. */
  ignore?: Uint8Array;
}

/** Compares a renderer's object-ID image against the oracle's (see occlusion-oracle.ts). */
export function scoreOcclusion(input: OcclusionScoreInput): OcclusionScore {
  const { oracle, rendered, kindMasks, kinds, kindBit, ignore } = input;
  const pairs: Record<string, PairScore> = {};
  const heat = new Uint8Array(oracle.length);
  let objectPixels = 0;
  let mismatched = 0;
  let coverage = 0;
  const kindOf = (id: number): string => (id === 0 ? 'none' : (kinds.get(id) ?? 'other'));
  const mismatchedPairs = new Map<string, number>();
  for (let i = 0; i < oracle.length; i++) {
    const want = oracle[i];
    const got = rendered[i];
    if (want < FIRST_INSTANCE_OBJECT_ID && got < FIRST_INSTANCE_OBJECT_ID) continue;
    if (ignore?.[i]) continue;
    objectPixels++;
    if (want === got) continue;
    const gotKind = kindOf(got);
    if (got !== 0 && (kindMasks[i] & kindBit(gotKind)) === 0) {
      coverage++;
      heat[i] = 2;
      continue;
    }
    mismatched++;
    heat[i] = 1;
    const key = `${kindOf(want)}>${gotKind}`;
    mismatchedPairs.set(key, (mismatchedPairs.get(key) ?? 0) + 1);
  }
  for (const [key, count] of mismatchedPairs) {
    const [a, b] = key.split('>') as [string, string];
    const both = kindBit(a) | kindBit(b);
    let contested = 0;
    for (let i = 0; i < kindMasks.length; i++) if ((kindMasks[i] & both) === both) contested++;
    pairs[key] = { mismatched: count, contested };
  }
  return { objectPixels, mismatched, coverage, pairs, heat };
}
