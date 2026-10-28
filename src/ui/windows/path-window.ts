import { button, element } from '../dom';
import { icon } from '../icons';
import type { UiContext, WindowController } from '../ui-types';
import { takeFootpathHint } from '../../app/tools/path/state';
import type { PathMode } from '../../app/tools/path/state';
import type { PieceSlope } from '../../app/tools/path/run';
import { PathStyle } from '../../sim/map/tile-map';

const SURFACES: ReadonlyArray<{ style: PathStyle; label: string; swatch: string }> = [
  { style: PathStyle.Tarmac, label: 'Tarmac', swatch: 'tarmac' },
  { style: PathStyle.CrazyPaving, label: 'Crazy paving', swatch: 'crazy' },
  { style: PathStyle.Dirt, label: 'Dirt', swatch: 'dirt' },
];

const SLOPES: ReadonlyArray<{
  slope: PieceSlope;
  label: string;
  key: string;
  icon: 'slopeUp' | 'slopeLevel' | 'slopeDown';
}> = [
  { slope: 'level', label: 'Level', key: 'L', icon: 'slopeLevel' },
  { slope: 'up', label: 'Up', key: 'U', icon: 'slopeUp' },
  { slope: 'down', label: 'Down', key: 'D', icon: 'slopeDown' },
];

/** Arrow pad laid out as a cross: north is -y on the map, so it sits above the centre. */
const ARROWS: ReadonlyArray<{ dir: number; glyph: string; label: string; cell: string }> = [
  { dir: 3, glyph: '↑', label: 'Face −Y', cell: 'top' },
  { dir: 2, glyph: '←', label: 'Face −X', cell: 'left' },
  { dir: 0, glyph: '→', label: 'Face +X', cell: 'right' },
  { dir: 1, glyph: '↓', label: 'Face +Y', cell: 'bottom' },
];

const HINT =
  'Drag across ground, then release to build. For raised paths, choose Piece by piece, click a path end, then use Up, Level or Down.';

export const PATH_TABS = [
  { id: 'line', label: 'Lay line', icon: 'paths' },
  { id: 'piece', label: 'Piece by piece', icon: 'build' },
] as const;

/** The Footpaths window: surface and queue choice, then line or piece-by-piece construction. */
export function openPathWindow(ctx: UiContext): WindowController {
  const { footpath } = ctx.actions;
  const { state } = footpath;
  const setMode = (mode: PathMode): void => {
    footpath.setMode(mode);
    ctx.chooseTool('path');
  };
  const { window: win, created } = ctx.windows.open({
    id: 'paths',
    title: 'Footpaths',
    kind: 'tool',
    width: 300,
    tabs: PATH_TABS,
    onTab: (id) => setMode(id as PathMode),
    onClose: () => {
      ctx.actions.setAlternate(false);
      footpath.leave();
      ctx.chooseTool('select');
    },
  });
  if (!created) return { update() {} };

  const linePane = win.panes.get('line') ?? win.pane();
  const piecePane = win.panes.get('piece') ?? win.pane();

  if (takeFootpathHint(window.localStorage))
    linePane.append(element('p', 'ui-help path-hint', HINT));

  // Each control exists once per tab, and every copy is kept in step with the one pressed.
  const surfaceToggles: HTMLButtonElement[] = [];
  const queueToggles: HTMLButtonElement[] = [];
  const removeToggles: HTMLButtonElement[] = [];
  const pressAll = (
    group: HTMLButtonElement[],
    on: (button: HTMLButtonElement) => boolean,
  ): void => {
    for (const toggle of group) toggle.setAttribute('aria-pressed', String(on(toggle)));
  };
  const surface = (pane: HTMLElement): void => {
    const row = element('div', 'path-surfaces');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Footpath surface');
    for (const option of SURFACES) {
      const swatch = button(
        option.label,
        () => {
          footpath.setStyle(option.style);
          pressAll(surfaceToggles, (other) => other.dataset.style === String(option.style));
        },
        'ui-button path-surface',
      );
      swatch.dataset.surface = option.swatch;
      swatch.dataset.style = String(option.style);
      swatch.setAttribute('aria-pressed', String(state.style === option.style));
      surfaceToggles.push(swatch);
      row.append(swatch);
    }
    const queueToggle = button(
      'Queue line',
      () => {
        const on = queueToggles[0]!.getAttribute('aria-pressed') !== 'true';
        pressAll(queueToggles, () => on);
        footpath.setQueue(on);
      },
      'ui-button',
    );
    queueToggle.setAttribute('aria-pressed', String(state.queue));
    queueToggles.push(queueToggle);
    const removeToggle = button(
      'Remove footpath',
      () => {
        const on = removeToggles[0]!.getAttribute('aria-pressed') !== 'true';
        pressAll(removeToggles, () => on);
        ctx.actions.setAlternate(on);
        footpath.announce(
          on ? 'Remove footpath: tap a footpath tile to remove it.' : 'Remove footpath off.',
        );
      },
      'ui-button',
    );
    removeToggle.setAttribute('aria-pressed', 'false');
    removeToggles.push(removeToggle);
    const modes = element('div', 'path-surfaces');
    modes.append(queueToggle, removeToggle);
    pane.append(row, modes);
  };
  surface(linePane);
  surface(piecePane);

  linePane.append(element('p', 'ui-help', 'Tap one tile for one piece. Red tiles say why not.'));

  piecePane.append(
    element('p', 'ui-help', 'Click a path end to lock on, or any tile to place a cursor.'),
  );
  const arrows = element('div', 'path-arrows');
  arrows.setAttribute('role', 'group');
  arrows.setAttribute('aria-label', 'Piece direction');
  const arrowButtons: HTMLButtonElement[] = [];
  for (const arrow of ARROWS) {
    const cell = button(
      arrow.glyph,
      () => {
        footpath.setDirection(arrow.dir);
        for (const other of arrowButtons)
          other.setAttribute('aria-pressed', String(other === cell));
      },
      'ui-button path-arrow',
    );
    cell.setAttribute('aria-label', arrow.label);
    cell.setAttribute('aria-pressed', String(state.dir === arrow.dir));
    cell.dataset.cell = arrow.cell;
    cell.dataset.dir = String(arrow.dir);
    arrowButtons.push(cell);
    arrows.append(cell);
  }
  piecePane.append(arrows);

  const slopes = element('div', 'path-slopes');
  slopes.setAttribute('role', 'group');
  slopes.setAttribute('aria-label', 'Piece slope');
  const slopeButtons: HTMLButtonElement[] = [];
  for (const option of SLOPES) {
    const slopeButton = button(
      '',
      () => {
        footpath.setSlope(option.slope);
        for (const other of slopeButtons)
          other.setAttribute('aria-pressed', String(other === slopeButton));
      },
      'ui-button',
    );
    slopeButton.setAttribute('aria-label', option.label);
    slopeButton.setAttribute('aria-keyshortcuts', option.key);
    slopeButton.title = `${option.label} · ${option.key}`;
    slopeButton.replaceChildren(
      icon(option.icon, 16),
      element('span', 'path-slope-label', `${option.label} ${option.key}`),
    );
    slopeButton.setAttribute('aria-pressed', String(state.slope === option.slope));
    slopeButton.dataset.slope = option.slope;
    slopeButtons.push(slopeButton);
    slopes.append(slopeButton);
  }
  piecePane.append(slopes);

  const heightReadout = element('p', 'ui-help path-height-readout', 'Build height: —');
  heightReadout.setAttribute('aria-live', 'polite');
  piecePane.append(heightReadout);

  const actions = element('div', 'path-piece-actions');
  actions.append(
    button('Build', () => void footpath.build(), 'ui-button'),
    button('Remove', () => footpath.remove(), 'ui-button'),
    button('Demolish last', () => footpath.demolishLast(), 'ui-button'),
  );
  piecePane.append(actions);

  ctx.chooseTool('path');
  return {
    update() {
      pressAll(queueToggles, () => state.queue);
      pressAll(arrowButtons, (other) => Number(other.dataset.dir) === state.dir);
      pressAll(slopeButtons, (other) => other.dataset.slope === state.slope);
      const target = footpath.buildTarget;
      heightReadout.textContent = `Build height: ${target?.level ?? '—'}`;
    },
  };
}
