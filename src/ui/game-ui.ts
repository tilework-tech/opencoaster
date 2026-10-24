import type { Snapshot } from '../worker/snapshot';
import type { Stats } from '../worker/protocol';
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
}

export interface GuestSelection {
  details: string;
  tick: number;
}

export function guestSelectionText(details: string, tick: number): string {
  return `Selection at tick ${tick}\n${details}`;
}

const TOOL_LABELS: Record<ToolMode, string> = {
  select: 'Select',
  land: 'Land',
  path: 'Path',
  bin: 'Bin',
  bench: 'Bench',
  shelter: 'Shelter',
  flowerbed: 'Flower bed',
  ride: 'Ride',
  track: 'Coaster',
  patrol: 'Patrol area',
};

export class GameUI {
  private readonly toolbar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly panels = new Map<string, { root: HTMLElement; body: HTMLElement }>();
  private paused = false;
  private tool: ToolMode = 'select';
  private staffRoster: StaffRoster | null = null;

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
    );
    this.toolbar.append(windows);
    parent.append(this.toolbar, this.status, this.objective);
    this.chooseTool('select');
  }

  update(
    snapshot: Snapshot | null,
    stats: Stats | null,
    selectedGuest: GuestSelection | null,
  ): void {
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

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
