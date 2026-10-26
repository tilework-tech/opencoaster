import { Z_PIXELS } from '../../render/projection';
import type { Camera } from '../../render/renderer';
import { FeedbackDomain } from '../../sim/core/feedback';
import type { AreaEdit } from '../../sim/map/area-tools';
import { LandResult } from '../../sim/map/land-tool';
import { AreaOverlay } from '../../ui/area-overlay';
import type { GameUI } from '../../ui/game-ui';
import type { AreaToolSettings } from '../../ui/ui-types';
import type { SimClient } from '../../worker/sim-client';
import { areaPreviewText, areaRefusalText } from './area-feedback';
import type { AreaTool } from './area-feedback';
import { pickLandSelection } from './land-selection';
import type { LandSelection } from './land-selection';

const FEEDBACK_MS = 2500;
const MIN_STEP_PX = 6;
const MAX_DRAG_STEPS = 8;
/** Re-asks the worker this often so a preview follows cash, rides and terrain changing under it. */
const REFRESH_MS = 500;

export interface AreaControllerDependencies {
  tool: AreaTool;
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  sim: SimClient;
  camera: Camera;
  gameUi: GameUI;
  viewport: { width: number; height: number };
  active: () => boolean;
}

interface Drag {
  selection: LandSelection;
  /** Pointer height the next vertical step is measured from. */
  referenceY: number;
}

/**
 * Drives the Clear scenery or Water tool on the map: previews the square under the cursor with
 * its price, and applies one step on tap. Shift (or the alternate action) lowers water instead.
 * Dragging the Water tool up or down repeats raise or lower steps on the square it started on.
 */
export class AreaController {
  settings: AreaToolSettings = { size: 1, lower: false };
  private readonly overlay: AreaOverlay;
  private readonly tip: HTMLElement;
  private readonly domain: FeedbackDomain;
  private selection: LandSelection | null = null;
  private drag: Drag | null = null;
  private pointer = { x: 0, y: 0 };
  private requestedKey = '';
  private requestedMap: unknown = null;
  private requestedAt = 0;
  private feedbackSeq = -1;
  private feedbackText = '';
  private feedbackTile: number | undefined;
  private feedbackUntil = 0;

  constructor(private readonly deps: AreaControllerDependencies) {
    this.domain = deps.tool === 'clear' ? FeedbackDomain.Clear : FeedbackDomain.Water;
    this.overlay = new AreaOverlay(deps.parent);
    this.tip = document.createElement('div');
    this.tip.className = 'area-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.hidden = true;
    deps.parent.append(this.tip);
  }

  configure(settings: AreaToolSettings): void {
    this.settings = settings;
    this.requestedKey = '';
  }

  /** Hover over the map without a button held. */
  hover(clientX: number, clientY: number): void {
    if (this.drag) return;
    this.point(clientX, clientY);
  }

  leave(): void {
    if (this.drag) return;
    this.selection = null;
    this.deps.sim.clearAreaPreview();
    this.requestedKey = '';
  }

  /** A finger or button went down: shows the preview straight away for touch input. */
  press(clientX: number, clientY: number): void {
    this.point(clientX, clientY);
  }

  tap(clientX: number, clientY: number, alternate: boolean): void {
    const selection = this.point(clientX, clientY);
    const label = this.deps.tool === 'clear' ? 'Clear scenery' : 'Water';
    if (!selection) {
      this.deps.gameUi.setToolStatus(`${label} tool · outside the park map.`);
      return;
    }
    const edit = this.editFor(selection, alternate);
    const verb =
      edit.tool === 'clear' ? 'Clearing scenery' : edit.lower ? 'Lowering water' : 'Raising water';
    this.deps.gameUi.setToolStatus(`${verb} at ${selection.cursorX}, ${selection.cursorY}.`);
    this.fire(edit);
  }

  dragStart(clientX: number, clientY: number): void {
    const selection = this.point(clientX, clientY);
    if (selection) this.drag = { selection, referenceY: clientY };
  }

  dragMove(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.pointer = { x: clientX, y: clientY };
    const step = Math.max(MIN_STEP_PX, Z_PIXELS * this.deps.camera.zoom);
    let steps = 0;
    while (drag.referenceY - clientY >= step && steps < MAX_DRAG_STEPS) {
      this.fire(this.editWith(drag.selection, false));
      drag.referenceY -= step;
      steps++;
    }
    while (clientY - drag.referenceY >= step && steps < MAX_DRAG_STEPS) {
      this.fire(this.editWith(drag.selection, true));
      drag.referenceY += step;
      steps++;
    }
  }

  dragEnd(): void {
    this.drag = null;
  }

  /** Call once per frame: refreshes the preview, overlay and tooltip. */
  update(now: number): void {
    const { sim } = this.deps;
    const latest = sim.latest;
    if (latest && latest.feedback.seq !== this.feedbackSeq) {
      this.feedbackSeq = latest.feedback.seq;
      if (latest.feedback.domain === this.domain && latest.feedback.code !== LandResult.Ok) {
        this.feedbackText = areaRefusalText(this.deps.tool, latest.feedback.code);
        this.feedbackTile = latest.feedback.subject >= 0 ? latest.feedback.subject : undefined;
        this.feedbackUntil = now + FEEDBACK_MS;
      }
    }
    const map = sim.map;
    if (!this.deps.active() || !map || !this.selection) {
      this.requestedKey = '';
      this.overlay.clear();
      this.tip.hidden = !(this.deps.active() && now < this.feedbackUntil);
      if (!this.tip.hidden) this.showTip(this.feedbackText, true);
      return;
    }
    if (map !== this.requestedMap) {
      this.requestedMap = map;
      this.requestedKey = '';
    }
    const edit = this.editFor(this.selection, false);
    const key = JSON.stringify(edit);
    if (key !== this.requestedKey || now - this.requestedAt >= REFRESH_MS) {
      this.requestedKey = key;
      this.requestedAt = now;
      sim.previewArea(edit);
    }
    const answered = sim.areaPreview;
    const plan = answered && JSON.stringify(answered.edit) === key ? answered.plan : null;
    this.overlay.draw({
      map,
      camera: this.deps.camera,
      viewport: this.deps.viewport,
      tool: this.deps.tool,
      selection: this.selection,
      plan,
      flagged: now < this.feedbackUntil ? this.feedbackTile : undefined,
    });
    if (now < this.feedbackUntil) this.showTip(this.feedbackText, true);
    else if (plan)
      this.showTip(
        areaPreviewText(this.deps.tool, this.settings.lower, plan),
        plan.result !== LandResult.Ok,
      );
    else this.tip.hidden = true;
  }

  dispose(): void {
    this.overlay.clear();
    this.tip.remove();
  }

  private showTip(text: string, bad: boolean): void {
    this.tip.hidden = false;
    this.tip.textContent = text;
    this.tip.classList.toggle('area-tip-bad', bad);
    this.tip.style.left = `${this.pointer.x + 14}px`;
    this.tip.style.top = `${this.pointer.y + 14}px`;
  }

  private point(clientX: number, clientY: number): LandSelection | null {
    this.pointer = { x: clientX, y: clientY };
    const map = this.deps.sim.map;
    if (!map) return (this.selection = null);
    const rect = this.deps.canvas.getBoundingClientRect();
    this.selection = pickLandSelection(
      clientX - rect.left,
      clientY - rect.top,
      map,
      this.deps.camera,
      { width: rect.width, height: rect.height },
      this.settings.size,
      false,
    );
    return this.selection;
  }

  private editFor(selection: LandSelection, alternate: boolean): AreaEdit {
    const { x, y, width, height } = selection;
    if (this.deps.tool === 'clear') return { tool: 'clear', x, y, width, height };
    return { tool: 'water', x, y, width, height, lower: this.settings.lower || alternate };
  }

  /** A water step in the given direction, whatever the Raise or Lower button says. */
  private editWith(selection: LandSelection, lower: boolean): AreaEdit {
    const { x, y, width, height } = selection;
    return { tool: 'water', x, y, width, height, lower };
  }

  private fire(edit: AreaEdit): void {
    const { x, y, width, height } = edit;
    const type = edit.tool === 'clear' ? 'clearScenery' : edit.lower ? 'lowerWater' : 'raiseWater';
    this.deps.sim.command({ type, x, y, width, height });
  }
}
