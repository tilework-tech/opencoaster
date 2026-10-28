import type { IconName } from './icons';
import type { ShortcutAction } from './shortcuts';

export interface ToolbarKey {
  /** `KeyboardEvent.key` the shortcut table binds. */
  key: string;
  shiftKey?: boolean;
  /** How the key reads in a tooltip. */
  label: string;
  action: ShortcutAction;
}

export interface ToolbarButtonSpec {
  id: string;
  icon: IconName;
  label: string;
  /** Window this button toggles, when it opens one. */
  windowId?: string;
  keys?: readonly ToolbarKey[];
}

const windowKey = (key: string, label: string, id: string): ToolbarKey => ({
  key,
  label,
  action: { type: 'window', id },
});

/** Every named toolbar button, left group first; names and hotkeys feed the hover tooltips. */
export const TOOLBAR_BUTTON_SPECS: readonly ToolbarButtonSpec[] = [
  {
    id: 'pause',
    icon: 'pause',
    label: 'Pause',
    keys: [{ key: ' ', label: 'Space', action: { type: 'pause' } }],
  },
  { id: 'options', icon: 'options', label: 'Game options', windowId: 'options' },
  {
    id: 'zoom-out',
    icon: 'zoomOut',
    label: 'Zoom out',
    keys: [{ key: 'PageUp', label: 'Page Up', action: { type: 'zoom', direction: -1 } }],
  },
  {
    id: 'zoom-in',
    icon: 'zoomIn',
    label: 'Zoom in',
    keys: [{ key: 'PageDown', label: 'Page Down', action: { type: 'zoom', direction: 1 } }],
  },
  {
    id: 'rotate-clockwise',
    icon: 'rotateRight',
    label: 'Rotate right',
    keys: [
      { key: 'Enter', label: 'Enter', action: { type: 'rotate', direction: 1 } },
      { key: 'z', label: 'Z', action: { type: 'rotate', direction: 1 } },
    ],
  },
  {
    id: 'rotate-anticlockwise',
    icon: 'rotateLeft',
    label: 'Rotate left',
    keys: [
      {
        key: 'Enter',
        shiftKey: true,
        label: 'Shift+Enter',
        action: { type: 'rotate', direction: -1 },
      },
      { key: 'x', label: 'X', action: { type: 'rotate', direction: -1 } },
    ],
  },
  { id: 'view', icon: 'view', label: 'View options', windowId: 'view' },
  { id: 'map', icon: 'map', label: 'Map', windowId: 'map', keys: [windowKey('Tab', 'Tab', 'map')] },
  { id: 'clear', icon: 'demolish', label: 'Clear scenery', windowId: 'clear' },
  {
    id: 'land',
    icon: 'land',
    label: 'Land',
    windowId: 'land',
    keys: [windowKey('F1', 'F1', 'land')],
  },
  {
    id: 'water',
    icon: 'water',
    label: 'Water',
    windowId: 'water',
    keys: [windowKey('F2', 'F2', 'water')],
  },
  {
    id: 'scenery',
    icon: 'scenery',
    label: 'Scenery',
    windowId: 'scenery',
    keys: [windowKey('F3', 'F3', 'scenery')],
  },
  {
    id: 'paths',
    icon: 'paths',
    label: 'Footpaths',
    windowId: 'paths',
    keys: [windowKey('F4', 'F4', 'paths')],
  },
  {
    id: 'ride-select',
    icon: 'newRide',
    label: 'New ride',
    windowId: 'ride-select',
    keys: [windowKey('F5', 'F5', 'ride-select')],
  },
  {
    id: 'finance',
    icon: 'finances',
    label: 'Finances',
    windowId: 'finance',
    keys: [windowKey('f', 'F', 'finance')],
  },
  {
    id: 'research',
    icon: 'research',
    label: 'Research',
    windowId: 'research',
    keys: [windowKey('d', 'D', 'research')],
  },
  {
    id: 'ride-list',
    icon: 'wheel',
    label: 'Rides',
    windowId: 'ride-list',
    keys: [windowKey('r', 'R', 'ride-list')],
  },
  {
    id: 'park',
    icon: 'park',
    label: 'Park',
    windowId: 'park',
    keys: [windowKey('p', 'P', 'park')],
  },
  {
    id: 'staff',
    icon: 'staff',
    label: 'Staff',
    windowId: 'staff',
    keys: [windowKey('s', 'S', 'staff')],
  },
  {
    id: 'guests',
    icon: 'guests',
    label: 'Guests',
    windowId: 'guests',
    keys: [windowKey('g', 'G', 'guests')],
  },
  {
    id: 'news',
    icon: 'news',
    label: 'Messages',
    windowId: 'news',
    keys: [windowKey('m', 'M', 'news')],
  },
  { id: 'save-load', icon: 'saveLoad', label: 'Save / Load' },
];

export function toolbarButtonSpec(id: string): ToolbarButtonSpec {
  const spec = TOOLBAR_BUTTON_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown toolbar button: ${id}`);
  return spec;
}

/** Hover text: the button's name followed by its hotkeys, e.g. `Land (F1)`. */
export function toolbarTooltip(spec: ToolbarButtonSpec, label = spec.label): string {
  const keys = spec.keys?.map((k) => k.label).join(' or ');
  return keys ? `${label} (${keys})` : label;
}
