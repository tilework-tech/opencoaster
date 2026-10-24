import type { Command } from '../sim/core/commands';
import { FeedbackDomain } from '../sim/core/feedback';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import type { RideTypeDef } from '../sim/rides/ride-types';
import type { RideState } from '../sim/rides/ride-store';
import { RidePhase } from '../sim/rides/ride-store';
import { Bank, PieceMode, Slope } from '../sim/track/track-types';
import type { TrackPieceDef, TrackResult } from '../sim/track/track-types';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE, decodeCursor } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { ToolMode } from './game-ui';
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

const BUILDABLE_RIDES = Object.values(RIDE_CATALOG).filter(
  (def) => def.category !== 'stall' && def.category !== 'facility',
);

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function rating(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

export class CoasterPanel {
  private readonly root: HTMLElement;
  private readonly rideTypeSelect: HTMLSelectElement;
  private readonly rideSelect: HTMLSelectElement;
  private readonly trackControls: HTMLElement;
  private readonly turnSelect: HTMLSelectElement;
  private readonly slopeSelect: HTMLSelectElement;
  private readonly bankSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly placeButton: HTMLButtonElement;
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

  constructor(
    parent: HTMLElement,
    private readonly actions: CoasterPanelActions,
  ) {
    this.root = document.createElement('aside');
    this.root.className = 'coaster-panel';
    this.root.hidden = true;

    const title = document.createElement('strong');
    title.textContent = 'Rides';
    this.rideTypeSelect = this.select(
      BUILDABLE_RIDES.map((def) => [String(def.id), `${def.name} · ${dollars(def.cost)}`]),
      (value) => {
        this.rideType = Number(value) as RideType;
      },
    );
    this.rideTypeSelect.value = String(RideType.WoodenCoaster);
    const typeRow = this.row('New ride', this.rideTypeSelect);

    this.rideSelect = this.select([], (value) => {
      this.activeRideId = Number(value);
    });
    const rideRow = this.row('Coaster', this.rideSelect);

    this.turnSelect = this.select(
      TURN_LABELS.map(([turn, label]) => [turn, label]),
      (value) => {
        this.choice.turn = value as TurnKind;
      },
    );
    this.slopeSelect = this.select(
      SLOPE_LABELS.map(([slope, label]) => [String(slope), label]),
      (value) => {
        this.choice.slope = Number(value) as Slope;
      },
    );
    this.slopeSelect.value = String(Slope.Flat);
    this.bankSelect = this.select(
      BANK_LABELS.map(([bank, label]) => [String(bank), label]),
      (value) => {
        this.choice.bank = Number(value) as Bank;
      },
    );
    this.bankSelect.value = String(Bank.None);
    this.modeSelect = this.select([], (value) => {
      this.mode = Number(value) as PieceMode;
    });

    this.directionButton = this.button('Start direction: +x', () => {
      this.startDir = (this.startDir + 1) & 3;
    });
    this.placeButton = this.button('Place piece', () => this.placeAtCursor());
    const removeButton = this.button('Remove last', () => this.removeLast());
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
    this.trackControls.append(
      modes,
      this.row('Shape', this.turnSelect),
      this.row('Slope', this.slopeSelect),
      this.row('Bank', this.bankSelect),
      this.row('Drive', this.modeSelect),
      this.directionButton,
      this.costLine,
      this.placeButton,
      removeButton,
      actionsRow,
    );

    this.rideInfo = document.createElement('pre');
    this.rideInfo.className = 'coaster-info';
    this.feedbackLine = document.createElement('div');
    this.feedbackLine.className = 'coaster-feedback';
    this.feedbackLine.setAttribute('role', 'status');

    this.root.append(title, typeRow, rideRow, this.trackControls, this.rideInfo, this.feedbackLine);
    parent.append(this.root);
  }

  get rideType(): RideType {
    return Number(this.rideTypeSelect.value) as RideType;
  }

  set rideType(type: RideType) {
    this.rideTypeSelect.value = String(type);
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
    this.root.hidden = tool !== 'ride' && tool !== 'track';
    this.trackControls.hidden = tool !== 'track';
  }

  setHover(tile: [number, number] | null): void {
    this.hover = tile;
  }

  /** Sends the create command for the selected ride type; selects the new ride on success. */
  createRideAt(x: number, y: number): string {
    const def = RIDE_CATALOG[this.rideType];
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
    const piece = resolvePiece(cursor, this.choice);
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
    return { piece, placement, level, status };
  }

  update(): void {
    const snapshot = this.actions.snapshot();
    if (!snapshot || this.root.hidden) return;
    this.refreshRides(snapshot);
    this.consumeFeedback(snapshot);
    const ride = this.activeRide();
    this.refreshControls(ride, snapshot);
    this.rideInfo.textContent = ride ? this.describeRide(ride) : 'No coaster selected.';
  }

  dispose(): void {
    this.root.remove();
  }

  private place(ride: RideSummary): string {
    const map = this.actions.map();
    const info = this.infoAt(ride);
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    const piece = resolvePiece(cursor, this.choice);
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
    this.rides = rides;
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
    if (this.awaitingCreate && feedback.domain === FeedbackDomain.Ride) {
      this.awaitingCreate = false;
      if (feedback.code === 0 && feedback.subject >= 0) {
        this.activeRideId = feedback.subject;
        this.refreshRides(snapshot);
        this.actions.selectTool('track');
      }
    }
  }

  private refreshControls(ride: RideSummary | undefined, snapshot: Snapshot): void {
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.buildMode));
    }
    this.directionButton.textContent = `Start direction: ${['+x', '+y', '-x', '-y'][this.startDir]}`;
    if (!ride) {
      this.costLine.textContent = '';
      this.placeButton.disabled = true;
      return;
    }
    const info = this.infoAt(ride);
    const closed = (info[RideInfo.Flags] & RideFlag.CircuitClosed) !== 0;
    const cursor = decodeCursor(info[RideInfo.Cursor]);
    this.directionButton.hidden = cursor.hasTrack;
    const piece = resolvePiece(cursor, this.choice);
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
      ? 'Circuit complete. Remove a piece to change the layout.'
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

  private button(label: string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', click);
    return button;
  }
}
