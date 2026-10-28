import { describe, expect, it } from 'vitest';
import { renderUiIconSprite } from '../../tools/sprites/ui-icons';
import { shortcutFor } from './shortcuts';
import { TOOLBAR_BUTTON_SPECS, toolbarTooltip } from './toolbar-spec';

const press = (key: string, shiftKey = false) =>
  shortcutFor({ key, shiftKey, ctrlKey: false, altKey: false, metaKey: false });

describe('toolbar button specs', () => {
  it('gives every button a non-empty name and a tooltip that starts with it', () => {
    for (const spec of TOOLBAR_BUTTON_SPECS) {
      expect(spec.label.trim(), spec.id).not.toBe('');
      expect(toolbarTooltip(spec).startsWith(spec.label), spec.id).toBe(true);
    }
  });

  it('lists the hotkeys in the tooltip and keeps them bound to the same action', () => {
    for (const spec of TOOLBAR_BUTTON_SPECS) {
      for (const key of spec.keys ?? []) {
        expect(toolbarTooltip(spec), spec.id).toContain(key.label);
        expect(press(key.key, key.shiftKey), `${spec.id} ${key.label}`).toEqual(key.action);
      }
    }
  });

  it('shows the hotkey for every window that has one', () => {
    const windowButtons = TOOLBAR_BUTTON_SPECS.filter((spec) => spec.windowId);
    expect(windowButtons.length).toBeGreaterThan(8);
    const f1 = TOOLBAR_BUTTON_SPECS.find((spec) => spec.id === 'land');
    expect(toolbarTooltip(f1!)).toBe('Land (F1)');
    expect(toolbarTooltip(TOOLBAR_BUTTON_SPECS.find((spec) => spec.id === 'finance')!)).toBe(
      'Finances (F)',
    );
    expect(toolbarTooltip(TOOLBAR_BUTTON_SPECS.find((spec) => spec.id === 'map')!)).toBe(
      'Map (Tab)',
    );
  });

  it('uses a unique id, icon id and rendered artwork for every button', () => {
    const ids = TOOLBAR_BUTTON_SPECS.map((spec) => spec.id);
    const icons = TOOLBAR_BUTTON_SPECS.map((spec) => spec.icon);
    const art = icons.map((name) => renderUiIconSprite(name, 24).pixels.join(','));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(icons).size).toBe(icons.length);
    expect(new Set(art).size).toBe(art.length);
  });
});
