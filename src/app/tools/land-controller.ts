import { Z_PIXELS } from '../../render/projection';
import type { Camera } from '../../render/renderer';
import { FeedbackDomain } from '../../sim/core/feedback';
import { LandAction, LandResult } from '../../sim/map/land-tool';
import type { LandEdit } from '../../sim/map/land-tool';
import type { LandMode, LandSettings } from '../../ui/ui-types';
import { LandOverlay } from '../../ui/land-overlay';
import type { SimClient } from '../../worker/sim-client';
import type { GameUI } from '../../ui/game-ui';
import { landPreviewText, landRefusalText } from './land-feedback';
import { pickLandSelection } from './land-selection';
import type { LandSelection } from './land-selection';

const FEEDBACK_MS = 2500;
const MIN_STEP_PX = 6;

export interface LandControllerDependencies {
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  sim: SimClient;
  camera: Camera;
  gameUi: GameUI;
  viewport: { width: number; height: number };
  active: () => boolean;
}

function actionOf(mode: LandMode): LandAction {
  return mode === 'raise'
    ? LandAction.Raise
    : mode === 'lower'
      ? LandAction.Lower
      : mode === 'flatten'
        ? LandAction.Flatten
        : LandAction.Smooth;
}

const GERUND: Record<LandMode, string> = {
  raise: 'Raising',
  lower: 'Lowering',
  flatten: 'Flattening',
  smooth: 'Smoothing',
};

interface Drag {
  selection: LandSelection;
  /** Pointer height the next vertical step is measured from. */
  referenceY: number;
  anchor: { x: number; y: number };
  lastTile: string;
}

/**
 * Drives the Land window's tool on the map: previews the edit under the cursor, applies it on
 * tap, and turns vertical drags into repeated raise or lower steps on a fixed selection.
 */
export class LandController {
  settings: LandSettings = { size: 1, mode: 'raise', corners: true };
  private readonly overlay: LandOverlay;
  private readonly tip: HTMLElement;
  private selection: LandSelection | null = null;
  private mode: LandMode = 'raise';
  private pointer = { x: 0, y: 0 };
  private drag: Drag | null = null;
  private requestedKey = '';
  private requestedMap: unknown = null;
  private feedbackSeq = -1;
  private feedbackText = '';
  private feedbackTile: number | undefined;
  private feedbackUntil = 0;

  constructor(private readonly deps: LandControllerDependencies) {
    this.overlay = new LandOverlay(deps.parent);
    this.tip = document.createElement('div');
    this.tip.className = 'land-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.hidden = true;
    deps.parent.append(this.tip);
  }

  configure(settings: LandSettings): void {
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
    this.deps.sim.clearLandPreview();
    this.requestedKey = '';
  }

  /** A finger or button went down: shows the preview straight away for touch input. */
  press(clientX: number, clientY: number): void {
    this.point(clientX, clientY);
  }

  tap(clientX: number, clientY: number, lowerInstead: boolean): void {
    const selection = this.point(clientX, clientY);
    if (!selection) {
      this.deps.gameUi.setToolStatus('Land tool · outside the park map.');
      return;
    }
    this.fire(
      lowerInstead && this.settings.mode === 'raise' ? 'lower' : this.settings.mode,
      selection,
      selection,
    );
  }

  dragStart(clientX: number, clientY: number): void {
    const selection = this.point(clientX, clientY);
    if (!selection) return;
    this.drag = {
      selection,
      referenceY: clientY,
      anchor: { x: selection.cursorX, y: selection.cursorY },
      lastTile: `${selection.cursorX}:${selection.cursorY}`,
    };
  }

  dragMove(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.pointer = { x: clientX, y: clientY };
    if (this.settings.mode === 'raise' || this.settings.mode === 'lower') {
      const step = Math.max(MIN_STEP_PX, Z_PIXELS * this.deps.camera.zoom);
      let steps = 0;
      while (drag.referenceY - clientY >= step && steps < 8) {
        this.fire('raise', drag.selection, drag.selection);
        drag.referenceY -= step;
        steps++;
      }
      while (clientY - drag.referenceY >= step && steps < 8) {
        this.fire('lower', drag.selection, drag.selection);
        drag.referenceY += step;
        steps++;
      }
      return;
    }
    const selection = this.pick(clientX, clientY);
    if (!selection) return;
    const key = `${selection.cursorX}:${selection.cursorY}`;
    if (key === drag.lastTile) return;
    drag.lastTile = key;
    this.selection = selection;
    this.fire(this.settings.mode, selection, {
      ...selection,
      cursorX: drag.anchor.x,
      cursorY: drag.anchor.y,
    });
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
      if (
        latest.feedback.domain === FeedbackDomain.Land &&
        latest.feedback.code !== LandResult.Ok
      ) {
        this.feedbackText = landRefusalText(latest.feedback.code);
        this.feedbackTile = latest.feedback.subject >= 0 ? latest.feedback.subject : undefined;
        this.feedbackUntil = now + FEEDBACK_MS;
      }
    }
    const map = sim.map;
    if (!this.deps.active() || !map || !this.selection) {
      this.overlay.clear();
      this.tip.hidden = !(this.deps.active() && now < this.feedbackUntil);
      if (!this.tip.hidden) this.showTip(this.feedbackText, true);
      return;
    }
    if (map !== this.requestedMap) {
      this.requestedMap = map;
      this.requestedKey = '';
    }
    const edit = this.editFor(this.mode, this.selection, this.selection);
    const key = JSON.stringify(edit);
    if (key !== this.requestedKey) {
      this.requestedKey = key;
      sim.previewLand(edit);
    }
    const answered = sim.landPreview;
    const plan = answered && JSON.stringify(answered.edit) === key ? answered.plan : null;
    const flagged = now < this.feedbackUntil ? this.feedbackTile : undefined;
    this.overlay.draw({
      map,
      camera: this.deps.camera,
      viewport: this.deps.viewport,
      selection: this.selection,
      plan,
      flagged,
    });
    if (now < this.feedbackUntil) this.showTip(this.feedbackText, true);
    else if (plan)
      this.showTip(
        landPreviewText(this.mode, plan.result, plan.costCents),
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
    this.tip.classList.toggle('land-tip-bad', bad);
    this.tip.style.left = `${this.pointer.x + 14}px`;
    this.tip.style.top = `${this.pointer.y + 14}px`;
  }

  private pick(clientX: number, clientY: number): LandSelection | null {
    const map = this.deps.sim.map;
    if (!map) return null;
    const rect = this.deps.canvas.getBoundingClientRect();
    return pickLandSelection(
      clientX - rect.left,
      clientY - rect.top,
      map,
      this.deps.camera,
      { width: rect.width, height: rect.height },
      this.settings.size,
      this.settings.corners && (this.settings.mode === 'raise' || this.settings.mode === 'lower'),
    );
  }

  private point(clientX: number, clientY: number): LandSelection | null {
    this.pointer = { x: clientX, y: clientY };
    this.mode = this.settings.mode;
    this.selection = this.pick(clientX, clientY);
    return this.selection;
  }

  private editFor(mode: LandMode, selection: LandSelection, anchor: LandSelection): LandEdit {
    const edit: LandEdit = {
      action: actionOf(mode),
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height,
    };
    if (mode === 'raise' || mode === 'lower') edit.corners = selection.corners;
    if (mode === 'flatten') {
      edit.anchorX = anchor.cursorX;
      edit.anchorY = anchor.cursorY;
    }
    return edit;
  }

  private fire(mode: LandMode, selection: LandSelection, anchor: LandSelection): void {
    const { x, y, width, height } = selection;
    const area = { x, y, width, height };
    if (mode === 'raise' || mode === 'lower')
      this.deps.sim.command({
        type: mode === 'raise' ? 'raiseLand' : 'lowerLand',
        ...area,
        corners: selection.corners,
      });
    else if (mode === 'flatten')
      this.deps.sim.command({
        type: 'flattenLand',
        ...area,
        anchorX: anchor.cursorX,
        anchorY: anchor.cursorY,
      });
    else this.deps.sim.command({ type: 'smoothLand', ...area });
    this.deps.gameUi.setToolStatus(
      `${GERUND[mode]} land at ${selection.cursorX}, ${selection.cursorY}.`,
    );
  }
}
