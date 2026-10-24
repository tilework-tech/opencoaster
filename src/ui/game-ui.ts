import type { Snapshot } from '../worker/snapshot';
import type { Stats } from '../worker/protocol';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import { MAX_CARS, MAX_TRAINS_PER_RIDE } from '../sim/vehicles/ride-trains';
import { financePanelText } from './hud';
import { objectiveLines } from './objective';
import { StaffRoster } from './staff-roster';

export type ToolMode =
  | 'select'
  | 'land'
  | 'path'
  | 'bin'
  | 'bench'
  | 'shelter'
  | 'flowerbed'
  | 'lamp'
  | 'ride'
  | 'track'
  | 'patrol';

export interface GameUIActions {
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  rotate(direction: -1 | 1): void;
  setTool(tool: ToolMode): void;
  spawnGuests(): void;
  openMenu(): void;
  hireStaff(kind: number): void;
  setPatrolKind(kind: number | null): void;
  renameStaff(staffId: number, name: string): void;
  fireStaff(staffId: number): void;
  setRidePrice(rideId: number, priceCents: number): void;
  setRideTrains(rideId: number, trains: number, cars: number): void;
  setRideStatus(rideId: number, status: 'open' | 'close'): void;
  placeRidePart(rideId: number, part: 'entrance' | 'exit'): void;
}

export interface GuestSelection {
  details: string;
  tick: number;
}

export interface GuestDetails {
  happiness: number;
  hunger: number;
  thirst: number;
  toilet: number;
  nausea: number;
  energy: number;
  cash: number;
  thoughts: readonly number[];
}

const THOUGHT_LABELS: readonly string[] = [
  'No thought',
  'Hungry',
  'Thirsty',
  'Needs the toilet',
  'Feeling nauseous',
  'Ride is too intense',
  'Ride enjoyed',
  'Queue is too long',
  'Leaving the park',
];

export function guestDetailsText(details: GuestDetails): string {
  const thoughts = details.thoughts
    .filter((thought) => thought > 0)
    .map((thought) => THOUGHT_LABELS[thought] ?? `Thought ${thought}`);
  return [
    `Happiness  ${details.happiness}`,
    `Hunger  ${details.hunger}`,
    `Thirst  ${details.thirst}`,
    `Toilet  ${details.toilet}`,
    `Nausea  ${details.nausea}`,
    `Energy  ${details.energy}`,
    `Cash  $${(details.cash / 100).toFixed(2)}`,
    'Thoughts',
    ...(thoughts.length ? thoughts : ['No recent thoughts']),
  ].join('\n');
}

export function guestSelectionText(details: string, tick: number): string {
  return `Selection at tick ${tick}\n${details}`;
}

export interface RideOption {
  value: string;
  label: string;
}

export function rideOptionsChanged(
  current: readonly RideOption[],
  next: readonly RideOption[],
): boolean {
  return (
    current.length !== next.length ||
    current.some(
      (option, index) => option.value !== next[index]?.value || option.label !== next[index]?.label,
    )
  );
}

const TOOL_LABELS: Record<ToolMode, string> = {
  select: 'Select',
  land: 'Land',
  path: 'Path',
  bin: 'Bin',
  bench: 'Bench',
  shelter: 'Shelter',
  flowerbed: 'Flower bed',
  lamp: 'Lamp',
  ride: 'Ride',
  track: 'Coaster',
  patrol: 'Patrol area',
};

export class GameUI {
  private readonly toolbar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly weatherOverlay: HTMLElement;
  private readonly panels = new Map<string, { root: HTMLElement; body: HTMLElement }>();
  private paused = false;
  private tool: ToolMode = 'select';
  private staffRoster: StaffRoster | null = null;
  private rideSelect: HTMLSelectElement | null = null;
  private ridePrice: HTMLInputElement | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly actions: GameUIActions,
  ) {
    this.toolbar = document.createElement('nav');
    this.toolbar.className = 'game-toolbar';
    this.toolbar.setAttribute('aria-label', 'Park controls');
    this.status = document.createElement('output');
    this.status.className = 'tool-status';
    this.objective = document.createElement('div');
    this.objective.className = 'objective-strip';
    this.objective.hidden = true;
    this.weatherOverlay = document.createElement('div');
    this.weatherOverlay.className = 'weather-overlay weather-sunny';
    this.weatherOverlay.setAttribute('aria-hidden', 'true');

    this.toolbar.append(
      this.button('Pause', () => this.togglePause(), 'pause'),
      this.button('1×', () => actions.setSpeed(1), 'speed-1'),
      this.button('2×', () => actions.setSpeed(2), 'speed-2'),
      this.button('4×', () => actions.setSpeed(4), 'speed-4'),
      this.button('↶', () => actions.rotate(-1), 'rotate-left'),
      this.button('↷', () => actions.rotate(1), 'rotate-right'),
      this.button('Guests +1,000', actions.spawnGuests, 'spawn-guests'),
    );

    const tools = document.createElement('div');
    tools.className = 'tool-group';
    for (const tool of [
      'select',
      'land',
      'path',
      'bin',
      'bench',
      'shelter',
      'flowerbed',
      'lamp',
      'ride',
      'track',
      'patrol',
    ] as ToolMode[]) {
      const button = this.button(TOOL_LABELS[tool], () => this.chooseTool(tool), `tool-${tool}`);
      button.setAttribute('aria-pressed', String(tool === 'select'));
      tools.append(button);
    }
    this.toolbar.append(tools);

    const windows = document.createElement('div');
    windows.className = 'window-tools';
    windows.append(
      this.button('Park', () => this.togglePanel('park', 'Park overview'), 'open-park'),
      this.button('Finances', () => this.togglePanel('finance', 'Finances'), 'open-finance'),
      this.button('Menu', actions.openMenu, 'open-menu'),
      this.button('Guests', () => this.togglePanel('guests', 'Guest information'), 'open-guests'),
      this.button('Staff', () => this.toggleStaffPanel(), 'open-staff'),
      this.button('Rides', () => this.toggleRidePanel(), 'open-rides'),
    );
    this.toolbar.append(windows);
    parent.append(this.toolbar, this.status, this.objective, this.weatherOverlay);
    this.chooseTool('select');
  }

  update(
    snapshot: Snapshot | null,
    stats: Stats | null,
    selectedGuest: GuestSelection | null,
  ): void {
    const weather = snapshot?.weather.kind ?? 0;
    const weatherClass = `weather-${['sunny', 'cloudy', 'rain', 'storm'][weather] ?? 'sunny'}`;
    if (!this.weatherOverlay.classList.contains(weatherClass))
      this.weatherOverlay.className = `weather-overlay ${weatherClass}`;
    const lines = snapshot
      ? objectiveLines(snapshot.scenario, snapshot.park.loan, snapshot.tick)
      : [];
    this.objective.hidden = lines.length === 0;
    setText(this.objective, lines.join('\n'));
    const park = this.panels.get('park');
    if (park) {
      setText(
        park.body,
        snapshot
          ? `Guests  ${stats?.guests ?? snapshot.guests.count}\nRides  ${snapshot.park.rides}\nSimulation tick  ${snapshot.tick}\nPark rating  ${snapshot.scenario.parkRating}`
          : 'Waiting for the simulation snapshot…',
      );
    }
    const finance = this.panels.get('finance');
    if (finance) {
      setText(
        finance.body,
        snapshot ? financePanelText(snapshot) : 'Waiting for the simulation snapshot…',
      );
    }
    const guests = this.panels.get('guests');
    if (guests) {
      setText(
        guests.body,
        (selectedGuest && guestSelectionText(selectedGuest.details, selectedGuest.tick)) ??
          `Guests in park  ${stats?.guests ?? 0}\nSelect a guest in the park to inspect them.`,
      );
    }
    const rides = this.panels.get('rides');
    if (rides && snapshot) {
      const selection = this.rideSelect;
      const ids = Array.from({ length: snapshot.rides.count }, (_, i) => {
        const o = i * RIDE_INFO_STRIDE;
        return {
          id: snapshot.rideInfo[o + RideInfo.Id],
          index: i,
          type: snapshot.rideInfo[o + RideInfo.Type],
        };
      });
      const options = ids.map(({ id, type }) => ({
        value: String(id),
        label: `${typeName(type)} #${id}`,
      }));
      const previousId = selection?.value;
      if (
        selection &&
        rideOptionsChanged(
          Array.from(selection.options, (option) => ({ value: option.value, label: option.text })),
          options,
        )
      ) {
        selection.replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
        if (options.some((option) => option.value === previousId)) selection.value = previousId!;
      }
      const selectedId = Number(selection?.value ?? ids[0]?.id ?? -1);
      const index = ids.find((ride) => ride.id === selectedId)?.index ?? ids[0]?.index;
      if (index === undefined) {
        setText(rides.body, 'No rides have been built yet.');
      } else {
        const o = index * RIDE_INFO_STRIDE;
        const info = snapshot.rideInfo;
        if (this.ridePrice && document.activeElement !== this.ridePrice)
          this.ridePrice.value = String(info[o + RideInfo.Price] / 100);
        setText(
          rides.body,
          `${typeName(info[o + RideInfo.Type])} #${selectedId}\nStatus  ${['Closed', 'Open', 'Testing', 'Broken'][info[o + RideInfo.State]]}\nExcitement  ${(info[o + RideInfo.Excitement] / 100).toFixed(2)}\nIntensity  ${(info[o + RideInfo.Intensity] / 100).toFixed(2)}\nNausea  ${(info[o + RideInfo.Nausea] / 100).toFixed(2)}\nQueue  ${info[o + RideInfo.QueueLength]}\nIncome  $${(info[o + RideInfo.IncomeCents] / 100).toFixed(2)}\nReliability  ${info[o + RideInfo.Reliability]}%`,
        );
      }
    }
    const staff = this.panels.get('staff');
    if (staff)
      setText(
        staff.body,
        `Staff employed  ${snapshot?.staff.count ?? 0}\nSelect a role below to hire staff. Patrol tools apply to the selected role or person.`,
      );
    this.staffRoster?.update(snapshot);
  }

  /** Switches tools as if the player had pressed the toolbar button. */
  selectTool(tool: ToolMode): void {
    this.chooseTool(tool);
  }

  get selectedTool(): ToolMode {
    return this.tool;
  }

  setToolStatus(message: string): void {
    this.status.textContent = message;
  }

  openGuestPanel(): void {
    if (!this.panels.has('guests')) this.togglePanel('guests', 'Guest information');
  }

  togglePause(): void {
    this.syncPaused(!this.paused);
    this.actions.setPaused(this.paused);
  }

  /** Shows the pause state without sending it, for state restored from settings. */
  syncPaused(paused: boolean): void {
    this.paused = paused;
    this.label('pause', this.paused ? 'Resume' : 'Pause');
  }

  dispose(): void {
    this.toolbar.remove();
    this.status.remove();
    this.objective.remove();
    this.weatherOverlay.remove();
    for (const panel of this.panels.values()) panel.root.remove();
    this.panels.clear();
  }

  private chooseTool(tool: ToolMode): void {
    this.tool = tool;
    this.actions.setTool(tool);
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    }
    this.status.textContent =
      tool === 'select'
        ? 'Select a guest or tile. Drag to pan; wheel to zoom.'
        : tool === 'land'
          ? 'Land tool selected. Click to raise; Shift-click to lower.'
          : tool === 'patrol'
            ? 'Patrol tool selected. Click tiles to add them; Shift-click to remove them.'
            : `${TOOL_LABELS[tool]} tool selected. Click a tile to place.`;
  }

  private togglePanel(id: string, title: string): void {
    const existing = this.panels.get(id);
    if (existing) {
      existing.root.remove();
      this.panels.delete(id);
      if (id === 'staff') this.staffRoster = null;
      return;
    }
    const root = document.createElement('section');
    root.className = 'info-window';
    root.dataset.panel = id;
    const heading = document.createElement('header');
    const label = document.createElement('strong');
    label.textContent = title;
    const close = this.button('×', () => this.togglePanel(id, title), `close-${id}`);
    close.setAttribute('aria-label', `Close ${title}`);
    heading.append(label, close);
    const body = document.createElement('pre');
    body.className = 'panel-content';
    body.textContent = 'Waiting for the simulation snapshot…';
    root.append(heading, body);
    this.parent.append(root);
    this.panels.set(id, { root, body });
  }

  private toggleStaffPanel(): void {
    if (this.panels.has('staff')) {
      this.togglePanel('staff', 'Staff');
      return;
    }
    this.togglePanel('staff', 'Staff');
    const panel = this.panels.get('staff');
    if (!panel) return;
    const controls = document.createElement('div');
    controls.className = 'staff-controls';
    ['Handyman', 'Mechanic', 'Security', 'Entertainer'].forEach((name, kind) => {
      controls.append(
        this.button(`Hire ${name}`, () => this.actions.hireStaff(kind), `hire-staff-${kind}`),
        this.button(
          `Patrol ${name}`,
          () => {
            this.actions.setPatrolKind(kind);
            this.chooseTool('patrol');
          },
          `patrol-staff-${kind}`,
        ),
      );
    });
    panel.root.append(controls);
    this.staffRoster = new StaffRoster(panel.root, {
      rename: (staffId, name) => this.actions.renameStaff(staffId, name),
      patrol: (kind) => {
        this.actions.setPatrolKind(kind);
        this.chooseTool('patrol');
      },
      fire: (staffId) => this.actions.fireStaff(staffId),
    });
  }

  private toggleRidePanel(): void {
    if (this.panels.has('rides')) {
      this.togglePanel('rides', 'Ride information');
      this.rideSelect = null;
      this.ridePrice = null;
      return;
    }
    this.togglePanel('rides', 'Ride information');
    const panel = this.panels.get('rides');
    if (!panel) return;
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Select ride');
    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.max = '655.35';
    price.step = '0.01';
    price.setAttribute('aria-label', 'Ride or stall price');
    const setPrice = this.button(
      'Set price',
      () => {
        const id = Number(select.value);
        const cents = Math.round(Number(price.value) * 100);
        if (Number.isInteger(id) && Number.isSafeInteger(cents) && cents >= 0 && cents <= 65535)
          this.actions.setRidePrice(id, cents);
      },
      'set-ride-price',
    );
    const trains = document.createElement('input');
    trains.type = 'number';
    trains.min = '0';
    trains.max = String(MAX_TRAINS_PER_RIDE);
    trains.step = '1';
    trains.value = '0';
    trains.setAttribute('aria-label', 'Trains on the track (0 for automatic)');
    const cars = document.createElement('input');
    cars.type = 'number';
    cars.min = '0';
    cars.max = String(MAX_CARS);
    cars.step = '1';
    cars.value = '0';
    cars.setAttribute('aria-label', 'Cars per train (0 for default)');
    const setTrains = this.button(
      'Set trains',
      () =>
        this.actions.setRideTrains(Number(select.value), Number(trains.value), Number(cars.value)),
      'set-ride-trains',
    );
    const status = document.createElement('div');
    status.className = 'ride-controls';
    status.append(
      this.button(
        'Place entrance',
        () => this.actions.placeRidePart(Number(select.value), 'entrance'),
        'place-ride-entrance',
      ),
      this.button(
        'Place exit',
        () => this.actions.placeRidePart(Number(select.value), 'exit'),
        'place-ride-exit',
      ),
      this.button(
        'Open ride',
        () => this.actions.setRideStatus(Number(select.value), 'open'),
        'open-ride',
      ),
      this.button(
        'Close ride',
        () => this.actions.setRideStatus(Number(select.value), 'close'),
        'close-ride',
      ),
    );
    panel.root.insertBefore(select, panel.body);
    panel.root.insertBefore(price, panel.body);
    panel.root.insertBefore(setPrice, panel.body);
    panel.root.insertBefore(trains, panel.body);
    panel.root.insertBefore(cars, panel.body);
    panel.root.insertBefore(setTrains, panel.body);
    panel.root.insertBefore(status, panel.body);
    this.rideSelect = select;
    this.ridePrice = price;
  }

  private button(label: string, click: () => void, id: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = id;
    if (id.startsWith('tool-')) button.dataset.tool = id.slice(5);
    button.addEventListener('click', click);
    return button;
  }

  private label(id: string, text: string): void {
    const button = this.toolbar.querySelector<HTMLButtonElement>(`[data-action="${id}"]`);
    if (button) button.textContent = text;
  }
}

function typeName(type: number): string {
  return RIDE_CATALOG[type as keyof typeof RIDE_CATALOG]?.name ?? 'Ride';
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
