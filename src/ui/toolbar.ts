import { element, iconButton } from './dom';
import type { IconName } from './icons';

export interface ToolbarButton {
  id: string;
  icon: IconName;
  label: string;
  caption?: string;
  tooltip?: string;
  disabledReason?: string;
  onClick(): void;
}

/** Top bar. Left: game controls. Right: construction and information windows. */
export class Toolbar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly actionsButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly compass: HTMLElement;

  constructor(
    parent: HTMLElement,
    left: readonly ToolbarButton[],
    right: readonly ToolbarButton[],
  ) {
    this.root = element('nav', 'game-toolbar');
    this.root.setAttribute('aria-label', 'Park controls');
    this.actionsButton = element('button', 'toolbar-actions', 'Actions');
    this.actionsButton.type = 'button';
    this.actionsButton.setAttribute('aria-expanded', 'false');
    this.actionsButton.addEventListener('click', () => this.toggleMenu());
    this.menu = element('div', 'toolbar-menu');
    this.menu.id = 'toolbar-actions-menu';
    this.actionsButton.setAttribute('aria-controls', this.menu.id);
    const leftGroup = element('div', 'toolbar-group toolbar-left');
    const rightGroup = element('div', 'toolbar-group toolbar-right');
    for (const [group, items] of [
      [leftGroup, left],
      [rightGroup, right],
    ] as const) {
      for (const item of items) {
        const b = iconButton(
          item.icon,
          item.label,
          item.onClick,
          'toolbar-button',
          item.caption ?? item.label,
        );
        if (item.tooltip) b.title = item.tooltip;
        b.dataset.action = item.id;
        b.setAttribute('aria-pressed', 'false');
        if (item.disabledReason) {
          b.disabled = true;
          b.title = item.disabledReason;
        }
        this.buttons.set(item.id, b);
        b.addEventListener('click', () => this.closeMenu());
        group.append(b);
      }
    }
    this.menu.append(leftGroup, rightGroup);
    this.compass = element('div', 'camera-compass');
    this.compass.setAttribute('role', 'img');
    this.compass.setAttribute('aria-label', 'North is up');
    this.compass.append(
      element('span', 'camera-compass-arrow', '↑'),
      element('span', undefined, 'N'),
    );
    this.root.append(this.actionsButton, this.menu, this.compass);
    parent.append(this.root);
  }

  private toggleMenu(): void {
    const open = this.actionsButton.getAttribute('aria-expanded') !== 'true';
    this.actionsButton.setAttribute('aria-expanded', String(open));
    this.menu.classList.toggle('open', open);
  }

  private closeMenu(): void {
    this.actionsButton.setAttribute('aria-expanded', 'false');
    this.menu.classList.remove('open');
  }

  setPressed(id: string, pressed: boolean): void {
    this.buttons.get(id)?.setAttribute('aria-pressed', String(pressed));
  }

  setRotation(rotation: number): void {
    const direction = ((rotation % 4) + 4) % 4;
    const names = ['up', 'right', 'down', 'left'];
    this.compass.setAttribute('aria-label', `North is ${names[direction]}`);
    this.compass.dataset.rotation = String(direction);
    const arrow = this.compass.firstElementChild as HTMLElement | null;
    if (arrow) arrow.style.transform = `rotate(${direction * 90}deg)`;
  }

  /** Replaces a button's icon and name, e.g. Pause ↔ Resume. */
  relabel(id: string, label: string, icon: Node, caption?: string): void {
    const b = this.buttons.get(id);
    if (!b) return;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.replaceChildren(icon);
    if (caption) b.append(element('span', 'icon-caption', caption));
  }

  dispose(): void {
    this.root.remove();
  }
}
