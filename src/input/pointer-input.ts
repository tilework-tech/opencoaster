export type PointerTool = 'select' | 'land' | 'path' | string;

export interface PointerSample {
  pointerId: number;
  x: number;
  y: number;
  pointerType: string;
  shiftKey: boolean;
}

export interface PointerInputActions {
  tool(): PointerTool;
  pan(dx: number, dy: number): void;
  zoomStart(x: number, y: number): void;
  zoom(scale: number, x: number, y: number): void;
  zoomEnd(): void;
  rotate(direction: -1 | 1): void;
  tap(x: number, y: number, shiftKey: boolean): void;
  hold(x: number, y: number): void;
  paint(x: number, y: number, shiftKey: boolean): void;
  /** Starts a footpath run drag; false when the drag should pan the view instead. */
  pathDragStart(x: number, y: number): boolean;
  pathDragMove(x: number, y: number): void;
  pathDragEnd(): void;
  pathDragCancel(): void;
  /** A single pointer went down on the map; tools with a live preview show it straight away. */
  press?(x: number, y: number): void;
  /** Land tool: the pointer moved past the tap threshold; the drag began at (x, y). */
  landDragStart?(x: number, y: number): void;
  landDragMove?(x: number, y: number): void;
  landDragEnd?(): void;
}

interface ActivePointer {
  sample: PointerSample;
  startX: number;
  startY: number;
  moved: boolean;
  held: boolean;
  /** This pointer is laying a footpath run rather than panning. */
  pathDrag: boolean;
  paintDrag: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const DRAG_THRESHOLD = 4;
const HOLD_DELAY_MS = 900;
const ROTATE_THRESHOLD_RADIANS = Math.PI / 4;

export class PointerInput {
  private readonly pointers = new Map<number, ActivePointer>();
  private pinchStartDistance = 0;
  private pinchLastAngle = 0;
  private rotationRemainder = 0;
  private rotating = false;
  private landDragging = false;
  /** Two-finger midpoint, tracked so the land tool (whose one-finger drag edits terrain) can pan. */
  private lastMidpoint: [number, number] | null = null;

  constructor(private readonly actions: PointerInputActions) {}

  pointerDown(sample: PointerSample): void {
    if (this.pointers.has(sample.pointerId)) return;
    const active: ActivePointer = {
      sample,
      startX: sample.x,
      startY: sample.y,
      moved: false,
      held: false,
      pathDrag: false,
      paintDrag: false,
      timer: null,
    };
    this.pointers.set(sample.pointerId, active);
    if (this.pointers.size === 1) this.actions.press?.(sample.x, sample.y);

    if (this.pointers.size === 1 && sample.pointerType === 'touch') {
      active.timer = setTimeout(() => {
        if (!active.moved && this.pointers.get(sample.pointerId) === active) {
          active.held = true;
          this.actions.hold(active.sample.x, active.sample.y);
        }
      }, HOLD_DELAY_MS);
    } else if (this.pointers.size === 2) {
      this.cancelHolds();
      this.endLandDrag();
      const [first, second] = this.twoPointers();
      this.lastMidpoint = this.midpoint(first.sample, second.sample);
      const distance = this.distance(first.sample, second.sample);
      this.pinchStartDistance = Math.max(distance, 1);
      this.pinchLastAngle = this.angle(first.sample, second.sample);
      this.rotationRemainder = 0;
      this.rotating = false;
      this.actions.zoomStart(...this.midpoint(first.sample, second.sample));
    } else if (this.pointers.size > 2) {
      this.cancelHolds();
    }
  }

  pointerMove(sample: PointerSample): void {
    const active = this.pointers.get(sample.pointerId);
    if (!active) return;
    const previous = active.sample;
    active.sample = sample;

    if (this.pointers.size >= 2) {
      const [first, second] = this.twoPointers();
      for (const pointer of [first, second]) pointer.moved = true;
      this.cancelHolds();
      const distance = Math.max(this.distance(first.sample, second.sample), 1);
      const [centerX, centerY] = this.midpoint(first.sample, second.sample);
      if (this.actions.tool() === 'land' && this.lastMidpoint)
        this.actions.pan(centerX - this.lastMidpoint[0], centerY - this.lastMidpoint[1]);
      this.lastMidpoint = [centerX, centerY];
      this.actions.zoom(distance / this.pinchStartDistance, centerX, centerY);

      const angle = this.angle(first.sample, second.sample);
      this.rotationRemainder += this.normalizeAngle(angle - this.pinchLastAngle);
      if (this.rotationRemainder >= ROTATE_THRESHOLD_RADIANS) {
        this.actions.rotate(1);
        this.rotationRemainder = 0;
        this.rotating = true;
      }
      if (this.rotationRemainder <= -ROTATE_THRESHOLD_RADIANS) {
        this.actions.rotate(-1);
        this.rotationRemainder = 0;
        this.rotating = true;
      }
      this.pinchLastAngle = angle;
      return;
    }

    const dx = sample.x - active.startX;
    const dy = sample.y - active.startY;
    if (!active.moved && Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
    const startsDrag = !active.moved;
    if (startsDrag) {
      active.moved = true;
      this.cancelHold(active);
      if (this.landDragTool()) {
        this.landDragging = true;
        this.actions.landDragStart?.(active.startX, active.startY);
      } else if (this.actions.tool() === 'land')
        this.actions.paint(active.startX, active.startY, sample.shiftKey);
      else if (this.actions.tool() === 'path')
        active.pathDrag = this.actions.pathDragStart(active.startX, active.startY);
      else if (this.actions.tool() === 'patrol') {
        active.paintDrag = true;
        this.actions.paint(active.startX, active.startY, sample.shiftKey);
      }
    }

    if (this.landDragging) this.actions.landDragMove?.(sample.x, sample.y);
    else if (this.actions.tool() === 'land')
      this.paintBetween(startsDrag ? { x: active.startX, y: active.startY } : previous, sample);
    else if (active.paintDrag)
      this.paintBetween(startsDrag ? { x: active.startX, y: active.startY } : previous, sample);
    else if (active.pathDrag) this.actions.pathDragMove(sample.x, sample.y);
    else if (startsDrag) this.actions.pan(dx, dy);
    else this.actions.pan(sample.x - previous.x, sample.y - previous.y);
  }

  pointerUp(sample: PointerSample): void {
    const active = this.pointers.get(sample.pointerId);
    if (!active) return;
    active.sample = sample;
    this.cancelHold(active);
    this.pointers.delete(sample.pointerId);
    if (active.pathDrag) this.actions.pathDragEnd();
    this.endLandDrag();

    if (this.pointers.size === 1) {
      const [remaining] = this.pointers.values();
      remaining.moved = true;
      if (this.rotating) this.rotating = false;
      this.actions.zoomEnd();
      this.pinchStartDistance = 0;
      return;
    }

    if (this.pointers.size === 0 && this.pinchStartDistance > 0) {
      this.actions.zoomEnd();
      this.pinchStartDistance = 0;
    }

    if (!active.moved && !active.held && !this.rotating)
      this.actions.tap(sample.x, sample.y, sample.shiftKey);
    if (this.pointers.size === 0) this.rotating = false;
  }

  pointerCancel(pointerId: number): void {
    const active = this.pointers.get(pointerId);
    if (active) this.cancelHold(active);
    if (active?.pathDrag) this.actions.pathDragCancel();
    this.endLandDrag();
    this.pointers.clear();
    if (this.pinchStartDistance > 0) this.actions.zoomEnd();
    this.pinchStartDistance = 0;
    this.rotating = false;
  }

  private landDragTool(): boolean {
    const tool = this.actions.tool();
    return (tool === 'land' || tool === 'water') && this.actions.landDragStart !== undefined;
  }

  private endLandDrag(): void {
    if (!this.landDragging) return;
    this.landDragging = false;
    this.actions.landDragEnd?.();
  }

  private twoPointers(): [ActivePointer, ActivePointer] {
    const pointers = [...this.pointers.values()];
    return [pointers[0], pointers[1]];
  }

  private cancelHolds(): void {
    for (const pointer of this.pointers.values()) this.cancelHold(pointer);
  }

  private cancelHold(pointer: ActivePointer): void {
    if (pointer.timer === null) return;
    clearTimeout(pointer.timer);
    pointer.timer = null;
  }

  private distance(a: PointerSample, b: PointerSample): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private angle(a: PointerSample, b: PointerSample): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private midpoint(a: PointerSample, b: PointerSample): [number, number] {
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  private paintBetween(from: { x: number; y: number }, to: PointerSample): void {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(distance / 12);
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      this.actions.paint(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        to.shiftKey,
      );
    }
  }
}
