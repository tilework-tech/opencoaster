import type { Stats } from '../worker/protocol';
import type { Snapshot } from '../worker/snapshot';
import { LedgerCategory } from '../sim/economy/ledger';
import { button, element } from './dom';
import { SampleSeries } from './format';
import { icon } from './icons';
import { NewsTracker } from './news';
import type { NewsItem } from './news';
import { MessageQueue, filterMessages } from './messages';
import type { MessageCategory } from './messages';
import { objectiveLines } from './objective';
import { StatusBar } from './status-bar';
import { BUILD_SPEED_CAP, effectiveGameSpeed } from './window-layout';
import { Toolbar } from './toolbar';
import type { ToolbarItem } from './toolbar';
import { GAME_SPEEDS } from './settings';
import type { GameSpeed } from './settings';
import { STAFF_KIND_NAMES } from './staff-roster';
import type {
  GameUIActions,
  GuestSelection,
  ToolMode,
  UiContext,
  WindowController,
} from './ui-types';
import type { WindowManager } from './window-manager';
import { openFinanceWindow } from './windows/finance-window';
import { openGuestWindow, openIndividualGuestWindow } from './windows/guest-window';
import { openLandRightsWindow } from './windows/land-rights-window';
import { openMapWindow } from './windows/map-window';
import { openNewsWindow } from './windows/news-window';
import { openParkWindow } from './windows/park-window';
import { openResearchWindow } from './windows/research-window';
import { openRideList } from './windows/ride-list';
import { openRideSelect } from './windows/ride-select';
import { openRideWindow } from './windows/ride-window';
import { openStaffWindow } from './windows/staff-window';
import { openWorkerWindow } from './windows/worker-window';
import { SCENERY_WINDOW, openToolWindow } from './windows/tool-windows';
import { openLandWindow } from './windows/land-window';
import { openClearWindow, openWaterWindow } from './windows/area-windows';
import { openPathWindow } from './windows/path-window';
import { shortcutFor } from './shortcuts';
import type { KeyLike } from './shortcuts';

export type { FootpathControls, GameUIActions, GuestSelection, ToolMode } from './ui-types';
export { guestDetailsText, guestSelectionText } from './windows/guest-window';
export type { GuestDetails } from './windows/guest-window';

/** Speed as shown to the player, e.g. "4× (2× while building)". */
function speedLabel(speed: GameSpeed): string {
  return speed > BUILD_SPEED_CAP ? `${speed}× (${BUILD_SPEED_CAP}× while building)` : `${speed}×`;
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
  scenery: 'Scenery',
  bin: 'Bin',
  bench: 'Bench',
  shelter: 'Shelter',
  flowerbed: 'Flower bed',
  lamp: 'Lamp',
  ride: 'Ride',
  track: 'Coaster',
  'buy-land': 'Buy land',
  'buy-rights': 'Buy construction rights',
  patrol: 'Patrol area',
  clear: 'Clear scenery',
  water: 'Water',
};

/** Windows that arm a map tool; only one of them is open at a time. */
const CONSTRUCTION_WINDOWS = [
  'land',
  'water',
  'scenery',
  'paths',
  'clear',
  'ride-select',
  'land-rights',
];

const SERIES_INTERVAL_TICKS = 160;
const SERIES_LENGTH = 120;

/** The park interface: toolbar, status bar, ticker and every floating window. */
export class GameUI {
  private readonly toolbar: Toolbar;
  private readonly statusBar: StatusBar;
  private readonly status: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly weatherOverlay: HTMLElement;
  private readonly controllers = new Map<string, WindowController>();
  private news = new NewsTracker();
  private readonly messages = new MessageQueue<NewsItem>();
  private readonly series = {
    cash: new SampleSeries(SERIES_LENGTH, SERIES_INTERVAL_TICKS),
    value: new SampleSeries(SERIES_LENGTH, SERIES_INTERVAL_TICKS),
    profit: new SampleSeries(SERIES_LENGTH, SERIES_INTERVAL_TICKS),
    guests: new SampleSeries(SERIES_LENGTH, SERIES_INTERVAL_TICKS),
  };
  private readonly ctx: UiContext;
  private paused = false;
  private tool: ToolMode = 'select';
  private patrolKind: number | null = null;
  private selectedGuest: GuestSelection | null = null;
  /** The speed the player chose. The sim runs at `speed`, which building can cap lower. */
  private requestedSpeed: GameSpeed = 1;
  private speed = 1;
  private readonly speedGroup: HTMLElement;
  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private readonly speedNote: HTMLElement;

  constructor(
    private readonly parent: HTMLElement,
    private readonly windows: WindowManager,
    private readonly actions: GameUIActions,
  ) {
    this.ctx = {
      windows,
      actions: {
        ...actions,
        setPatrolKind: (kind) => {
          this.patrolKind = kind;
          actions.setPatrolKind(kind);
        },
      },
      selectedGuest: () => this.selectedGuest,
      series: this.series,
      openRide: (id) => this.openRide(id),
      openGuest: (id) => this.openWindow(`guest-${id}`),
      openWorker: (id) => this.openWindow(`worker-${id}`),
      openWindow: (id) => this.openWindow(id),
      chooseTool: (tool) => this.chooseTool(tool),
      currentTool: () => this.tool,
    };
    this.status = element('output', 'tool-status');
    this.objective = element('div', 'objective-strip');
    this.objective.hidden = true;
    this.weatherOverlay = element('div', 'weather-overlay weather-sunny');
    this.weatherOverlay.setAttribute('aria-hidden', 'true');

    const open = (id: string) => () => this.toggleWindow(id);
    this.speedGroup = element('div', 'toolbar-speed');
    this.speedGroup.setAttribute('role', 'group');
    this.speedGroup.setAttribute('aria-label', 'Game speed');
    this.speedNote = element(
      'span',
      'toolbar-speed-note',
      `Max ${BUILD_SPEED_CAP}× while building`,
    );
    for (const speed of GAME_SPEEDS) {
      const b = element('button', 'toolbar-button toolbar-speed-button', `${speed}×`);
      b.type = 'button';
      b.title = `Game speed ${speedLabel(speed)} (key ${speed})`;
      b.setAttribute('aria-label', `Game speed ${speed}×`);
      b.addEventListener('click', () => this.setSpeed(speed));
      this.speedButtons.set(speed, b);
      this.speedGroup.append(b);
    }
    this.speedGroup.append(this.speedNote);
    const left: ToolbarItem[] = [
      { id: 'pause', icon: 'pause', label: 'Pause', onClick: () => this.togglePause() },
      { id: 'speed', control: this.speedGroup },
      { id: 'options', icon: 'options', label: 'Game options', onClick: open('options') },
      { id: 'zoom-out', icon: 'zoomOut', label: 'Zoom out', onClick: () => actions.zoom(-1) },
      { id: 'zoom-in', icon: 'zoomIn', label: 'Zoom in', onClick: () => actions.zoom(1) },
      {
        id: 'rotate-clockwise',
        icon: 'rotateRight',
        label: 'Rotate clockwise',
        caption: 'Enter / Z',
        tooltip: 'Rotate clockwise (Enter or Z)',
        onClick: () => actions.rotate(1),
      },
      {
        id: 'rotate-anticlockwise',
        icon: 'rotateLeft',
        label: 'Rotate anticlockwise',
        caption: 'Shift+Enter / X',
        tooltip: 'Rotate anticlockwise (Shift+Enter or X)',
        onClick: () => actions.rotate(-1),
      },
      { id: 'view', icon: 'view', label: 'View options', onClick: open('view') },
      { id: 'map', icon: 'map', label: 'Map', onClick: open('map') },
    ];
    const right: ToolbarItem[] = [
      { id: 'clear', icon: 'demolish', label: 'Clear scenery', onClick: open('clear') },
      { id: 'land', icon: 'land', label: 'Land', onClick: open('land') },
      { id: 'water', icon: 'water', label: 'Water', onClick: open('water') },
      { id: 'scenery', icon: 'scenery', label: 'Scenery', onClick: open('scenery') },
      { id: 'paths', icon: 'paths', label: 'Footpaths', onClick: open('paths') },
      { id: 'ride-select', icon: 'rides', label: 'New ride', onClick: open('ride-select') },
      { id: 'finance', icon: 'finances', label: 'Finances', onClick: open('finance') },
      { id: 'research', icon: 'research', label: 'Research', onClick: open('research') },
      { id: 'ride-list', icon: 'wheel', label: 'Rides', onClick: open('ride-list') },
      { id: 'park', icon: 'park', label: 'Park', onClick: open('park') },
      { id: 'staff', icon: 'staff', label: 'Staff', onClick: open('staff') },
      { id: 'guests', icon: 'guests', label: 'Guests', onClick: open('guests') },
      { id: 'news', icon: 'news', label: 'Messages', onClick: open('news') },
      {
        id: 'save-load',
        icon: 'options',
        label: 'Save / Load',
        onClick: () => actions.openMenu(),
      },
    ];
    this.toolbar = new Toolbar(parent, left, right);
    this.statusBar = new StatusBar(parent, {
      openFinance: () => this.openWindow('finance'),
      openGuests: () => this.openWindow('guests'),
      openPark: () => this.openWindow('park'),
      openNews: () => this.openWindow('news'),
      followNews: (item) => this.followNews(item),
      dismissMessage: () => this.dismissMessage(),
    });
    parent.append(this.status, this.objective, this.weatherOverlay);
    this.statusBar.setMessage(null);
    this.chooseTool('select');
  }

  update(
    snapshot: Snapshot | null,
    stats: Stats | null,
    selectedGuest: GuestSelection | null,
  ): void {
    this.selectedGuest = selectedGuest;
    const weather = snapshot?.weather.kind ?? 0;
    const weatherClass = `weather-${['sunny', 'cloudy', 'rain', 'storm'][weather] ?? 'sunny'}`;
    if (!this.weatherOverlay.classList.contains(weatherClass))
      this.weatherOverlay.className = `weather-overlay ${weatherClass}`;
    const lines = snapshot
      ? objectiveLines(snapshot.scenario, snapshot.park.loan, snapshot.tick)
      : [];
    this.objective.hidden = lines.length === 0;
    const objectiveText = lines.join('\n');
    if (this.objective.textContent !== objectiveText) this.objective.textContent = objectiveText;
    const now = performance.now();
    if (snapshot) {
      const fresh = filterMessages(this.news.observe(snapshot), this.actions.messageFilter());
      for (const item of fresh) this.messages.enqueue(item, now);
      if (fresh.length > 0) this.actions.playUiSound('news');
      let profit = 0;
      for (let c = 0; c < LedgerCategory.COUNT; c++) profit += snapshot.economy.thisMonth[c];
      this.series.cash.record(snapshot.tick, snapshot.park.cash - snapshot.park.loan);
      this.series.value.record(snapshot.tick, snapshot.economy.parkValue);
      this.series.profit.record(snapshot.tick, profit);
      this.series.guests.record(snapshot.tick, stats?.guests ?? snapshot.guests.count);
    }
    this.statusBar.setMessage(this.messages.current(now));
    this.statusBar.update(snapshot, stats);

    for (const [id, controller] of this.controllers) {
      if (!this.windows.get(id)) this.controllers.delete(id);
      else controller.update(snapshot, stats);
    }
    for (const button of this.toolbarWindowIds())
      this.toolbar.setPressed(button, !!this.windows.get(button));
  }

  /** Switches tools as if the player had pressed the toolbar button. */
  selectTool(tool: ToolMode): void {
    if (tool === 'ride') this.closeConstruction();
    this.chooseTool(tool);
  }

  get selectedTool(): ToolMode {
    return this.tool;
  }

  setToolStatus(message: string): void {
    this.status.textContent = message;
  }

  openGuestPanel(): void {
    if (this.selectedGuest) this.openWindow(`guest-${this.selectedGuest.id}`);
    else this.openWindow('guests');
  }

  /** New games open the Park window; loaded games keep an empty desktop. */
  onGameStart(openPark: boolean): void {
    this.closeAllWindows();
    this.controllers.clear();
    this.selectedGuest = null;
    this.news = new NewsTracker();
    this.messages.clear();
    this.statusBar.setMessage(null);
    this.chooseTool('select');
    if (openPark) this.openWindow('park');
  }

  togglePause(): void {
    this.syncPaused(!this.paused);
    this.actions.setPaused(this.paused);
  }

  /** Shows the pause state without sending it, for state restored from settings. */
  syncPaused(paused: boolean): void {
    this.paused = paused;
    this.toolbar.relabel('pause', paused ? 'Resume' : 'Pause', icon(paused ? 'play' : 'pause'));
  }

  /** Shows the speed restored from settings without sending it. */
  syncSpeed(speed: GameSpeed): void {
    this.requestedSpeed = speed;
    this.speed = speed;
    this.syncSpeedControls();
  }

  /** Sets the speed the player asked for. Choosing a speed while paused also resumes the sim. */
  setSpeed(requested: GameSpeed): void {
    this.requestedSpeed = requested;
    if (this.paused) this.togglePause();
    this.applySpeed();
  }

  private stepSpeed(direction: 1 | -1): void {
    const index = GAME_SPEEDS.indexOf(this.requestedSpeed);
    const next = Math.max(0, Math.min(GAME_SPEEDS.length - 1, index + direction));
    this.setSpeed(GAME_SPEEDS[next]);
  }

  /** Applies the requested speed, capped while track is being built, and refreshes every speed control. */
  private applySpeed(): void {
    const effective = effectiveGameSpeed(this.requestedSpeed, this.tool === 'track');
    if (effective !== this.speed) {
      this.speed = effective;
      this.actions.setSpeed(effective);
    }
    this.syncSpeedControls();
  }

  private syncSpeedControls(): void {
    const capped = this.requestedSpeed !== this.speed;
    this.speedGroup.classList.toggle('capped', capped);
    this.speedNote.hidden = !capped;
    for (const [speed, b] of this.speedButtons)
      b.setAttribute('aria-pressed', String(speed === this.speed));
  }

  syncRotation(rotation: number): void {
    this.toolbar.setRotation(rotation);
  }

  /** Runs a default keyboard shortcut; returns true when the key was handled. */
  handleShortcut(event: KeyLike): boolean {
    const action = shortcutFor(event);
    if (!action) return false;
    switch (action.type) {
      case 'closeTop':
        return this.closeTopWindow();
      case 'closeAll':
        this.closeAllWindows();
        return true;
      case 'cancel':
        this.closeConstruction();
        this.chooseTool('select');
        return true;
      case 'pause':
        this.togglePause();
        this.setToolStatus(this.paused ? 'Simulation paused.' : 'Simulation resumed.');
        return true;
      case 'speed':
        this.setSpeed(action.speed as GameSpeed);
        return true;
      case 'speedStep':
        this.stepSpeed(action.direction);
        return true;
      case 'rotate':
        this.actions.rotate(action.direction);
        return true;
      case 'rotatePiece':
        this.actions.rotatePiece();
        return true;
      case 'zoom':
        this.actions.zoom(action.direction);
        return true;
      case 'window':
        this.toggleWindow(action.id);
        return true;
    }
  }

  openRide(rideId: number): void {
    const id = `ride-${rideId}`;
    if (this.windows.get(id)) {
      this.windows.focus(this.windows.get(id)!);
      return;
    }
    this.controllers.set(id, openRideWindow(this.ctx, rideId));
  }

  toggleWindow(id: string): void {
    if (this.windows.get(id)) {
      this.actions.playUiSound('close');
      this.windows.close(id);
    } else this.openWindow(id);
  }

  openWindow(id: string): void {
    if (this.windows.get(id)) {
      this.windows.focus(this.windows.get(id)!);
      return;
    }
    this.actions.playUiSound('open');
    if (id === 'ride-select') {
      this.windows.close('ride-list');
      for (const windowId of this.windows.ids())
        if (/^ride-\d+$/.test(windowId)) this.windows.close(windowId);
    }
    if (CONSTRUCTION_WINDOWS.includes(id)) this.closeConstruction();
    const controller = this.createController(id);
    if (controller) this.controllers.set(id, controller);
  }

  closeTopWindow(): boolean {
    let top: { id: string; z: number } | null = null;
    for (const id of this.windows.ids()) {
      const z = Number(this.windows.get(id)?.root.style.zIndex ?? 0);
      if (!top || z > top.z) top = { id, z };
    }
    if (!top) return false;
    this.actions.playUiSound('close');
    this.windows.close(top.id);
    return true;
  }

  closeAllWindows(): void {
    for (const id of this.windows.ids()) this.windows.close(id);
  }

  dispose(): void {
    this.toolbar.dispose();
    this.statusBar.dispose();
    this.status.remove();
    this.objective.remove();
    this.weatherOverlay.remove();
    this.windows.dispose();
    this.controllers.clear();
  }

  private toolbarWindowIds(): string[] {
    return [
      'options',
      'view',
      'map',
      'clear',
      'land',
      'water',
      'scenery',
      'paths',
      'ride-select',
      'finance',
      'research',
      'ride-list',
      'park',
      'staff',
      'guests',
      'news',
    ];
  }

  private closeConstruction(): void {
    for (const id of [...CONSTRUCTION_WINDOWS, 'construction']) this.windows.close(id);
  }

  private dismissMessage(): void {
    this.messages.dismiss(performance.now());
    this.statusBar.setMessage(this.messages.current(performance.now()));
  }

  private followNews(item: NewsItem): void {
    if (item.target) this.actions.locate(item.target.x, item.target.y);
    if (item.target?.rideId !== undefined) this.openRide(item.target.rideId);
  }

  private createController(id: string): WindowController | null {
    const guestId = /^guest-(\d+)$/.exec(id)?.[1];
    if (guestId !== undefined) return openIndividualGuestWindow(this.ctx, Number(guestId));
    const workerId = /^worker-(\d+)$/.exec(id)?.[1];
    if (workerId !== undefined)
      return openWorkerWindow(this.ctx, Number(workerId), (staffId, order, enabled) =>
        this.actions.command({ type: 'setStaffOrder', staffId, order, enabled }),
      );
    switch (id) {
      case 'land':
        return openLandWindow(this.ctx);
      case 'water':
        return openWaterWindow(this.ctx);
      case 'scenery':
        return openToolWindow(this.ctx, SCENERY_WINDOW);
      case 'paths':
        return openPathWindow(this.ctx);
      case 'clear':
        return openClearWindow(this.ctx);
      case 'ride-select':
        this.chooseTool('select');
        return openRideSelect(this.ctx);
      case 'ride-list':
        return openRideList(this.ctx);
      case 'park':
        return openParkWindow(this.ctx);
      case 'land-rights':
        return openLandRightsWindow(this.ctx);
      case 'finance':
        return openFinanceWindow(this.ctx);
      case 'research':
        return openResearchWindow(this.ctx);
      case 'staff':
        return openStaffWindow(this.ctx);
      case 'guests':
        return openGuestWindow(this.ctx);
      case 'map':
        return openMapWindow(this.ctx);
      case 'news':
        return openNewsWindow(this.ctx, {
          history: () => filterMessages(this.news.history, this.actions.messageFilter()),
          follow: (item) => this.followNews(item),
          dismiss: (id) => {
            this.news.remove(id);
            this.messages.remove(id, performance.now());
            this.statusBar.setMessage(this.messages.current(performance.now()));
          },
          clearAll: () => {
            this.news.clear();
            this.messages.clear();
            this.statusBar.setMessage(null);
          },
        });
      case 'options':
        return this.openOptions();
      case 'view':
        return this.openNotice(
          'view',
          'View options',
          'Underground view and see-through overlays are not available in this version.',
          'map',
        );
      default:
        return null;
    }
  }

  private openNotice(
    id: string,
    title: string,
    text: string,
    kind: 'tool' | 'map',
  ): WindowController {
    const { window: win, created } = this.windows.open({
      id,
      title,
      kind,
      width: 300,
      onClose: () => {
        if (id === 'clear') this.chooseTool('select');
      },
    });
    if (created) win.pane().append(element('p', 'ui-help', text));
    if (id === 'view' && created) {
      const hud = button(
        'Performance overlay',
        () => {
          const on = hud.getAttribute('aria-pressed') !== 'true';
          hud.setAttribute('aria-pressed', String(on));
          this.parent.classList.toggle('hud-visible', on);
        },
        'ui-button',
      );
      hud.setAttribute('aria-pressed', String(this.parent.classList.contains('hud-visible')));
      win.pane().append(hud);
    }
    return { update() {} };
  }

  private openOptions(): WindowController {
    const { window: win, created } = this.windows.open({
      id: 'options',
      title: 'Options',
      kind: 'tool',
      width: 300,
      tabs: [
        { id: 'game', label: 'Game', icon: 'options' },
        { id: 'sound', label: 'Sound', icon: 'news' },
        { id: 'messages', label: 'Messages', icon: 'news' },
        { id: 'display', label: 'Display', icon: 'view' },
        { id: 'controls', label: 'Controls', icon: 'info' },
      ],
    });
    const speeds = new Map<number, HTMLButtonElement>();
    if (created) {
      const gamePane = win.pane('game');
      gamePane.append(
        button('Save, load and quit…', () => this.actions.openMenu(), 'ui-button'),
        element('p', 'ui-help', 'Game speed'),
      );
      const row = element('div', 'button-row');
      for (const speed of GAME_SPEEDS) {
        const b = button(speedLabel(speed), () => this.setSpeed(speed), 'ui-button');
        speeds.set(speed, b);
        row.append(b);
      }
      gamePane.append(row);
      if (import.meta.env.DEV) {
        gamePane.append(
          element('p', 'ui-help', 'Development'),
          button('Guests +1,000', () => this.actions.spawnGuests(), 'ui-button'),
        );
      }
      const soundPane = win.pane('sound');
      soundPane.append(
        element('p', 'ui-help', 'Sound and music settings'),
        this.audioRange('Sound volume', 'soundVolume'),
        this.audioRange('Music volume', 'musicVolume'),
        this.audioMusicToggle(),
        this.audioMute(),
      );
      const messagesPane = win.pane('messages');
      messagesPane.append(
        element('p', 'ui-help', 'Choose which kinds of message appear on the ticker'),
        this.messageToggle('award', 'Awards'),
        this.messageToggle('ride', 'Ride messages (openings, breakdowns, repairs)'),
        this.messageToggle('park', 'Park messages (weather, objectives, lost guests)'),
        this.messageToggle('guest', 'Guest milestones'),
      );
      const displayPane = win.pane('display');
      displayPane.append(
        element('p', 'ui-help', 'View and display options'),
        this.optionToggle('Height labels', 'height-labels', undefined, 'Not available yet.'),
        this.optionToggle('Gridlines', 'gridlines'),
        this.optionToggle(
          'Construction marker',
          'construction-marker',
          undefined,
          'Not available yet.',
        ),
        this.optionToggle('Performance overlay', 'performance-overlay', (on) =>
          this.parent.classList.toggle('hud-visible', on),
        ),
      );
      const controlsPane = win.pane('controls');
      controlsPane.append(
        element('p', 'ui-help', 'Keyboard shortcuts'),
        element(
          'p',
          'ui-help',
          'Esc cancels a tool · Enter / Z rotate clockwise · Shift+Enter / X rotate anticlockwise · Ctrl+S saves a screenshot.',
        ),
        element('p', 'ui-help', 'Page Up / Page Down zoom · Backspace closes a window.'),
        element(
          'p',
          'ui-help',
          'Space pauses or resumes · 1 / 2 / 4 set game speed · + / - go faster or slower.',
        ),
      );
    }
    return {
      update: () => {
        for (const [speed, b] of speeds)
          b.setAttribute('aria-pressed', String(speed === this.speed));
      },
    };
  }

  private optionToggle(
    labelText: string,
    key: string,
    onChange?: (enabled: boolean) => void,
    unavailableReason?: string,
  ): HTMLLabelElement {
    const label = element('label', 'check-row');
    const input = element('input');
    input.type = 'checkbox';
    if (unavailableReason) {
      input.disabled = true;
      input.title = unavailableReason;
      label.title = unavailableReason;
    }
    input.checked = localStorage.getItem(`opencoaster-option-${key}`) === 'true';
    input.addEventListener('change', () => {
      localStorage.setItem(`opencoaster-option-${key}`, String(input.checked));
      onChange?.(input.checked);
    });
    label.append(input, element('span', '', labelText));
    return label;
  }

  private audioRange(labelText: string, key: 'soundVolume' | 'musicVolume'): HTMLLabelElement {
    const row = element('label', 'coaster-row');
    const input = element('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = String(this.actions.audioSettings()[key]);
    input.setAttribute('aria-label', labelText);
    input.addEventListener('input', () => {
      this.actions.setAudioSettings({ [key]: Number(input.value) });
    });
    row.append(element('span', '', labelText), input);
    return row;
  }

  private messageToggle(category: MessageCategory, labelText: string): HTMLLabelElement {
    const label = element('label', 'check-row');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = this.actions.messageFilter()[category];
    input.addEventListener('change', () =>
      this.actions.setMessageFilter({ [category]: input.checked }),
    );
    label.append(input, element('span', '', labelText));
    return label;
  }

  private audioMusicToggle(): HTMLLabelElement {
    const label = element('label', 'check-row');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = this.actions.audioSettings().musicOn;
    input.setAttribute('aria-label', 'Music on');
    input.addEventListener('change', () =>
      this.actions.setAudioSettings({ musicOn: input.checked }),
    );
    label.append(input, element('span', '', 'Music on'));
    return label;
  }

  private audioMute(): HTMLLabelElement {
    const label = element('label', 'check-row');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = this.actions.audioSettings().muted;
    input.setAttribute('aria-label', 'Mute audio');
    input.addEventListener('change', () => this.actions.setAudioSettings({ muted: input.checked }));
    label.append(input, element('span', '', 'Mute'));
    return label;
  }

  private chooseTool(tool: ToolMode): void {
    this.tool = tool;
    this.actions.setTool(tool);
    this.applySpeed();
    this.status.textContent =
      tool === 'select'
        ? 'Select a guest or tile. Drag to pan; Page Up/Down or pinch to zoom.'
        : tool === 'land'
          ? 'Land tool selected. Tap to raise; use Lower (or Shift) to dig.'
          : tool === 'clear'
            ? 'Clear scenery selected. Tap to remove trees, scenery and path additions in the area.'
            : tool === 'water'
              ? 'Water tool selected. Tap to raise the water; use Lower (or Shift) to drain.'
              : tool === 'buy-land'
                ? 'Land purchase selected. Click a marked land tile to buy it.'
                : tool === 'buy-rights'
                  ? 'Construction rights selected. Click a marked tile to buy the rights.'
                  : tool === 'patrol'
                    ? `Patrol tool selected${this.patrolKind === null ? '' : ` for ${STAFF_KIND_NAMES[this.patrolKind] ?? 'Staff'}`}. Tap tiles to add them; use Remove tiles (or Shift) to remove.`
                    : `${TOOL_LABELS[tool]} tool selected. Tap a tile to place.`;
  }
}
