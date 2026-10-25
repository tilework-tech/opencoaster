import type { Command } from '../sim/core/commands';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import type { RideTypeDef } from '../sim/rides/ride-types';
import type { RideState } from '../sim/rides/ride-store';
import { RidePhase } from '../sim/rides/ride-store';
import { Bank, PieceMode, Slope } from '../sim/track/track-types';
import type { TrackPieceDef, TrackResult } from '../sim/track/track-types';
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
  /** Placement height in height levels. */
  level: number;
  status: TrackResult;
}

type BuildMode = 'track' | 'entrance' | 'exit';

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
  private readonly modeButtons = new Map<BuildMode, HTMLButtonElement>();
  private readonly costLine: HTMLElement;
  private readonly rideInfo: HTMLElement;
  private readonly feedbackLine: HTMLElement;

  private tool: ToolMode = 'select';
  private buildMode: BuildMode = 'track';
  private choice: PieceChoice = { turn: 'station', slope: Slope.Flat, bank: Bank.None };
  private mode: PieceMode = PieceMode.Normal;
  private startDir = 0;
  private rides: RideSummary[] = [];
  private activeRideId = -1;
  private hover: [number, number] | null = null;
  private lastFeedbackSeq = 0;
  private awaitingCreate = false;
  private rideCount = 0;

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
    this.placeButton = this.button('Build piece', () => this.placeAtCursor());
    this.placeButton.classList.add('primary');
    const removeButton = this.button('Demolish last piece', () => this.removeLast());
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
    buildRow.append(this.placeButton, removeButton);
    this.trackControls.append(
      turns,
      this.specialSelect,
      slopes,
      banks,
      this.row('Drive', this.modeSelect),
      this.directionButton,
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
    this.activeRideId = rideId;
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
  createRideAt(x: number, y: number): string {
    const def = RIDE_CATALOG[this.rideType];
    this.hover = [x, y];
    this.awaitingCreate = true;
    this.actions.command({ type: 'createRide', rideType: this.rideType, x, y });
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

  removeLast(): void {
    const ride = this.activeRide();
    if (ride) this.actions.command({ type: 'removeTrack', rideId: ride.id, pieceId: -1 });
  }

  /** The piece the controls resolve to for the active ride, with its target placement. */
  ghost(): TrackGhost | null {
    const ride = this.activeRide();
    const snap = this.actions.snapshot();
    const map = this.actions.map();
    if (!ride || !snap || !map || this.tool !== 'track' || this.buildMode !== 'track') return null;
    const info = this.infoAt(ride);
    if (info[RideInfo.Flags] & RideFlag.CircuitClosed) return null;
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    const piece = resolvePiece(cursor, this.choice, ride.type);
    if (!piece) return null;
    let placement: Placement;
    let level: number;
    if (cursor.hasTrack) {
      placement = { x: info[RideInfo.CursorX], y: info[RideInfo.CursorY], dir: cursor.dir };
      level = info[RideInfo.CursorZ];
    } else if (this.hover) {
      placement = { x: this.hover[0], y: this.hover[1], dir: this.startDir };
      level = map.heights[this.hover[1] * map.width + this.hover[0]];
    } else {
      return null;
    }
    const status = previewStatus(map, snap.buildable, piece, placement, snap.park.cash);
    return { rideType: ride.type, piece, placement, level, status };
  }

  update(): void {
    const snapshot = this.actions.snapshot();
    if (!snapshot) return;
    this.refreshRides(snapshot);
    this.consumeFeedback(snapshot);
    if (!this.window) return;
    const ride = this.activeRide();
    this.refreshControls(ride, snapshot);
    this.rideInfo.textContent = ride ? this.describeRide(ride) : 'No coaster selected.';
  }

  dispose(): void {
    this.root.remove();
    if (this.window) this.windows.close(this.window.spec.id);
  }

  private place(ride: RideSummary): string {
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
        z: map.heights[y * map.width + x],
        dir: this.startDir,
        mode: this.mode,
      };
    }
    this.actions.command(command);
    return `Placing ${piece.name} (${dollars(piece.cost)})…`;
  }

  private setStatus(status: 'open' | 'close' | 'test'): void {
    const ride = this.activeRide();
    if (ride) this.actions.command({ type: 'setRideStatus', rideId: ride.id, status });
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
        ...rides.map((ride) => new Option(`${ride.def.name} #${ride.id}`, String(ride.id))),
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
    const line = feedbackMessage(feedback.domain, feedback.code);
    this.feedbackLine.textContent = line.text;
    this.feedbackLine.dataset.ok = String(line.ok);
    this.actions.status(line.text);
    if (!line.ok) this.awaitingCreate = false;
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
      this.actions.status('Place entrance next to the station.');
    } else if (closed && hasEntrance && !hasExit && this.buildMode !== 'exit') {
      this.buildMode = 'exit';
      this.actions.status('Place exit next to the station.');
    } else if (closed && hasEntrance && hasExit && !tested && this.buildMode !== 'track') {
      this.buildMode = 'track';
      this.actions.status('Test ride to finish setup.');
    } else if (closed && hasEntrance && hasExit && tested && this.buildMode !== 'track') {
      this.buildMode = 'track';
      this.actions.status('Ride setup complete.');
    }
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    this.directionButton.hidden = cursor.hasTrack;
    const piece = resolvePiece(cursor, this.choice, ride.type);
    this.placeButton.disabled = !piece || closed;
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
    this.costLine.textContent = closed
      ? !hasEntrance
        ? 'Circuit complete. Place an entrance next to the station.'
        : !hasExit
          ? 'Place an exit next to the station.'
          : !tested
            ? 'Test the ride before opening it.'
            : 'Circuit complete. Remove a piece to change the layout.'
      : piece
        ? `${piece.name}: ${dollars(piece.cost)} of ${dollars(snapshot.park.cash)} cash`
        : 'No piece fits those controls here.';
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
      `${ride.def.name} #${ride.id} · ${state}, ${PHASE_NAMES[info[o + RideInfo.Phase]] ?? ''}`,
      `Track ${info[o + RideInfo.TrackPieces]} pieces, ${flags & RideFlag.CircuitClosed ? 'closed circuit' : 'open'}`,
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
    button.append(icon(name));
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
