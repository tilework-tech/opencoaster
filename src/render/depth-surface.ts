import { DepthComposite, compositeFrame } from './depth-composite';
import type { CompositeFrame } from './depth-composite';
import { FIRST_INSTANCE_OBJECT_ID, objectKind } from './object-kinds';
import type { OracleSprite, OracleTriangle } from './occlusion-oracle';
import type { PageImage, SpritePages } from './sprite-pages';

/** Canvas transform of world-screen pixels onto the backing buffer: uniform scale plus offset. */
export interface SurfaceTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * A Canvas2D context wrapper that orders world sprites per pixel by world height (docs.md,
 * "Occlusion model"). Outside `compose` it forwards everything to the real context. Inside,
 * every atlas `drawImage` is depth-composited at the current `anchorHeight` into the frame's
 * pixels, and any other drawing (procedural fallbacks, tinted previews) is replayed on top
 * after the composite is written back.
 */
export class DepthSurface {
  /** World height, in levels, of the ground pivot of the next sprite drawn. */
  anchorHeight = 0;
  readonly context: CanvasRenderingContext2D;
  private readonly target = new DepthComposite();
  private composing = false;
  private transform: SurfaceTransform = { scale: 1, x: 0, y: 0 };
  private alpha = 1;
  private readonly alphaStack: number[] = [];
  private deferred: (() => void)[] = [];
  private nextId = 0;
  private sprites: OracleSprite[] = [];
  private kinds = new Map<number, string>();
  private pageOf = new Map<PageImage, number>();
  private pageOfVersion = -1;
  private readonly frames = new Map<string, CompositeFrame | null>();
  private readonly frameKeys = new Map<string, string>();
  private framesVersion = -1;
  private readonly scratch: HTMLCanvasElement | OffscreenCanvas | null;

  constructor(
    private readonly real: CanvasRenderingContext2D,
    private readonly pages: SpritePages,
  ) {
    this.scratch =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1)
        : typeof document === 'object'
          ? document.createElement('canvas')
          : null;
    this.context = new Proxy(real, {
      get: (target, property) => {
        if (!this.composing) {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return this.composingGet(property);
      },
      set: (target, property, value) => {
        if (!this.composing) return Reflect.set(target, property, value, target);
        if (property === 'globalAlpha') this.alpha = Number(value);
        this.deferred.push(() => Reflect.set(target, property, value, target));
        return true;
      },
    });
  }

  /** Whether the real context can be read back, which compositing needs. */
  get available(): boolean {
    return typeof this.real.getImageData === 'function' && this.scratch !== null;
  }

  /**
   * Starts compositing over what the real context already shows (the painted ground), with
   * `ground` giving that ground's height per pixel. With `recordIds`, ids are kept per pixel and
   * every composited sprite is recorded for the occlusion oracle.
   */
  compose(
    width: number,
    height: number,
    transform: SurfaceTransform,
    ground: readonly OracleTriangle[],
    recordIds = false,
  ): void {
    const image = this.real.getImageData(0, 0, width, height);
    this.image = image;
    this.target.begin(width, height, image.data, recordIds);
    this.target.ground(ground);
    this.transform = transform;
    this.alpha = 1;
    this.alphaStack.length = 0;
    this.deferred = [];
    this.nextId = recordIds ? FIRST_INSTANCE_OBJECT_ID : 0;
    this.sprites = [];
    this.kinds = new Map();
    this.composing = true;
  }

  /** Writes the composite back to the canvas, then replays the drawing that could not join it. */
  finish(): void {
    if (!this.composing || !this.image) return;
    this.composing = false;
    this.real.putImageData(this.image, 0, 0);
    this.real.save();
    this.real.setTransform(
      this.transform.scale,
      0,
      0,
      this.transform.scale,
      this.transform.x,
      this.transform.y,
    );
    for (const draw of this.deferred) draw();
    this.real.restore();
    this.deferred = [];
    this.image = null;
  }

  /** Ids, recorded sprites and kinds of the last composite started with `recordIds`. */
  capture(): { ids: Int32Array; sprites: OracleSprite[]; kinds: Map<number, string> } {
    return { ids: this.target.ids ?? new Int32Array(0), sprites: this.sprites, kinds: this.kinds };
  }

  private image: ImageData | null = null;

  private composingGet(property: string | symbol): unknown {
    const real = this.real;
    switch (property) {
      case 'drawImage':
        return (...args: unknown[]) => {
          if (args.length === 9 && this.drawSprite(args)) return;
          this.deferred.push(() => (real.drawImage as (...a: unknown[]) => void).apply(real, args));
        };
      case 'save':
        return () => {
          this.alphaStack.push(this.alpha);
          this.deferred.push(() => real.save());
        };
      case 'restore':
        return () => {
          this.alpha = this.alphaStack.pop() ?? 1;
          this.deferred.push(() => real.restore());
        };
      case 'globalAlpha':
        return this.alpha;
    }
    const value = Reflect.get(real, property, real) as unknown;
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      this.deferred.push(() => (value as (...a: unknown[]) => unknown).apply(real, args));
    };
  }

  private drawSprite(args: unknown[]): boolean {
    const [image, sx, sy, sw, sh, dx, dy, dw, dh] = args as [
      PageImage,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const page = this.pageIndex(image);
    if (page < 0) return false;
    const frame = this.frame(page, sx, sy, sw, sh);
    if (!frame) return false;
    const { scale, x, y } = this.transform;
    const id = this.target.ids ? this.nextId++ : 0;
    const placement = {
      id,
      left: dx * scale + x,
      top: dy * scale + y,
      width: dw * scale,
      height: dh * scale,
      anchorHeight: this.anchorHeight,
      heightScale: dh / sh,
    };
    this.target.sprite(frame, placement, this.alpha);
    if (this.target.ids && this.alpha >= 1) {
      this.sprites.push({
        ...placement,
        page,
        frame: { x: sx, y: sy, width: sw, height: sh },
      });
      this.kinds.set(id, objectKind(this.frameKeys.get(`${page}:${sx}:${sy}`) ?? ''));
    }
    return true;
  }

  private pageIndex(image: PageImage): number {
    if (this.pageOfVersion !== this.pages.version) {
      this.pageOf = new Map();
      for (const [page, loaded] of this.pages.loadedPages) this.pageOf.set(loaded, page);
      this.pageOfVersion = this.pages.version;
    }
    return this.pageOf.get(image) ?? -1;
  }

  /** The decoded texels of one atlas frame, read once from its colour and height pages. */
  private frame(page: number, x: number, y: number, width: number, height: number) {
    if (this.framesVersion !== this.pages.version) this.indexFrames();
    const key = `${page}:${x}:${y}:${width}:${height}`;
    const cached = this.frames.get(key);
    if (cached !== undefined) return cached;
    const colour = this.pages.pageImage(page);
    const heights = this.pages.pageHeights(page);
    let decoded: CompositeFrame | null = null;
    if (colour && heights && this.scratch) {
      decoded = compositeFrame(
        {
          width,
          height,
          colour: this.readRegion(colour, x, y, width, height),
          heights: this.readRegion(heights, x, y, width, height),
        },
        { x: 0, y: 0, width, height },
      );
    }
    this.frames.set(key, decoded);
    return decoded;
  }

  private readRegion(
    image: PageImage,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Uint8ClampedArray {
    const canvas = this.scratch!;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  }

  private indexFrames(): void {
    this.frames.clear();
    this.frameKeys.clear();
    const manifest = this.pages.spriteEntries;
    for (const [name, entry] of manifest)
      entry.frames.forEach((frame, index) =>
        this.frameKeys.set(`${frame.page}:${frame.x}:${frame.y}`, `${name}#${index}`),
      );
    this.framesVersion = this.pages.version;
  }
}
