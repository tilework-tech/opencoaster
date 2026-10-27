import { PathStyle } from '../../../sim/map/tile-map';
import type { PieceSlope, Tile } from './run';

/** Line mode lays a dragged run; piece mode builds one piece at a time from a cursor tile. */
export type PathMode = 'line' | 'piece';

export interface PathToolState {
  mode: PathMode;
  style: PathStyle;
  queue: boolean;
  /** Piece mode: the direction the next piece faces (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
  dir: number;
  slope: PieceSlope;
  /** Piece mode: the tile the next Build or Remove acts on. */
  cursor: Tile | null;
  /**
   * Piece mode: the height level of the cursor's entry edge, so the next piece joins the end of the
   * last one. Null rests the next piece on the ground of the cursor tile.
   */
  cursorLevel: number | null;
}

export function createPathState(): PathToolState {
  return {
    mode: 'line',
    style: PathStyle.Tarmac,
    queue: false,
    dir: 0,
    slope: 'level',
    cursor: null,
    cursorLevel: null,
  };
}

export const PATH_STYLE_LABELS: Readonly<Record<PathStyle, string>> = {
  [PathStyle.Tarmac]: 'Tarmac',
  [PathStyle.CrazyPaving]: 'Crazy paving',
  [PathStyle.Dirt]: 'Dirt',
};

/** Piece direction names, indexed by the direction value (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
export const DIRECTION_LABELS: readonly string[] = ['+X', '+Y', '−X', '−Y'];

export const SLOPE_LABELS: Readonly<Record<PieceSlope, string>> = {
  level: 'Level, following the ground',
  up: 'Up',
  down: 'Down',
};

const HINT_KEY = 'opencoaster.footpathHintShown';

/** The one-line hint shows the first time the Footpaths window opens, then stays hidden. */
export function takeFootpathHint(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  if (storage.getItem(HINT_KEY) === '1') return false;
  storage.setItem(HINT_KEY, '1');
  return true;
}
