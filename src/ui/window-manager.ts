import { element, iconButton } from './dom';
import type { IconName } from './icons';
import {
  BOTTOM_INSET,
  MOBILE_QUERY,
  TOP_INSET,
  cascadePosition,
  clampPosition,
  positionAwayFromPoint,
} from './window-layout';

/** Selects the title-bar and body colour scheme. */
export type WindowKind =
  'ride' | 'park' | 'finance' | 'guest' | 'staff' | 'research' | 'map' | 'build' | 'tool';

export interface TabSpec {
  id: string;
  label: string;
  icon?: IconName;
}

export interface WindowSpec {
  id: string;
  title: string;
  kind: WindowKind;
  tabs?: readonly TabSpec[];
  /** Desktop width in px. */
  width?: number;
  onClose?(): void;
  onTab?(tabId: string): void;
}

/** A floating window: bevelled title bar with pin and close, optional tab strip, one pane per tab. */
export class UiWindow {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly panes = new Map<string, HTMLElement>();
  private readonly titleText: HTMLElement;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private tab = '';
  pinned = false;

  constructor(
    readonly spec: WindowSpec,
    manager: WindowManager,
  ) {
    this.root = element('section', `ui-window kind-${spec.kind}`);
    this.root.dataset.panel = spec.id;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', spec.title);
    if (spec.width) this.root.style.setProperty('--w', `${spec.width}px`);

    const header = element('header', 'ui-titlebar');
    this.titleText = element('strong', 'ui-title', spec.title);
    const pin = iconButton(
      'pin',
      `Pin ${spec.title}`,
      () => this.setPinned(!this.pinned),
      'ui-titlebtn',
      undefined,
      16,
    );
    pin.dataset.action = `pin-${spec.id}`;
    const close = iconButton(
      'close',
      `Close ${spec.title}`,
      () => manager.close(spec.id),
      'ui-titlebtn',
      undefined,
      16,
    );
    close.dataset.action = `close-${spec.id}`;
    header.append(this.titleText, pin, close);
    const resize = element('button', 'ui-resize-handle', '◢');
    resize.type = 'button';
    resize.setAttribute('aria-label', `Resize ${spec.title} window`);
    resize.dataset.action = `resize-${spec.id}`;
    resize.addEventListener('pointerdown', (event) => {
      if (manager.mobile || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resize.setPointerCapture(event.pointerId);
      const rect = this.root.getBoundingClientRect();
      const move = (next: PointerEvent): void => {
        this.root.style.setProperty(
          '--w',
          `${Math.max(220, Math.min(window.innerWidth - rect.left - 4, rect.width + next.clientX - event.clientX))}px`,
        );
        this.root.style.setProperty(
          '--h',
          `${Math.max(160, Math.min(window.innerHeight - rect.top - 4, rect.height + next.clientY - event.clientY))}px`,
        );
      };
      const end = (): void => {
        resize.removeEventListener('pointermove', move);
        resize.removeEventListener('pointerup', end);
        resize.removeEventListener('pointercancel', end);
      };
      resize.addEventListener('pointermove', move);
      resize.addEventListener('pointerup', end);
      resize.addEventListener('pointercancel', end);
    });

    this.body = element('div', 'ui-body');
    if (spec.tabs?.length) {
      const strip = element('div', 'ui-tabs');
      strip.setAttribute('role', 'tablist');
      for (const tab of spec.tabs) {
        const button = iconButton(
          tab.icon ?? 'info',
          tab.label,
          () => this.showTab(tab.id),
          'ui-tab',
        );
        button.setAttribute('role', 'tab');
        button.dataset.tab = tab.id;
        this.tabButtons.set(tab.id, button);
        strip.append(button);
        const pane = element('div', 'ui-pane');
        pane.dataset.tab = tab.id;
        pane.setAttribute('role', 'tabpanel');
        this.panes.set(tab.id, pane);
        this.body.append(pane);
      }
      this.root.append(header, strip, this.body, resize);
      this.showTab(spec.tabs[0].id);
    } else {
      const pane = element('div', 'ui-pane active');
      this.panes.set('main', pane);
      this.body.append(pane);
      this.root.append(header, this.body, resize);
    }
    manager.attachDrag(this, header);
  }

  get activeTab(): string {
    return this.tab;
  }

  pane(id = 'main'): HTMLElement {
    const pane = this.panes.get(id);
    if (!pane) throw new Error(`Window ${this.spec.id} has no pane ${id}`);
    return pane;
  }

  setTitle(title: string): void {
    if (this.titleText.textContent !== title) this.titleText.textContent = title;
  }

  showTab(id: string): void {
    if (!this.panes.has(id)) return;
    this.tab = id;
    for (const [paneId, pane] of this.panes) pane.classList.toggle('active', paneId === id);
    for (const [tabId, button] of this.tabButtons) {
      button.setAttribute('aria-selected', String(tabId === id));
      button.classList.toggle('active', tabId === id);
    }
    this.spec.onTab?.(id);
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    this.root.classList.toggle('pinned', pinned);
  }
}

/** Owns every open window: stacking order, dragging, and the mobile bottom-sheet layout. */
export class WindowManager {
  readonly layer: HTMLElement;
  private readonly windows = new Map<string, UiWindow>();
  private readonly media = window.matchMedia(MOBILE_QUERY);
  private z = 10;
  private opened = 0;
  private readonly positions = new Map<string, { x: number; y: number }>();
  private pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  constructor(parent: HTMLElement) {
    this.layer = element('div', 'ui-windows');
    parent.append(this.layer);
    this.media.addEventListener('change', () => this.relayout());
    window.addEventListener('resize', () => this.relayout());
    window.addEventListener('pointermove', (event) => {
      this.pointer = { x: event.clientX, y: event.clientY };
    });
    window.addEventListener('pointerdown', (event) => {
      this.pointer = { x: event.clientX, y: event.clientY };
    });
  }

  get mobile(): boolean {
    return this.media.matches;
  }

  get(id: string): UiWindow | undefined {
    return this.windows.get(id);
  }

  ids(): string[] {
    return [...this.windows.keys()];
  }

  /** Opens the window, or raises it when already open. */
  open(spec: WindowSpec): { window: UiWindow; created: boolean } {
    const existing = this.windows.get(spec.id);
    if (existing) {
      this.focus(existing);
      return { window: existing, created: false };
    }
    const win = new UiWindow(spec, this);
    this.windows.set(spec.id, win);
    this.layer.append(win.root);
    const fallback = cascadePosition(this.opened++, window.innerWidth, window.innerHeight);
    const remembered = this.positions.get(spec.id);
    const openingPointer = this.pointer;
    const place = (): void => {
      if (!win.root.isConnected || this.mobile) return;
      const bounds = win.root.getBoundingClientRect();
      const size = { width: bounds.width || spec.width || 340, height: bounds.height || 260 };
      const placementSize = remembered
        ? size
        : {
            width: size.width,
            height: Math.max(size.height, window.innerHeight - TOP_INSET - BOTTOM_INSET - 4),
          };
      const occupied = [...this.windows.values()]
        .filter((other) => other !== win)
        .map((other) => {
          const rect = other.root.getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        });
      for (const element of this.layer.parentElement?.querySelectorAll<HTMLElement>(
        '.objective-strip, .hud, .tool-status',
      ) ?? []) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0)
          occupied.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
      const rememberedAt = remembered
        ? clampPosition(remembered.x, remembered.y, size, window.innerWidth, window.innerHeight)
        : undefined;
      const rememberedIsOccupied =
        rememberedAt !== undefined &&
        occupied.some(
          (rect) =>
            rememberedAt.x < rect.x + rect.width &&
            rememberedAt.x + size.width > rect.x &&
            rememberedAt.y < rect.y + rect.height &&
            rememberedAt.y + size.height > rect.y,
        );
      const at =
        rememberedAt && !rememberedIsOccupied
          ? rememberedAt
          : positionAwayFromPoint(
              fallback,
              remembered ? size : placementSize,
              openingPointer,
              window.innerWidth,
              window.innerHeight,
              occupied,
            );
      win.root.style.setProperty('--x', `${at.x}px`);
      win.root.style.setProperty('--y', `${at.y}px`);
    };
    place();
    win.root.addEventListener('pointerdown', () => this.focus(win, true), true);
    this.focus(win);
    requestAnimationFrame(() => requestAnimationFrame(place));
    return { window: win, created: true };
  }

  close(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;
    if (!this.mobile) {
      this.positions.set(id, {
        x: Number.parseFloat(win.root.style.getPropertyValue('--x')),
        y: Number.parseFloat(win.root.style.getPropertyValue('--y')),
      });
    }
    this.windows.delete(id);
    win.root.remove();
    win.spec.onClose?.();
    this.relayout();
  }

  toggle(spec: WindowSpec): boolean {
    if (this.windows.has(spec.id)) {
      this.close(spec.id);
      return false;
    }
    this.open(spec);
    return true;
  }

  closeUnpinned(): void {
    for (const [id, win] of [...this.windows]) if (!win.pinned) this.close(id);
  }

  dispose(): void {
    this.layer.remove();
    this.windows.clear();
  }

  focus(win: UiWindow, preserveCollapsed = false): void {
    const wasCollapsed = preserveCollapsed && win.root.classList.contains('collapsed');
    win.root.style.zIndex = String(win.pinned ? 1000 + ++this.z : ++this.z);
    for (const other of this.windows.values()) other.root.classList.toggle('front', other === win);
    if (this.mobile) this.relayout();
    if (wasCollapsed && !win.pinned) win.root.classList.add('collapsed');
  }

  attachDrag(win: UiWindow, handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      if (this.mobile) return;
      event.preventDefault();
      const rect = win.root.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent): void => {
        const at = clampPosition(
          e.clientX - grabX,
          e.clientY - grabY,
          { width: rect.width, height: rect.height },
          window.innerWidth,
          window.innerHeight,
        );
        win.root.style.setProperty('--x', `${at.x}px`);
        win.root.style.setProperty('--y', `${at.y}px`);
      };
      const end = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('click', (event) => {
      if (!this.mobile || (event.target as HTMLElement).closest('button')) return;
      win.root.classList.toggle('collapsed');
    });
  }

  /** Mobile: only the front (or pinned) sheet is expanded; desktop: pull strays back on screen. */
  private relayout(): void {
    for (const win of this.windows.values()) {
      if (this.mobile) {
        const expanded = win.root.classList.contains('front') || win.pinned;
        if (win.root.classList.contains('front')) win.root.classList.remove('collapsed');
        else win.root.classList.toggle('collapsed', !expanded);
      } else {
        win.root.classList.remove('collapsed');
        const rect = win.root.getBoundingClientRect();
        if (rect.width === 0) continue;
        const at = clampPosition(
          rect.left,
          Math.max(TOP_INSET, rect.top),
          rect,
          window.innerWidth,
          window.innerHeight,
        );
        win.root.style.setProperty('--x', `${at.x}px`);
        win.root.style.setProperty('--y', `${at.y}px`);
      }
    }
  }
}
