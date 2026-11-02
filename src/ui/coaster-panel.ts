import type { Command } from '../sim/core/commands';
import { TRACK_STEPS_PER_LEVEL } from '../sim/core/constants';
import { MAX_TRACK_LEVEL } from '../sim/track/track-store';
import { FeedbackDomain } from '../sim/core/feedback';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import type { RideTypeDef } from '../sim/rides/ride-types';
import { RidePhase } from '../sim/rides/ride-store';
import { Bank, PieceMode, Slope } from '../sim/track/track-types';
import { TrackResult } from '../sim/track/track-types';
import type { TrackPieceDef } from '../sim/track/track-types';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE, decodeCursor } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { ToolMode } from './ui-types';
import { element as el } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import type { UiWindow, WindowManager } from './window-manager';
import {
  BANK_LABELS,
  MODE_LABELS,
  SLOPE_LABELS,
  TURN_LABELS,
  allowedModes,
  feedbackMessage,
  previewStatus,
  resolvePiece,
} from './track-tool';
import type { PieceChoice, Placement, TurnKind } from './track-tool';
import { PIECES } from '../sim/track/catalog';
import { pieceExit } from '../sim/track/construction';
import { RideState } from '../sim/rides/ride-store';
import {
  buildPointAt,
  neighbourPiece,
  openEnds,
  resolveBuild,
  sectionPosition,
  snapshotPiece,
} from './track-selection';
import type { BuildEnd, BuildPoint, SnapshotPiece } from './track-selection';

export interface CoasterPanelActions {
  command(command: Command): void;
  selectTool(tool: ToolMode): void;
  /** Latest published snapshot; read on demand because consumed snapshots are recycled. */
  snapshot(): Snapshot | null;
  map(): PanelMap | null;
  /** Shows a line in the tool status area. */
  status(text: string): void;
}

/** What the track tool would place right now, for the hover preview. */
export interface TrackGhost {
  rideType: RideType;
  piece: TrackPieceDef;
  placement: Placement;
  /** Placement height in land levels; track sits on half levels too (e.g. 1.5). */
  level: number;
  status: TrackResult;
}

type BuildMode = 'track' | 'entrance' | 'exit';

/** The piece picked in the construction window; `signature` catches a reused id. */
interface Selection {
  rideId: number;
  pieceId: number;
  signature: string;
}

function signatureOf(piece: SnapshotPiece): string {
  return `${piece.pieceType}:${piece.x}:${piece.y}:${piece.z}:${piece.dir}`;
}

/** Short player-facing name of a placed piece: its shape, slope and drive mode. */
export function pieceLabel(piece: SnapshotPiece): string {
  const def = PIECES[piece.pieceType];
  const shape = TURN_LABELS.find(([turn]) => turn === def?.shape)?.[1] ?? def?.name ?? 'Track';
  const slope =
    def && (def.entrySlope !== Slope.Flat || def.exitSlope !== Slope.Flat)
      ? SLOPE_LABELS.find(([value]) => value === (def.exitSlope || def.entrySlope))?.[1]
      : undefined;
  const mode = piece.mode !== PieceMode.Normal ? MODE_LABELS[piece.mode as PieceMode] : undefined;
  return [shape, slope, mode].filter(Boolean).join(' · ');
}

/** The parts of the map data the panel reads. */
export interface PanelMap {
  width: number;
  height: number;
  heights: Uint8Array;
}

interface RideSummary {
  id: number;
  type: RideType;
  def: RideTypeDef;
  index: number;
}

const STATE_NAMES = ['Closed', 'Open', 'Testing', 'Broken'] as const;
const PHASE_NAMES: Record<number, string> = {
  [RidePhase.Closed]: 'closed',
  [RidePhase.Waiting]: 'waiting for guests',
  [RidePhase.Running]: 'train out',
  [RidePhase.Unloading]: 'unloading',
  [RidePhase.Broken]: 'broken down',
  [RidePhase.Loading]: 'loading',
};

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function rating(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

const TURN_ICONS: Record<string, IconName> = {
  straight: 'straight',
  smallLeft: 'curveLeftSmall',
  mediumLeft: 'curveLeftMedium',
  largeLeft: 'curveLeftLarge',
  smallRight: 'curveRightSmall',
  mediumRight: 'curveRightMedium',
  largeRight: 'curveRightLarge',
};
const SLOPE_ICONS: Record<number, IconName> = {
  [Slope.Down60]: 'slopeDownSteep',
  [Slope.Down25]: 'slopeDown',
  [Slope.Flat]: 'slopeLevel',
  [Slope.Up25]: 'slopeUp',
  [Slope.Up60]: 'slopeUpSteep',
};
const BANK_ICONS: Record<number, IconName> = {
  [Bank.Left]: 'bankLeft',
  [Bank.None]: 'bankNone',
  [Bank.Right]: 'bankRight',
};
const MAIN_TURNS: readonly TurnKind[] = [
  'smallLeft',
  'mediumLeft',
  'largeLeft',
  'straight',
  'smallRight',
  'mediumRight',
  'largeRight',
];
const SPECIAL_TURNS = TURN_LABELS.filter(([turn]) => !MAIN_TURNS.includes(turn));

/** RCT2-style circuit wording, kept apart from the ride's Open/Closed status. */
export function circuitLabel(flags: number): string {
  if (flags & RideFlag.CircuitComplete) return 'Circuit complete';
  return flags & RideFlag.CircuitClosed ? 'Circuit incomplete (no station)' : 'Circuit incomplete';
}

export class CoasterPanel {
  private readonly root: HTMLElement;
  private window: UiWindow | null = null;
  private readonly specialSelect: HTMLSelectElement;
  private readonly turnButtons = new Map<TurnKind, HTMLButtonElement>();
  private readonly slopeButtons = new Map<Slope, HTMLButtonElement>();
  private readonly bankButtons = new Map<Bank, HTMLButtonElement>();
  private readonly rideSelect: HTMLSelectElement;
  private readonly trackControls: HTMLElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly placeButton: HTMLButtonElement;
  private rideTypeValue: RideType = RideType.WoodenCoaster;
  private readonly directionButton: HTMLButtonElement;
  private readonly startHeightRow: HTMLElement;
  private readonly startHeightLabel: HTMLElement;
  private readonly heightLine: HTMLElement;
  private readonly modeButtons = new Map<BuildMode, HTMLButtonElement>();
  private readonly costLine: HTMLElement;
  private readonly rideInfo: HTMLElement;
  private readonly feedbackLine: HTMLElement;
  private readonly selectionLine: HTMLElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly trackEndButton: HTMLButtonElement;
  private readonly buildBeforeButton: HTMLButtonElement;
  private readonly removeButton: HTMLButtonElement;

  private tool: ToolMode = 'select';
  private buildMode: BuildMode = 'track';
  private choice: PieceChoice = { turn: 'station', slope: Slope.Flat, bank: Bank.None };
  private mode: PieceMode = PieceMode.Normal;
  private startDir = 0;
  /** Land levels the first piece sits above the ground under it, for the ride it was set on. */
  private startRaise = 0;
  private startRaiseRide = -1;
  private rides: RideSummary[] = [];
  private activeRideId = -1;
  private hover: [number, number] | null = null;
  private lastFeedbackSeq = 0;
  private awaitingCreate = false;
  private rideCount = 0;
  private selection: Selection | null = null;
  private buildEnd: BuildEnd = 'after';
  /** A placement sent from the selection: select the new piece once it appears beside `from`. */
  private pendingFollow: { from: number; end: BuildEnd } | null = null;
  /** A removal of the selected piece: select a neighbour once it is gone. */
  private pendingRemoval: { pieceId: number; prev: number; next: number } | null = null;

  constructor(
    private readonly windows: WindowManager,
    private readonly actions: CoasterPanelActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'coaster-panel';

    this.rideSelect = this.select([], (value) => {
      this.activeRideId = Number(value);
    });
    const rideRow = this.row('Coaster', this.rideSelect);

    const turns = el('div', 'build-grid turn-grid');
    for (const turn of MAIN_TURNS) {
      const label = TURN_LABELS.find(([t]) => t === turn)?.[1] ?? turn;
      const b = this.glyphButton(TURN_ICONS[turn], label, () => (this.choice.turn = turn));
      this.turnButtons.set(turn, b);
      turns.append(b);
    }
    this.specialSelect = this.select(
      [['', 'Special elements…'], ...SPECIAL_TURNS.map(([turn, label]) => [turn, label] as const)],
      (value) => {
        if (value) this.choice.turn = value as TurnKind;
      },
    );
    this.specialSelect.setAttribute('aria-label', 'Special elements');
    const slopes = el('div', 'build-grid');
    for (const [slope, label] of SLOPE_LABELS) {
      const b = this.glyphButton(SLOPE_ICONS[slope], label, () => (this.choice.slope = slope));
      this.slopeButtons.set(slope, b);
      slopes.append(b);
    }
    const banks = el('div', 'build-grid');
    for (const [bank, label] of BANK_LABELS) {
      const b = this.glyphButton(BANK_ICONS[bank], label, () => (this.choice.bank = bank));
      this.bankButtons.set(bank, b);
      banks.append(b);
    }
    this.modeSelect = this.select([], (value) => {
      this.mode = Number(value) as PieceMode;
    });

    this.directionButton = this.button('Start direction: +x', () => {
      this.startDir = (this.startDir + 1) & 3;
    });
    this.startHeightLabel = document.createElement('span');
    this.startHeightRow = document.createElement('div');
    this.startHeightRow.className = 'coaster-row';
    this.startHeightRow.append(
      this.button('Lower start', () => (this.startRaise = Math.max(0, this.startRaise - 1))),
      this.startHeightLabel,
      this.button(
        'Raise start',
        () => (this.startRaise = Math.min(this.maxStartRaise(), this.startRaise + 1)),
      ),
    );
    this.heightLine = document.createElement('div');
    this.heightLine.className = 'coaster-height';
    this.placeButton = this.button('Build piece', () => this.placeAtCursor());
    this.placeButton.classList.add('primary');
    this.removeButton = this.button('Demolish last piece', () => this.removeLast());
    this.selectionLine = el('div', 'coaster-selection-line');
    this.previousButton = this.button('Previous piece', () => this.step('previous'));
    this.nextButton = this.button('Next piece', () => this.step('next'));
    this.trackEndButton = this.button('Track end', () => this.clearSelection());
    this.trackEndButton.title = 'Build and demolish at the end of the track again';
    this.buildBeforeButton = this.button('Build before this piece', () => {
      this.buildEnd = this.buildEnd === 'before' ? 'after' : 'before';
    });
    const selectionRow = el('div', 'coaster-row');
    selectionRow.append(this.previousButton, this.nextButton, this.trackEndButton);
    const selection = el('div', 'coaster-selection');
    selection.append(this.selectionLine, selectionRow, this.buildBeforeButton);
    this.costLine = document.createElement('div');
    this.costLine.className = 'coaster-cost';

    const modes = document.createElement('div');
    modes.className = 'coaster-row';
    for (const [mode, label] of [
      ['track', 'Track'],
      ['entrance', 'Entrance'],
      ['exit', 'Exit'],
    ] as const) {
      const button = this.button(label, () => {
        this.buildMode = mode;
      });
      this.modeButtons.set(mode, button);
      modes.append(button);
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'coaster-row';
    actionsRow.append(
      this.button('Test', () => this.setStatus('test')),
      this.button('Open', () => this.setStatus('open')),
      this.button('Close', () => this.setStatus('close')),
    );

    this.trackControls = document.createElement('div');
    this.trackControls.className = 'coaster-section';
    const buildRow = document.createElement('div');
    buildRow.className = 'coaster-row';
    buildRow.append(this.placeButton, this.removeButton);
    this.trackControls.append(
      selection,
      turns,
      this.specialSelect,
      slopes,
      banks,
      this.row('Drive', this.modeSelect),
      this.directionButton,
      this.startHeightRow,
      this.heightLine,
      this.costLine,
      buildRow,
    );

    this.rideInfo = document.createElement('pre');
    this.rideInfo.className = 'coaster-info';
    this.feedbackLine = document.createElement('div');
    this.feedbackLine.className = 'coaster-feedback';
    this.feedbackLine.setAttribute('role', 'status');

    this.root.append(
      rideRow,
      modes,
      this.trackControls,
      actionsRow,
      this.rideInfo,
      this.feedbackLine,
    );
  }

  get rideType(): RideType {
    return this.rideTypeValue;
  }

  set rideType(type: RideType) {
    this.rideTypeValue = type;
  }

  /** Shows the construction window while the track tool is active and hides it otherwise. */
  setTool(tool: ToolMode): void {
    this.tool = tool;
    if (tool === 'track' && !this.window) {
      const { window: win } = this.windows.open({
        id: 'construction',
        title: 'Ride construction',
        kind: 'build',
        width: 320,
        onClose: () => {
          this.window = null;
          if (this.tool === 'track') this.actions.selectTool('select');
        },
      });
      win.pane().append(this.root);
      this.window = win;
      this.windows.close('ride-select');
    } else if (tool !== 'track' && this.window) {
      const win = this.window;
      this.window = null;
      this.windows.close(win.spec.id);
    }
  }

  /** Makes a track ride the one the construction controls act on. */
  setActiveRide(rideId: number): void {
    if (rideId !== this.activeRideId) this.clearSelection();
    this.activeRideId = rideId;
  }

  /**
   * Selects a placed piece to edit from. Selecting never changes the track: it only picks where
   * Build piece and Demolish act. Returns the status line.
   */
  selectPiece(rideId: number, pieceId: number): string {
    const snapshot = this.actions.snapshot();
    if (snapshot) this.refreshRides(snapshot);
    const piece = snapshot ? snapshotPiece(snapshot, pieceId) : null;
    if (!snapshot || !piece || piece.rideId !== rideId) return 'That track piece no longer exists.';
    if (!this.rides.some((ride) => ride.id === rideId))
      return 'Only ride track can be edited here.';
    this.activeRideId = rideId;
    this.rideSelect.value = String(rideId);
    this.buildMode = 'track';
    this.focusPiece(piece);
    const position = sectionPosition(snapshot, pieceId);
    return `Selected ${pieceLabel(piece)}, piece ${position.index + 1} of ${position.count}.`;
  }

  /** True while the construction controls build track (not an entrance or exit). */
  buildsTrack(): boolean {
    return this.buildMode === 'track';
  }

  /** The selected piece, for highlighting, while the construction window is open. */
  selectedPiece(): { rideId: number; pieceId: number } | null {
    return this.window && this.tool === 'track' && this.selection
      ? { rideId: this.selection.rideId, pieceId: this.selection.pieceId }
      : null;
  }

  /** Goes back to building and demolishing at the end of the track. */
  clearSelection(): void {
    this.selection = null;
    this.buildEnd = 'after';
    this.pendingFollow = null;
    this.pendingRemoval = null;
  }

  private focusPiece(piece: SnapshotPiece): void {
    this.selection = { rideId: piece.rideId, pieceId: piece.id, signature: signatureOf(piece) };
    this.pendingFollow = null;
    this.pendingRemoval = null;
    if (!openEnds(piece).includes(this.buildEnd)) this.buildEnd = 'after';
  }

  private selected(): SnapshotPiece | null {
    const snapshot = this.actions.snapshot();
    if (!this.selection || !snapshot) return null;
    const piece = snapshotPiece(snapshot, this.selection.pieceId);
    return piece && piece.rideId === this.selection.rideId ? piece : null;
  }

  /** Moves the selection one piece along the track; with nothing selected, picks the last piece. */
  private step(direction: 'previous' | 'next'): void {
    const snapshot = this.actions.snapshot();
    const ride = this.activeRide();
    if (!snapshot || !ride) return;
    const current = this.selected();
    const id = current
      ? neighbourPiece(snapshot, current.id, direction)
      : direction === 'previous'
        ? this.lastPieceId(ride)
        : -1;
    const piece = id >= 0 ? snapshotPiece(snapshot, id) : null;
    if (piece) this.actions.status(this.selectPiece(ride.id, piece.id));
  }

  /** The piece whose exit is the construction cursor: the end of the section being built. */
  private lastPieceId(ride: RideSummary): number {
    const snapshot = this.actions.snapshot();
    const info = this.infoAt(ride);
    if (!snapshot || !decodeCursor(info[RideInfo.Cursor]).hasTrack) return -1;
    for (let row = 0; row < snapshot.tracks.count; row++) {
      const piece = snapshotPiece(snapshot, snapshot.trackLinks[row * 3]);
      if (!piece || piece.rideId !== ride.id) continue;
      const exit = pieceExit(piece.pieceType, piece.x, piece.y, piece.z, piece.dir);
      if (
        exit.x === info[RideInfo.CursorX] &&
        exit.y === info[RideInfo.CursorY] &&
        exit.z === info[RideInfo.CursorZ]
      )
        return piece.id;
    }
    return -1;
  }

  /** Where the selection builds: its chosen open end, or null when that end is already joined. */
  private selectionBuildPoint(): BuildPoint | null {
    const piece = this.selected();
    if (!piece || !openEnds(piece).includes(this.buildEnd)) return null;
    return buildPointAt(piece, this.buildEnd);
  }

  /** Follows a placement or removal made from the selection, and drops a stale selection. */
  private reconcileSelection(snapshot: Snapshot): void {
    const selection = this.selection;
    if (!selection) return;
    const piece = snapshotPiece(snapshot, selection.pieceId);
    const alive =
      piece && piece.rideId === selection.rideId && signatureOf(piece) === selection.signature;
    const removal = this.pendingRemoval;
    if (removal && !alive) {
      const neighbour = [removal.prev, removal.next]
        .map((id) => (id >= 0 ? snapshotPiece(snapshot, id) : null))
        .find((p) => p && p.rideId === selection.rideId);
      if (neighbour) this.focusPiece(neighbour);
      else this.clearSelection();
      return;
    }
    const follow = this.pendingFollow;
    if (follow && piece && alive) {
      const id = follow.end === 'after' ? piece.next : piece.prev;
      const added = id >= 0 ? snapshotPiece(snapshot, id) : null;
      if (added) {
        const ride = this.activeRide();
        if (ride && this.infoAt(ride)[RideInfo.Flags] & RideFlag.CircuitClosed) {
          this.clearSelection();
          return;
        }
        const end = follow.end;
        this.focusPiece(added);
        if (openEnds(added).includes(end)) this.buildEnd = end;
        return;
      }
    }
    if (!alive) {
      this.clearSelection();
      this.feedbackLine.textContent =
        'The selected piece is gone; building from the end of the track.';
      this.feedbackLine.dataset.ok = 'false';
    }
  }

  setHover(tile: [number, number] | null): void {
    this.hover = tile;
  }

  boardingPlacement(): { rideId: number; part: 'entrance' | 'exit' } | null {
    const ride = this.activeRide();
    return ride && (this.buildMode === 'entrance' || this.buildMode === 'exit')
      ? { rideId: ride.id, part: this.buildMode }
      : null;
  }

  /** Sends the create command for the selected ride type; selects the new ride on success. */
  createRideAt(x: number, y: number, dir = 0, towerHeight?: number): string {
    const def = RIDE_CATALOG[this.rideType];
    this.hover = [x, y];
    this.awaitingCreate = true;
    this.actions.command({
      type: 'createRide',
      rideType: this.rideType,
      x,
      y,
      dir,
      ...(towerHeight === undefined ? {} : { towerHeight }),
    });
    return `Building ${def.name} at ${x}, ${y}…`;
  }

  /** Handles a map click while the track tool is active; returns the status line. */
  handleTileClick(x: number, y: number): string {
    const ride = this.activeRide();
    if (!ride) return 'Select or build a coaster first (Ride tool).';
    if (this.buildMode !== 'track') {
      this.actions.command({
        type: this.buildMode === 'entrance' ? 'placeRideEntrance' : 'placeRideExit',
        rideId: ride.id,
        x,
        y,
      });
      return `Placing ${this.buildMode} at ${x}, ${y}…`;
    }
    this.hover = [x, y];
    return this.place(ride);
  }

  placeAtCursor(): void {
    const ride = this.activeRide();
    if (ride && this.buildMode === 'track') this.place(ride);
  }

  /** Demolishes the selected piece, or the last piece of the track when nothing is selected. */
  removeLast(): void {
    const ride = this.activeRide();
    if (!ride) return;
    const piece = this.selected();
    if (piece) this.pendingRemoval = { pieceId: piece.id, prev: piece.prev, next: piece.next };
    this.actions.command({ type: 'removeTrack', rideId: ride.id, pieceId: piece ? piece.id : -1 });
  }

  /** The piece the controls resolve to for the active ride, with its target placement. */
  ghost(): TrackGhost | null {
    const ride = this.activeRide();
    const snap = this.actions.snapshot();
    const map = this.actions.map();
    if (!ride || !snap || !map || this.tool !== 'track' || this.buildMode !== 'track') return null;
    const info = this.infoAt(ride);
    let placement: Placement;
    let level: number;
    let piece: TrackPieceDef | undefined;
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    if (this.selection) {
      const point = this.selectionBuildPoint();
      const build = point && resolveBuild(point, this.choice, ride.type);
      if (!build) return null;
      piece = build.piece;
      placement = { x: build.placement.x, y: build.placement.y, dir: build.placement.dir };
      level = build.placement.z / TRACK_STEPS_PER_LEVEL;
    } else if (info[RideInfo.Flags] & RideFlag.CircuitClosed) {
      return null;
    } else if (!(piece = resolvePiece(cursor, this.choice, ride.type))) {
      return null;
    } else if (cursor.hasTrack) {
      placement = { x: info[RideInfo.CursorX], y: info[RideInfo.CursorY], dir: cursor.dir };
      level = info[RideInfo.CursorZ] / TRACK_STEPS_PER_LEVEL;
    } else if (this.hover) {
      placement = { x: this.hover[0], y: this.hover[1], dir: this.startDir };
      level = map.heights[this.hover[1] * map.width + this.hover[0]] + this.startRaise;
    } else {
      return null;
    }
    const status = previewStatus(
      map,
      snap.buildable,
      piece!,
      placement,
      snap.park.cash,
      level,
      snap.occupancies,
      ride.type,
      snap.scenario.restrictions.maxConstructionHeight,
    );
    return { rideType: ride.type, piece: piece!, placement, level, status };
  }

  update(): void {
    const snapshot = this.actions.snapshot();
    if (!snapshot) return;
    this.refreshRides(snapshot);
    this.consumeFeedback(snapshot);
    this.reconcileSelection(snapshot);
    if (!this.window) return;
    const ride = this.activeRide();
    this.refreshControls(ride, snapshot);
    this.showPreviewRefusal();
    this.rideInfo.textContent = ride ? this.describeRide(ride) : 'No coaster selected.';
  }

  /** Explains a tunnel refusal the build preview shows, before the player tries to build. */
  private showPreviewRefusal(): void {
    const ghost = this.ghost();
    if (ghost?.status !== TrackResult.TunnelEntry) return;
    this.feedbackLine.textContent = feedbackMessage(FeedbackDomain.Track, ghost.status).text;
    this.feedbackLine.dataset.ok = 'false';
  }

  dispose(): void {
    this.root.remove();
    if (this.window) this.windows.close(this.window.spec.id);
  }

  private place(ride: RideSummary): string {
    if (this.selection) return this.placeAtSelection(ride);
    const map = this.actions.map();
    const info = this.infoAt(ride);
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    const piece = resolvePiece(cursor, this.choice, ride.type);
    if (!piece) return 'No track piece matches those controls.';
    let command: Command;
    if (cursor.hasTrack) {
      command = {
        type: 'placeTrack',
        rideId: ride.id,
        pieceType: piece.id,
        x: info[RideInfo.CursorX],
        y: info[RideInfo.CursorY],
        z: info[RideInfo.CursorZ],
        dir: cursor.dir,
        mode: this.mode,
      };
    } else {
      if (!this.hover || !map) return 'Click a tile to start the track.';
      const [x, y] = this.hover;
      command = {
        type: 'placeTrack',
        rideId: ride.id,
        pieceType: piece.id,
        x,
        y,
        z: (map.heights[y * map.width + x] + this.startRaise) * TRACK_STEPS_PER_LEVEL,
        dir: this.startDir,
        mode: this.mode,
      };
    }
    this.actions.command(command);
    return `Placing ${piece.name} (${dollars(piece.cost)})…`;
  }

  private placeAtSelection(ride: RideSummary): string {
    const piece = this.selected();
    const point = this.selectionBuildPoint();
    if (!piece || !point)
      return 'The selected piece is joined on both sides. Demolish it, or pick an open end with Previous piece or Next piece.';
    const build = resolveBuild(point, this.choice, ride.type);
    if (!build) return 'No track piece matches those controls.';
    this.pendingFollow = { from: piece.id, end: point.end };
    this.actions.command({
      type: 'placeTrack',
      rideId: ride.id,
      pieceType: build.piece.id,
      ...build.placement,
      mode: this.mode,
    });
    return `Placing ${build.piece.name} (${dollars(build.piece.cost)})…`;
  }

  private setStatus(status: 'open' | 'close' | 'test'): void {
    const ride = this.activeRide();
    if (ride) this.actions.command({ type: 'setRideStatus', rideId: ride.id, status });
  }

  /** The ride type's height limit, in land levels, bounds how far the start can be raised. */
  private maxStartRaise(): number {
    return this.activeRide()?.def.trackRules?.maxLevel ?? MAX_TRACK_LEVEL;
  }

  private activeRide(): RideSummary | undefined {
    return this.rides.find((ride) => ride.id === this.activeRideId);
  }

  private infoAt(ride: RideSummary): Int32Array {
    const info =
      this.actions.snapshot()?.rideInfo ?? new Int32Array(RIDE_INFO_STRIDE * (ride.index + 1));
    return info.subarray(ride.index * RIDE_INFO_STRIDE, (ride.index + 1) * RIDE_INFO_STRIDE);
  }

  private refreshRides(snapshot: Snapshot): void {
    const rides: RideSummary[] = [];
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
      const def = RIDE_CATALOG[type];
      if (def?.usesTrack)
        rides.push({ id: snapshot.rideInfo[o + RideInfo.Id], type, def, index: i });
    }
    const key = rides.map((ride) => `${ride.id}:${ride.def.name}`).join('|');
    if (key !== this.rides.map((ride) => `${ride.id}:${ride.def.name}`).join('|')) {
      this.rideSelect.replaceChildren(
        ...rides.map((ride) => new Option(`${ride.def.name} ${ride.id + 1}`, String(ride.id))),
      );
    }
    const created = this.awaitingCreate
      ? rides.find((ride) => !this.rides.some((known) => known.id === ride.id))
      : undefined;
    if (snapshot.rides.count !== this.rideCount) this.awaitingCreate = false;
    this.rideCount = snapshot.rides.count;
    this.rides = rides;
    if (created) {
      this.activeRideId = created.id;
      this.actions.selectTool('track');
    }
    if (!rides.some((ride) => ride.id === this.activeRideId)) {
      this.activeRideId = rides.length > 0 ? rides[rides.length - 1].id : -1;
    }
    if (this.activeRideId >= 0) this.rideSelect.value = String(this.activeRideId);
  }

  private consumeFeedback(snapshot: Snapshot): void {
    const feedback = snapshot.feedback;
    if (feedback.seq === this.lastFeedbackSeq) return;
    this.lastFeedbackSeq = feedback.seq;
    if (feedback.domain !== FeedbackDomain.Track && feedback.domain !== FeedbackDomain.Ride) return;
    const line = feedbackMessage(feedback.domain, feedback.code, feedback.detail);
    this.feedbackLine.textContent = line.text;
    this.feedbackLine.dataset.ok = String(line.ok);
    this.actions.status(line.text);
    if (!line.ok) {
      this.awaitingCreate = false;
      this.pendingFollow = null;
      this.pendingRemoval = null;
    }
  }

  private refreshControls(ride: RideSummary | undefined, snapshot: Snapshot): void {
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.buildMode));
    }
    for (const [turn, button] of this.turnButtons)
      button.setAttribute('aria-pressed', String(turn === this.choice.turn));
    for (const [slope, button] of this.slopeButtons)
      button.setAttribute('aria-pressed', String(slope === this.choice.slope));
    for (const [bank, button] of this.bankButtons)
      button.setAttribute('aria-pressed', String(bank === this.choice.bank));
    this.specialSelect.value = MAIN_TURNS.includes(this.choice.turn) ? '' : this.choice.turn;
    this.directionButton.textContent = `Start direction: ${['+x', '+y', '-x', '-y'][this.startDir]}`;
    this.refreshSelectionControls(ride, snapshot);
    if (!ride) {
      this.costLine.textContent = '';
      this.placeButton.disabled = true;
      return;
    }
    const info = this.infoAt(ride);
    const flags = info[RideInfo.Flags];
    const closed = (flags & RideFlag.CircuitClosed) !== 0;
    const hasEntrance = (flags & RideFlag.EntrancePlaced) !== 0;
    const hasExit = (flags & RideFlag.ExitPlaced) !== 0;
    const tested = (flags & RideFlag.Tested) !== 0;
    if (closed && !hasEntrance && this.buildMode !== 'entrance') {
      this.buildMode = 'entrance';
      this.actions.status('Circuit complete. Place entrance next to the station.');
    } else if (closed && hasEntrance && !hasExit && this.buildMode !== 'exit') {
      this.buildMode = 'exit';
      this.actions.status('Place exit next to the station.');
    } else if (closed && hasEntrance && hasExit && !tested && this.buildMode !== 'track') {
      this.buildMode = 'track';
      this.actions.status(
        flags & RideFlag.QueueConnected
          ? 'Test ride to finish setup.'
          : 'Test ride to finish setup, and build its queue from the ride window (Build queue).',
      );
    } else if (closed && hasEntrance && hasExit && tested && this.buildMode !== 'track') {
      this.buildMode = 'track';
      this.actions.status('Ride setup complete.');
    }
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    this.directionButton.hidden = cursor.hasTrack;
    this.startHeightRow.hidden = cursor.hasTrack;
    if (this.startRaiseRide !== ride.id) {
      this.startRaiseRide = ride.id;
      this.startRaise = 0;
    }
    this.startHeightLabel.textContent =
      this.startRaise === 0 ? 'Start on the ground' : `Start ${this.startRaise} above ground`;
    const point = this.selection ? this.selectionBuildPoint() : null;
    const build = point ? resolveBuild(point, this.choice, ride.type) : undefined;
    this.heightLine.textContent = point
      ? `Building ${point.end} the selected piece at height ${point.z / TRACK_STEPS_PER_LEVEL}`
      : this.selection
        ? ''
        : cursor.hasTrack
          ? `Track end at height ${info[RideInfo.CursorZ] / TRACK_STEPS_PER_LEVEL}`
          : '';
    const piece = this.selection ? build?.piece : resolvePiece(cursor, this.choice, ride.type);
    this.placeButton.disabled = !piece || (closed && !this.selection);
    const modes = piece ? allowedModes(piece, ride.type) : [PieceMode.Normal];
    const current = this.modeSelect.dataset.options;
    if (current !== modes.join(',')) {
      this.modeSelect.dataset.options = modes.join(',');
      this.modeSelect.replaceChildren(
        ...modes.map((mode) => new Option(MODE_LABELS[mode], String(mode))),
      );
    }
    if (!modes.includes(this.mode)) this.mode = PieceMode.Normal;
    this.modeSelect.value = String(this.mode);
    const busy =
      info[RideInfo.State] === RideState.Open ||
      info[RideInfo.State] === RideState.Testing ||
      info[RideInfo.Phase] === RidePhase.Loading ||
      info[RideInfo.Phase] === RidePhase.Running ||
      info[RideInfo.Phase] === RidePhase.Unloading;
    const selected = this.selected();
    this.costLine.textContent = busy
      ? 'Close the ride and wait for its train to return before changing the track.'
      : selected && !point
        ? openEnds(selected).length === 0
          ? 'This piece is joined on both sides: demolish it to rebuild this section.'
          : 'Press Build before this piece to extend the track backward from here.'
        : closed && !this.selection
          ? !hasEntrance
            ? 'Circuit complete. Place an entrance next to the station.'
            : !hasExit
              ? 'Place an exit next to the station.'
              : !tested
                ? 'Test the ride before opening it.'
                : 'Circuit complete. Remove a piece to change the layout.'
          : piece
            ? `${circuitLabel(flags)}. ${piece.name}: ${dollars(piece.cost)} of ${dollars(snapshot.park.cash)} cash`
            : 'No piece fits those controls here.';
  }

  private refreshSelectionControls(ride: RideSummary | undefined, snapshot: Snapshot): void {
    const piece = this.selected();
    const hasTrack =
      ride !== undefined && decodeCursor(this.infoAt(ride)[RideInfo.Cursor]).hasTrack;
    if (piece) {
      const position = sectionPosition(snapshot, piece.id);
      this.selectionLine.textContent = `Selected piece ${position.index + 1} of ${position.count} · ${pieceLabel(piece)}`;
    } else {
      this.selectionLine.textContent = hasTrack
        ? 'Building from the end of the track. Click a piece of track to edit from it.'
        : 'Building from the end of the track.';
    }
    this.previousButton.disabled = piece ? piece.prev < 0 : !hasTrack;
    this.nextButton.disabled = !piece || piece.next < 0;
    this.trackEndButton.disabled = !piece;
    this.buildBeforeButton.hidden = !piece || !openEnds(piece).includes('before');
    this.buildBeforeButton.setAttribute('aria-pressed', String(this.buildEnd === 'before'));
    this.removeButton.textContent = piece ? 'Demolish selected piece' : 'Demolish last piece';
  }

  private describeRide(ride: RideSummary): string {
    const o = ride.index * RIDE_INFO_STRIDE;
    const info = this.actions.snapshot()!.rideInfo;
    const flags = info[o + RideInfo.Flags];
    const tested = (flags & RideFlag.Tested) !== 0;
    const state = STATE_NAMES[info[o + RideInfo.State] as RideState] ?? 'Unknown';
    const ratings = tested
      ? `Excitement ${rating(info[o + RideInfo.Excitement])}\nIntensity  ${rating(info[o + RideInfo.Intensity])}\nNausea     ${rating(info[o + RideInfo.Nausea])}`
      : 'Ratings: run a test';
    return [
      `${ride.def.name} ${ride.id + 1} · ${state}, ${PHASE_NAMES[info[o + RideInfo.Phase]] ?? ''}`,
      `Track ${info[o + RideInfo.TrackPieces]} pieces · ${circuitLabel(flags)}`,
      `Entrance ${flags & RideFlag.EntrancePlaced ? 'yes' : 'no'} · Exit ${flags & RideFlag.ExitPlaced ? 'yes' : 'no'} · Queue ${flags & RideFlag.QueueConnected ? 'linked' : 'not linked'}`,
      `Waiting ${info[o + RideInfo.QueueLength]} · Served ${info[o + RideInfo.GuestsServed]}`,
      ratings,
    ].join('\n');
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'coaster-row';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(text, control);
    return row;
  }

  private select(
    options: ReadonlyArray<readonly [string, string]>,
    change: (value: string) => void,
  ): HTMLSelectElement {
    const select = document.createElement('select');
    for (const [value, label] of options) select.append(new Option(label, value));
    select.addEventListener('change', () => change(select.value));
    return select;
  }

  private glyphButton(name: IconName, label: string, click: () => void): HTMLButtonElement {
    const button = this.button('', click);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.classList.add('glyph-button');
    button.append(icon(name, 16));
    return button;
  }

  private button(label: string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', click);
    return button;
  }
}
