import { element, iconButton } from './dom';
import type { IconName } from './icons';

export interface ToolbarButton {
  id: string;
  icon: IconName;
  label: string;
  caption?: string;
  onClick(): void;
}

/** Top bar. Left: game controls. Right: construction and information windows. */
export class Toolbar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(
    parent: HTMLElement,
    left: readonly ToolbarButton[],
    right: readonly ToolbarButton[],
  ) {
    this.root = element('nav', 'game-toolbar');
    this.root.setAttribute('aria-label', 'Park controls');
    const leftGroup = element('div', 'toolbar-group toolbar-left');
    const rightGroup = element('div', 'toolbar-group toolbar-right');
    for (const [group, items] of [
      [leftGroup, left],
      [rightGroup, right],
    ] as const) {
      for (const item of items) {
        const b = iconButton(item.icon, item.label, item.onClick, 'toolbar-button', item.caption);
        b.dataset.action = item.id;
        b.setAttribute('aria-pressed', 'false');
        this.buttons.set(item.id, b);
        group.append(b);
      }
    }
    this.root.append(leftGroup, rightGroup);
    parent.append(this.root);
  }

  setPressed(id: string, pressed: boolean): void {
    this.buttons.get(id)?.setAttribute('aria-pressed', String(pressed));
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
