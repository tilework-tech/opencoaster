import type { Camera, Renderer } from '../../../render/renderer';
import type { MapMessage } from '../../../worker/protocol';
import type { SimClient } from '../../../worker/sim-client';
import type { PathPiecePreview } from '../../../sim/map/map-commands';
import { PathResult, QueueLink } from '../../../sim/map/paths';
import type { PathPlacement } from '../../../sim/map/paths';
import { PATH_COST_CENTS, PathFlag, SLOPE_DIR_SHIFT } from '../../../sim/map/tile-map';
import type { PathStyle } from '../../../sim/map/tile-map';
import { formatMoney } from '../../../ui/format';
import type { FootpathControls } from '../../../ui/ui-types';
import { pathRefusalText } from '../path-feedback';
import { PathGhost, pathPieceGhosts } from './ghost';
import type { GhostItem } from './ghost';
import { exitLevel, pathRunTiles, pieceBase, pieceSlope, stepCursor } from './run';
import type { PieceSlope, Tile } from './run';
import { DIRECTION_LABELS, PATH_STYLE_LABELS, SLOPE_LABELS } from './state';
import type { PathMode, PathToolState } from './state';

export interface PathToolDeps {
  sim: SimClient;
  state: PathToolState;
  camera: Camera;
  /** Draws the accepted and refused pieces in the world, at their depth. */
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  /** Element the preview overlay is added to; it must cover the viewport. */
  overlay: HTMLElement;
  setStatus(text: string): void;
}

/** A footpath element of the current map: its base level and the direction it rises toward (-1 flat). */
interface MapPath {
  base: number;
  rises: number;
}

/** Slope-direction bits of a path element's flags, as `PathFlag.Sloped` and `SLOPE_DIR_SHIFT` lay them out. */
function pathRises(flags: number): number {
  return flags & PathFlag.Sloped ? (flags & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT : -1;
}

/** The footpath elements stacked in a tile, lowest first. */
function pathsAt(map: MapMessage, tile: Tile): MapPath[] {
  const found: MapPath[] = [];
  for (let e = 0; e < map.pathCount; e++) {
    if (map.pathElements[e * 6] !== tile.x || map.pathElements[e * 6 + 1] !== tile.y) continue;
    found.push({
      base: map.pathElements[e * 6 + 2]!,
      rises: pathRises(map.pathElements[e * 6 + 3]!),
    });
  }
  return found.sort((a, b) => a.base - b.base);
}

function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

/**
 * Footpath construction on the map. The hovered tile, a dragged run, or the piece cursor is
 * previewed by the simulation, and the ghost draws exactly the pieces it would build. Release or
 * Build sends the same placements as one `placePathRun` command, which the sim judges in the same
 * order, so the laid pieces match the ghost.
 */
export class PathTool implements FootpathControls {
  private readonly ghost: PathGhost;
  private anchor: Tile | null = null;
  private run: Tile[] = [];
  private hovered: Tile | null = null;
  private previewSeq = 0;
  private pointer = { clientX: 0, clientY: 0 };
  private target: { x: number; y: number; level: number } | null = null;
  /** Pieces built from the current cursor, newest last, for Demolish last. */
  private history: Array<{ tile: Tile; z: number; level: number | null }> = [];

  constructor(private readonly deps: PathToolDeps) {
    this.ghost = new PathGhost(deps.overlay);
  }

  /** Hides the outline and clears the piece art drawn in the world. */
  private hidePreview(): void {
    this.ghost.hide();
    this.deps.renderer.setGhosts([]);
    this.target = null;
  }

  /** The tile and height level the last accepted preview piece would be built at, if any. */
  get buildTarget(): Readonly<{ x: number; y: number; level: number }> | null {
    return this.target;
  }

  get state(): Readonly<PathToolState> {
    return this.deps.state;
  }

  setMode(mode: PathMode): void {
    this.deps.state.mode = mode;
    this.hoverEnd();
    this.deps.setStatus(
      mode === 'line'
        ? 'Lay line: drag across ground to lay a run.'
        : 'Piece by piece: click a tile to set the cursor, then Build.',
    );
    this.refreshPiece();
  }

  setStyle(style: PathStyle): void {
    this.deps.state.style = style;
    this.deps.setStatus(`Surface: ${PATH_STYLE_LABELS[style]}.`);
    this.refreshHover();
    this.refreshPiece();
  }

  setQueue(queue: boolean): void {
    this.deps.state.queue = queue;
    this.deps.setStatus(
      queue
        ? 'Queue line on: build it from a ride entrance out to a path. Guests only walk it once they have chosen that ride, and it joins other paths at its open end only.'
        : 'Queue line off.',
    );
    this.refreshHover();
    this.refreshPiece();
  }

  setDirection(dir: number): void {
    this.deps.state.dir = dir;
    this.deps.setStatus(`Facing ${DIRECTION_LABELS[dir]}.`);
    this.refreshPiece();
  }

  setSlope(slope: PieceSlope): void {
    this.deps.state.slope = slope;
    this.deps.setStatus(`Slope: ${SLOPE_LABELS[slope]}.`);
    this.refreshPiece();
  }

  announce(text: string): void {
    this.deps.setStatus(text);
  }

  /** Hides the preview and drops any drag in progress; called when the window closes. */
  leave(): void {
    this.dragCancel();
    this.hovered = null;
    this.hidePreview();
  }

  /** Remembers where the pointer is so the ghost label can follow it. */
  pointAt(clientX: number, clientY: number): void {
    this.pointer = { clientX, clientY };
  }

  /** Mouse hover in line mode previews the single piece under the pointer; null clears it. */
  hover(tile: Tile | null): void {
    const { state } = this.deps;
    if (!tile || state.mode !== 'line' || this.anchor) {
      this.hoverEnd();
      return;
    }
    if (this.hovered && tileKey(this.hovered) === tileKey(tile)) return;
    this.hovered = tile;
    this.show([tile], -1);
  }

  hoverEnd(): void {
    if (this.hovered === null) return;
    this.hovered = null;
    if (!this.anchor) this.hidePreview();
  }

  /** A drag in line mode starts on `tile`. Returns false in piece mode, where a drag pans instead. */
  dragStart(tile: Tile): boolean {
    if (this.deps.state.mode !== 'line') return false;
    this.hoverEnd();
    this.anchor = tile;
    this.run = [tile];
    this.show(this.run, -1);
    return true;
  }

  /** The drag's end point moved to `tile`; the previewed run follows it. */
  dragMove(tile: Tile): void {
    if (!this.anchor) return;
    const next = pathRunTiles(this.anchor, tile);
    const end = next[next.length - 1]!;
    const current = this.run[this.run.length - 1]!;
    if (end.x === current.x && end.y === current.y) return;
    this.run = next;
    this.show(this.run, -1);
  }

  /** Lays the dragged run: exactly the pieces the ghost showed. */
  async dragEnd(): Promise<void> {
    if (!this.anchor) return;
    const run = this.run;
    this.anchor = null;
    this.run = [];
    await this.lay(run, -1);
  }

  dragCancel(): void {
    this.anchor = null;
    this.run = [];
    this.previewSeq++;
    if (this.hovered === null) this.hidePreview();
  }

  /** A single tap in line mode lays one piece, judged and reported the same way as a run. */
  tap(tile: Tile): void {
    if (this.deps.state.mode === 'piece') {
      this.deps.state.cursor = tile;
      this.deps.state.cursorLevel = this.levelOfTap(tile);
      this.history = [];
      this.refreshPiece();
      this.deps.setStatus(`Cursor at ${tile.x}, ${tile.y}.`);
      return;
    }
    void this.lay([tile], -1);
  }

  /**
   * Piece mode: builds the piece the controls describe at the cursor, then moves the cursor to the
   * next tile at the height the piece ends. At a tile that already holds a footpath at the cursor's
   * level, Build instead continues from that path's end.
   */
  async build(): Promise<void> {
    const { state } = this.deps;
    const cursor = state.cursor;
    if (!cursor) {
      this.deps.setStatus('Click a tile to set the cursor first.');
      return;
    }
    const existing = this.existingAtCursor(cursor);
    if (existing) {
      this.continueFrom(cursor, existing);
      return;
    }
    const placement = this.pieceAt(cursor);
    const [piece] = await this.deps.sim.previewPaths([placement]);
    if (piece!.result !== PathResult.Ok) {
      this.deps.setStatus(`${cursor.x}, ${cursor.y}: ${pathRefusalText(piece!.result)}`);
      return;
    }
    this.deps.sim.command({ type: 'placePathRun', placements: [placement] });
    this.history.push({ tile: cursor, z: piece!.z, level: state.cursorLevel });
    const next = stepCursor(cursor, state.dir);
    state.cursor = next;
    state.cursorLevel = exitLevel(piece!.z, piece!.dir, state.dir);
    this.deps.setStatus(
      `Built at ${cursor.x}, ${cursor.y}. Cursor moved to ${next.x}, ${next.y}` +
        (state.cursorLevel === null
          ? ' (this piece rises sideways, so the next one starts on the ground).'
          : ` at level ${state.cursorLevel}.`),
    );
    this.refreshPiece();
  }

  /** Piece mode: removes the footpath at the cursor, refunding its cost. */
  remove(): void {
    const { state, sim } = this.deps;
    const cursor = state.cursor;
    if (!cursor) {
      this.deps.setStatus('Click a tile to set the cursor first.');
      return;
    }
    const existing = this.existingAtCursor(cursor);
    if (!existing) {
      this.deps.setStatus(`No footpath at ${cursor.x}, ${cursor.y}.`);
      return;
    }
    sim.command({ type: 'removePath', x: cursor.x, y: cursor.y, z: existing.base });
    this.deps.setStatus(`Removed the footpath at ${cursor.x}, ${cursor.y}.`);
  }

  /** Piece mode: takes back the piece built last and puts the cursor where it stood. */
  demolishLast(): void {
    const { state, sim } = this.deps;
    const last = this.history.pop();
    if (!last) {
      this.deps.setStatus('No piece built from this cursor to take back.');
      return;
    }
    sim.command({ type: 'removePath', x: last.tile.x, y: last.tile.y, z: last.z });
    state.cursor = last.tile;
    state.cursorLevel = last.level;
    this.deps.setStatus(`Took back the piece at ${last.tile.x}, ${last.tile.y}.`);
    this.refreshPiece();
  }

  /** Redraws the piece-mode preview after the window changes direction, slope, surface or cursor. */
  refreshPiece(): void {
    const { state } = this.deps;
    const cursor = state.cursor;
    if (state.mode !== 'piece' || !cursor) {
      if (this.anchor === null && this.hovered === null) this.hidePreview();
      return;
    }
    this.show(
      [cursor],
      pieceSlope(state.dir, state.slope),
      pieceBase(state.cursorLevel, state.slope),
      state.cursorLevel,
    );
  }

  dispose(): void {
    this.deps.renderer.setGhosts([]);
    this.ghost.dispose();
  }

  /** Re-previews the hovered tile after the surface or queue changes. */
  private refreshHover(): void {
    const tile = this.hovered;
    if (tile === null) return;
    this.hovered = null;
    this.hover(tile);
  }

  /**
   * Previews `tiles` with the given slope argument and draws the result. Tiles that already hold a
   * footpath are shown as paved and left out of the preview. Only the newest request may draw.
   */
  private show(tiles: Tile[], slope: number, z?: number, entry: number | null = null): void {
    const seq = ++this.previewSeq;
    this.draw(tiles, null, entry);
    const unpaved = tiles.filter((tile) => !this.isPaved(tile, entry));
    if (unpaved.length === 0) return;
    const placements = unpaved.map((tile) => this.placement(tile, slope, z));
    void this.deps.sim.previewPaths(placements).then((pieces) => {
      if (seq !== this.previewSeq) return;
      this.draw(tiles, pieces, entry);
    });
  }

  /** Draws `tiles`; `pieces` answers the unpaved ones in order, or null while still waiting. */
  private draw(tiles: Tile[], pieces: PathPiecePreview[] | null, entry: number | null): void {
    const map = this.deps.sim.map;
    if (!map) return;
    let answer = 0;
    const items: GhostItem[] = tiles.map((tile) => {
      if (this.isPaved(tile, entry)) return { tile, tone: 'paved' };
      const piece = pieces?.[answer++];
      if (!piece) return { tile, tone: 'pending' };
      return { tile, tone: piece.result === PathResult.Ok ? 'ok' : 'refused', piece };
    });
    const rect = this.deps.canvas.getBoundingClientRect();
    this.ghost.show(items, map, this.deps.camera, rect, this.pointer, this.labelFor(items));
    const { style, queue } = this.deps.state;
    this.deps.renderer.setGhosts(pathPieceGhosts(items, map, style, queue));
    const last = items[items.length - 1];
    this.target =
      last?.tone === 'ok' && last.piece
        ? { x: last.tile.x, y: last.tile.y, level: last.piece.z }
        : null;
  }

  /** The label at the cursor: the reason the last tile is refused, or the cost of the buildable ones. */
  private labelFor(items: GhostItem[]): { text: string; tone: 'ok' | 'refused' } | null {
    const last = items[items.length - 1]!;
    if (last.tone === 'pending') return null;
    if (last.tone === 'paved') return { text: 'A footpath is already here.', tone: 'refused' };
    if (last.tone === 'refused')
      return { text: pathRefusalText(last.piece!.result), tone: 'refused' };
    const buildable = items.filter((item) => item.tone === 'ok').length;
    const cost = `${buildable} tile${buildable === 1 ? '' : 's'} · ${formatMoney(buildable * PATH_COST_CENTS)}`;
    const queued = items.filter((item) => item.tone === 'ok' && item.piece?.queue);
    if (queued.length === 0) return { text: cost, tone: 'ok' };
    const link = queued.reduce((bits, item) => bits | item.piece!.link, 0);
    const entrance =
      link & QueueLink.Entrance ? 'links to a ride entrance' : 'no ride entrance yet';
    const openEnd = link & QueueLink.OpenEnd ? 'open end joins the path' : 'open end not on a path';
    return { text: `${cost} · ${entrance} · ${openEnd}`, tone: 'ok' };
  }

  /**
   * Lays the unpaved tiles of `tiles` as one batch. The sim judges them in order, exactly as the
   * ghost did, and skips the ones it cannot place; the status reports what was laid.
   */
  private async lay(tiles: Tile[], slope: number): Promise<void> {
    this.previewSeq++;
    const unpaved = tiles.filter((tile) => !this.isPaved(tile));
    this.hidePreview();
    if (unpaved.length === 0) {
      this.deps.setStatus(
        tiles.length === 1
          ? `A footpath is already at ${tiles[0]!.x}, ${tiles[0]!.y}.`
          : 'This run is already a footpath.',
      );
      return;
    }
    const placements = unpaved.map((tile) => this.placement(tile, slope));
    const pieces = await this.deps.sim.previewPaths(placements);
    const laid = pieces.filter((piece) => piece.result === PathResult.Ok).length;
    const refused = pieces.find((piece) => piece.result !== PathResult.Ok);
    if (laid > 0) this.deps.sim.command({ type: 'placePathRun', placements });
    if (laid === 0) {
      this.deps.setStatus(`No footpath laid: ${pathRefusalText(refused!.result)}`);
      return;
    }
    const skipped = placements.length - laid;
    const count = `${laid} footpath tile${laid === 1 ? '' : 's'}`;
    if (placements.length === 1) {
      const { x, y } = placements[0]!;
      this.deps.setStatus(`Laid footpath at ${x}, ${y} for ${formatMoney(PATH_COST_CENTS)}.`);
      return;
    }
    this.deps.setStatus(
      skipped === 0
        ? `Laid ${count} for ${formatMoney(laid * PATH_COST_CENTS)}.`
        : `Laid ${count}; ${skipped} skipped: ${pathRefusalText(refused!.result)}`,
    );
  }

  private placement(tile: Tile, slope: number, z?: number): PathPlacement {
    const { state } = this.deps;
    return {
      x: tile.x,
      y: tile.y,
      slope,
      style: state.style,
      queue: state.queue,
      ...(z === undefined ? {} : { z }),
    };
  }

  /** The piece the piece-mode controls describe at `tile`, entered at the cursor level. */
  private pieceAt(tile: Tile): PathPlacement {
    const { state } = this.deps;
    return this.placement(
      tile,
      pieceSlope(state.dir, state.slope),
      pieceBase(state.cursorLevel, state.slope),
    );
  }

  /** Height level of the ground of `tile`. */
  private groundLevel(tile: Tile): number {
    const map = this.deps.sim.map!;
    return map.heights[tile.y * map.width + tile.x]!;
  }

  /** The footpath already at `tile` on the level a piece entered at `entry` would use, if any. */
  private existingPath(tile: Tile, entry: number | null): MapPath | null {
    const map = this.deps.sim.map;
    if (!map) return null;
    const level = entry ?? this.groundLevel(tile);
    return pathsAt(map, tile).find((path) => path.base === level) ?? null;
  }

  private existingAtCursor(cursor: Tile): MapPath | null {
    return this.existingPath(cursor, this.deps.state.cursorLevel);
  }

  private isPaved(tile: Tile, entry: number | null = null): boolean {
    return this.existingPath(tile, entry) !== null;
  }

  /**
   * A tap that lands on a tile whose paths all float above the ground sets the cursor at the top
   * one, so building carries on from a raised path; elsewhere the cursor starts on the ground.
   */
  private levelOfTap(tile: Tile): number | null {
    const map = this.deps.sim.map;
    if (!map) return null;
    const paths = pathsAt(map, tile);
    if (paths.length === 0 || paths.some((path) => path.base === this.groundLevel(tile)))
      return null;
    return paths[paths.length - 1]!.base;
  }

  /** Build on a tile that is already a footpath: the cursor moves on from that path's far edge. */
  private continueFrom(cursor: Tile, path: MapPath): void {
    const { state } = this.deps;
    const level = exitLevel(path.base, path.rises, state.dir);
    if (level === null) {
      this.deps.setStatus(
        `The footpath at ${cursor.x}, ${cursor.y} rises sideways, so it cannot continue ${DIRECTION_LABELS[state.dir]}.`,
      );
      return;
    }
    const next = stepCursor(cursor, state.dir);
    state.cursor = next;
    state.cursorLevel = level;
    this.deps.setStatus(
      `Continuing from ${cursor.x}, ${cursor.y}: cursor at ${next.x}, ${next.y}, level ${level}.`,
    );
    this.refreshPiece();
  }
}
