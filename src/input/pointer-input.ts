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
}

interface ActivePointer {
  sample: PointerSample;
  startX: number;
  startY: number;
  moved: boolean;
  held: boolean;
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

  constructor(private readonly actions: PointerInputActions) {}

  pointerDown(sample: PointerSample): void {
    if (this.pointers.has(sample.pointerId)) return;
    const active: ActivePointer = {
      sample,
      startX: sample.x,
      startY: sample.y,
      moved: false,
      held: false,
      timer: null,
    };
    this.pointers.set(sample.pointerId, active);

    if (this.pointers.size === 1 && sample.pointerType === 'touch') {
      active.timer = setTimeout(() => {
        if (!active.moved && this.pointers.get(sample.pointerId) === active) {
          active.held = true;
          this.actions.hold(active.sample.x, active.sample.y);
        }
      }, HOLD_DELAY_MS);
    } else if (this.pointers.size === 2) {
      this.cancelHolds();
      const [first, second] = this.twoPointers();
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
      if (this.actions.tool() === 'land' || this.actions.tool() === 'path')
        this.actions.paint(active.startX, active.startY, sample.shiftKey);
    }

    if (this.actions.tool() === 'land' || this.actions.tool() === 'path')
      this.paintBetween(startsDrag ? { x: active.startX, y: active.startY } : previous, sample);
    else if (startsDrag) this.actions.pan(dx, dy);
    else this.actions.pan(sample.x - previous.x, sample.y - previous.y);
  }

  pointerUp(sample: PointerSample): void {
    const active = this.pointers.get(sample.pointerId);
    if (!active) return;
    active.sample = sample;
    this.cancelHold(active);
    this.pointers.delete(sample.pointerId);

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
    this.pointers.clear();
    if (this.pinchStartDistance > 0) this.actions.zoomEnd();
    this.pinchStartDistance = 0;
    this.rotating = false;
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
