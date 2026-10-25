import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag, SLOPE_DIR_SHIFT } from '../sim/map/tile-map';
import { FLOWER_BED } from '../sim/staff/grounds';
import { SCENERY_CATALOG } from '../sim/map/scenery';
import {
  terrainEdgeFace,
  terrainLightFactor,
  terrainTileCorners,
  viewTerrainCornerHeights,
  waterIntersectsTerrainTile,
} from './terrain-geometry';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import type { Camera, MapData, Renderer } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS } from './projection';
import type { Rotation } from './projection';
import {
  facilityFacingFromPaths,
  facilitySpriteKey,
  frameForTick,
  rideHutFacing,
  rideHutSpriteKey,
  rideSpriteKey,
  trackCells,
  trackStyleForRide,
} from './sprite-art';
import {
  pathSpriteName,
  type PathSurface,
  terrainCliffSpriteName,
  scenerySpriteName,
  terrainSurfaceSpriteName,
  WATER_BANK,
  nativeSpriteWorldOffset,
  waterFrameIndex,
  waterSpriteName,
} from './world-art';

const CELL = 64;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 5;
const INSTANCE_FLOATS = 16;
const INITIAL_INSTANCE_CAPACITY = 16_384;
const TREE_NAMES = [
  'tree-oak',
  'tree-conifer',
  'tree-birch',
  'tree-blossom',
  'tree-autumn',
  'tree-topiary',
] as const;

interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteEntry {
  frames: SpriteFrame[];
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
  /** Drawn at frame size with the anchor on the projected point. */
  native?: boolean;
}

interface SpriteAtlasManifest {
  width: number;
  height: number;
  sprites: Record<string, SpriteEntry>;
}

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

type SpriteBlendContext = Pick<
  WebGL2RenderingContext,
  'BLEND' | 'SRC_ALPHA' | 'ONE_MINUS_SRC_ALPHA' | 'enable' | 'blendFunc'
>;

export function enableSpriteAlphaBlending(gl: SpriteBlendContext): void {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

export function terrainSpriteIndex(surface: number, slopeMask: number): number {
  let flatSprite: number;
  switch (surface) {
    case 0:
      flatSprite = 0;
      break;
    case 1:
      flatSprite = 2;
      break;
    case 2:
      return 8;
    case 3:
      return 9;
    case 4:
      flatSprite = 4;
      break;
    case 5:
      flatSprite = 6;
      break;
    case 6:
      return 10;
    default:
      return 0;
  }
  return flatSprite + (slopeMask ? 1 : 0);
}

export function staffSpriteIndex(kind: number): number {
  return 19 + (kind >= 0 && kind <= 3 ? kind : 0);
}

export function litterSpriteIndex(kind: number): number {
  return kind === 1 ? 25 : 24;
}

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aWorld;
layout(location=2) in vec2 aSize;
layout(location=3) in vec4 aUvRect;
layout(location=4) in float aMeshMode;
layout(location=5) in vec4 aCornerHeights;
layout(location=6) in float aGridlines;
layout(location=7) in float aTerrainShade;
uniform vec2 uViewport;
uniform vec2 uMapSize;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uRotation;
out vec2 vUv;
out vec2 vTileUv;
out float vMeshMode;
out float vGridlines;
out float vTerrainShade;
out float vWaterDepth;
void main() {
  bool tileMesh = aMeshMode > 0.5 && aMeshMode < 3.5;
  bool faceMesh = aMeshMode > 3.5;
  float cornerHeight = aWorld.z;
  if ((aMeshMode > 0.5 && aMeshMode < 1.5) || aMeshMode > 2.5) {
    if (aCorner.x < 0.5 && aCorner.y < 0.5) cornerHeight = aCornerHeights.x;
    else if (aCorner.x >= 0.5 && aCorner.y < 0.5) cornerHeight = aCornerHeights.y;
    else if (aCorner.x >= 0.5 && aCorner.y >= 0.5) cornerHeight = aCornerHeights.z;
    else cornerHeight = aCornerHeights.w;
  }
  vec2 world = aWorld.xy;
  if (faceMesh) {
    world += aSize * aCorner.x;
    float topHeight = mix(aCornerHeights.x, aCornerHeights.y, aCorner.x);
    cornerHeight = mix(topHeight, aWorld.z, aCorner.y);
  }
  float z = tileMesh ? aWorld.z : cornerHeight;
  float rx = world.x / ${TILE_UNITS.toFixed(1)};
  float ry = world.y / ${TILE_UNITS.toFixed(1)};
  if (!tileMesh && uRotation > 0.5 && uRotation < 1.5) {
    float next = uMapSize.y - ry;
    ry = rx;
    rx = next;
  } else if (!tileMesh && uRotation > 1.5 && uRotation < 2.5) {
    rx = uMapSize.x - rx;
    ry = uMapSize.y - ry;
  } else if (!tileMesh && uRotation > 2.5) {
    float next = ry;
    ry = uMapSize.x - rx;
    rx = next;
  }
  vec2 screen = vec2((rx - ry) * ${glslFloat(TILE_W / 2)},
                     (rx + ry) * ${glslFloat(TILE_H / 2)} - z * ${glslFloat(Z_PIXELS / Z_STEP)});
  screen = (screen - uCamera) * uZoom + uViewport * 0.5;
  if (tileMesh) {
    vec2 tileOffset = vec2((aCorner.x - aCorner.y) * ${glslFloat(TILE_W / 2)},
                           (aCorner.x + aCorner.y) * ${glslFloat(TILE_H / 2)});
    tileOffset = (tileOffset - vec2(0.0, ${glslFloat(TILE_H / 2)})) * 1.0 +
                 vec2(0.0, ${glslFloat(TILE_H / 2)});
    float baseZ = aWorld.z;
    screen += tileOffset * uZoom;
    if (aMeshMode < 1.5)
      screen.y -= (cornerHeight - baseZ) * ${glslFloat(Z_PIXELS / Z_STEP)} * uZoom;
  } else if (!faceMesh) {
    screen += (aCorner - 0.5) * aSize * uZoom;
  }
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vec2 spriteUv = vec2(aCorner.x, 1.0 - aCorner.y);
  vUv = mix(aUvRect.xy, aUvRect.zw, spriteUv);
  vTileUv = aCorner;
  vMeshMode = aMeshMode;
  vGridlines = aGridlines;
  vTerrainShade = aTerrainShade;
  vWaterDepth = aWorld.z - cornerHeight;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec2 vTileUv;
in float vMeshMode;
in float vGridlines;
in float vTerrainShade;
in float vWaterDepth;
uniform sampler2D uAtlas;
out vec4 outColor;
void main() {
  if (vMeshMode > 2.5 && vMeshMode < 3.5 && vWaterDepth < 0.0) discard;
  outColor = texture(uAtlas, vUv);
  if (vMeshMode > 2.5 && vMeshMode < 3.5) {
    float depth = vWaterDepth;
    float foam = 1.0 - step(${glslFloat(WATER_BANK.foamDepth)}, depth);
    float shallow = 1.0 - smoothstep(${glslFloat(WATER_BANK.foamDepth)}, ${glslFloat(WATER_BANK.shallowDepth)}, depth);
    float deep = smoothstep(${glslFloat(WATER_BANK.shallowDepth)}, ${glslFloat(WATER_BANK.deepDepth)}, depth);
    outColor.rgb = mix(outColor.rgb, vec3(0.16, 0.42, 0.66), deep * 0.55);
    outColor.rgb = mix(outColor.rgb, vec3(0.62, 0.86, 0.95), shallow * 0.4);
    outColor.rgb = mix(outColor.rgb, vec3(0.95, 0.99, 1.0), foam * 0.7);
  }
  if (vMeshMode > 0.5 && vMeshMode < 1.5) outColor.rgb *= vTerrainShade;
  if (vGridlines > 0.5 && vMeshMode > 0.5 && vMeshMode < 1.5) {
    vec2 edge = min(vTileUv, 1.0 - vTileUv);
    float width = max(fwidth(vTileUv.x), fwidth(vTileUv.y)) * 1.2;
    float line = 1.0 - smoothstep(width, width * 1.8, min(edge.x, edge.y));
    outColor.rgb = mix(outColor.rgb, outColor.rgb * 0.9, line * 0.1);
  }
}`;

/** WebGL2 renderer using one runtime-generated atlas and a single instanced quad batch. */
export class WebGL2Renderer implements Renderer {
  readonly backend = 'WebGL2';
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private map: MapData | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private fallbackAtlas: HTMLCanvasElement | null = null;
  private generatedAtlas: { image: ImageBitmap; manifest: SpriteAtlasManifest } | null = null;
  private atlasFrames: Record<string, SpriteEntry> = {};
  private atlasWidth = CELL * ATLAS_COLUMNS;
  private atlasHeight = CELL * ATLAS_ROWS;
  private atlasRequestStarted = false;
  private uniforms: {
    atlas: WebGLUniformLocation | null;
    viewport: WebGLUniformLocation | null;
    mapSize: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
  } | null = null;
  private instanceData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private depths = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private orderedData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private readonly projected = new Float64Array(2);
  private readonly tileCoordinates = new Int32Array(2);
  private readonly rideTypes = new Map<number, RideType>();
  private readonly order: number[] = [];
  private count = 0;
  private visibleCount = 0;
  private gridlinesActive = false;
  private dpr = 1;
  private lost = false;
  private readonly onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.initializeResources();
  };

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  attach(canvas: HTMLCanvasElement): void {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initializeResources();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    if (!this.canvas) return;
    this.dpr = devicePixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setMap(map: MapData): void {
    this.map = map;
  }

  draw(snapshot: Snapshot | null, camera: Camera): void {
    const gl = this.gl;
    const canvas = this.canvas;
    const map = this.map;
    if (!gl || !canvas || !map || this.lost || !this.program || !this.vao || !this.texture) return;

    this.count = 0;
    const viewportWidth = canvas.width / this.dpr;
    const viewportHeight = canvas.height / this.dpr;
    gl.clearColor(0.06, 0.08, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.appendTiles(map, camera, viewportWidth, viewportHeight, snapshot?.tick ?? 0);
    if (snapshot) {
      this.appendAmbientTrees(map, camera, viewportWidth, viewportHeight);
      this.appendGrounds(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendPathElements(map, camera, viewportWidth, viewportHeight);
      this.appendSceneryElements(map, camera, viewportWidth, viewportHeight);
      this.appendParkGate(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendRideMarkers(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendRideTracks(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendRideSprites(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendVariantLayer(
        snapshot.litter,
        litterSpriteIndex,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        7,
        8,
      );
      this.appendLayer(snapshot.vehicles, 23, map, camera, viewportWidth, viewportHeight, 12, 12);
      this.appendVariantLayer(
        snapshot.staff,
        staffSpriteIndex,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        11,
        13,
      );
      this.appendGuests(snapshot.guests, map, camera, viewportWidth, viewportHeight);
    }
    this.uploadInPainterOrder();

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const uniforms = this.uniforms;
    if (!uniforms) return;
    gl.uniform1i(uniforms.atlas, 0);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.mapSize, map.width, map.height);
    gl.uniform2f(uniforms.camera, camera.x, camera.y);
    gl.uniform1f(uniforms.zoom, camera.zoom);
    gl.uniform1f(uniforms.rotation, camera.rotation);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    this.visibleCount = this.count;
  }

  dispose(): void {
    this.canvas?.removeEventListener('webglcontextlost', this.onLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.canvas = null;
    this.gl = null;
    this.map = null;
  }

  private initializeResources(): void {
    const gl = this.gl;
    if (!gl) return;
    enableSpriteAlphaBlending(gl);
    const shaderProgram = gl.createProgram();
    if (!shaderProgram) throw new Error('Could not create WebGL program');
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(shaderProgram, vertex);
    gl.attachShader(shaderProgram, fragment);
    gl.linkProgram(shaderProgram);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(shaderProgram) ?? 'unknown program link error';
      gl.deleteProgram(shaderProgram);
      throw new Error(reason);
    }
    this.program = shaderProgram;
    this.uniforms = {
      atlas: gl.getUniformLocation(shaderProgram, 'uAtlas'),
      viewport: gl.getUniformLocation(shaderProgram, 'uViewport'),
      mapSize: gl.getUniformLocation(shaderProgram, 'uMapSize'),
      camera: gl.getUniformLocation(shaderProgram, 'uCamera'),
      zoom: gl.getUniformLocation(shaderProgram, 'uZoom'),
      rotation: gl.getUniformLocation(shaderProgram, 'uRotation'),
    };

    this.vao = gl.createVertexArray();
    this.instanceBuffer = gl.createBuffer();
    if (!this.vao || !this.instanceBuffer) throw new Error('Could not allocate sprite buffers');
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    if (!quad) throw new Error('Could not allocate quad buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    this.setInstanceAttribute(1, 3, 0);
    this.setInstanceAttribute(2, 2, 3 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(3, 4, 5 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(4, 1, 9 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(5, 4, 10 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(6, 1, 14 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(7, 1, 15 * Float32Array.BYTES_PER_ELEMENT);
    this.fallbackAtlas = document.createElement('canvas');
    this.fallbackAtlas.width = CELL * ATLAS_COLUMNS;
    this.fallbackAtlas.height = CELL * ATLAS_ROWS;
    const fallbackContext = this.fallbackAtlas.getContext('2d');
    if (!fallbackContext) throw new Error('Could not generate fallback sprite atlas');
    drawAtlas(fallbackContext);
    this.atlasWidth = this.fallbackAtlas.width;
    this.atlasHeight = this.fallbackAtlas.height;
    this.texture = this.createAtlasTexture(this.fallbackAtlas);
    if (this.generatedAtlas) this.installGeneratedAtlas(this.generatedAtlas);
    else this.loadGeneratedAtlas();
    gl.bindVertexArray(null);
  }

  private setInstanceAttribute(location: number, size: number, offset: number): void {
    const gl = this.gl;
    if (!gl) return;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, INSTANCE_FLOATS * 4, offset);
    gl.vertexAttribDivisor(location, 1);
  }

  private compileShader(kind: number, source: string): WebGLShader {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Could not create WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  }

  private createAtlasTexture(atlas: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (atlas.width > maxSize || atlas.height > maxSize)
      throw new Error('Sprite atlas exceeds GPU limit');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate sprite atlas texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private loadGeneratedAtlas(): void {
    if (this.atlasRequestStarted || typeof fetch !== 'function') return;
    this.atlasRequestStarted = true;
    void (async () => {
      const spritesBase = `${import.meta.env.BASE_URL}sprites/`;
      const manifestResponse = await fetch(`${spritesBase}manifest.json`);
      if (!manifestResponse.ok) return;
      const manifest = (await manifestResponse.json()) as SpriteAtlasManifest;
      const imageResponse = await fetch(`${spritesBase}atlas.png`);
      if (!imageResponse.ok) return;
      const image = await createImageBitmap(await imageResponse.blob());
      this.generatedAtlas = { image, manifest };
      this.installGeneratedAtlas(this.generatedAtlas);
    })().catch(() => {
      this.atlasRequestStarted = false;
    });
  }

  private installGeneratedAtlas(assets: {
    image: ImageBitmap;
    manifest: SpriteAtlasManifest;
  }): void {
    const gl = this.gl;
    const fallback = this.fallbackAtlas;
    if (!gl || !fallback || this.lost) return;
    const width = assets.image.width + fallback.width + 2;
    const height = Math.max(assets.image.height, fallback.height);
    const combined = document.createElement('canvas');
    combined.width = width;
    combined.height = height;
    const context = combined.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(assets.image, 0, 0);
    context.drawImage(fallback, assets.image.width + 2, 0);
    const texture = this.createAtlasTexture(combined);
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = texture;
    this.atlasWidth = width;
    this.atlasHeight = height;
    this.atlasFrames = assets.manifest.sprites;
  }

  private appendTiles(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    tick: number,
  ): void {
    this.gridlinesActive = camera.showGridlines ?? false;
    const [viewW, viewH] =
      camera.rotation % 2 === 0 ? [map.width, map.height] : [map.height, map.width];
    const left = camera.x - viewportWidth / camera.zoom / 2 - TILE_W;
    const right = camera.x + viewportWidth / camera.zoom / 2 + TILE_W;
    const top = camera.y - viewportHeight / camera.zoom / 2 - TILE_H - 31 * Z_PIXELS;
    const bottom = camera.y + viewportHeight / camera.zoom / 2 + TILE_H;
    for (let ry = 0; ry < viewH; ry++) {
      for (let rx = 0; rx < viewW; rx++) {
        unrotateForDraw(rx, ry, map.width, map.height, camera.rotation, this.tileCoordinates);
        const x = this.tileCoordinates[0];
        const y = this.tileCoordinates[1];
        const index = y * map.width + x;
        const height = map.heights[index];
        project(
          x * TILE_UNITS,
          y * TILE_UNITS,
          height * 64,
          map.width,
          map.height,
          camera.rotation,
          this.projected,
        );
        if (
          this.projected[0] < left ||
          this.projected[0] > right ||
          this.projected[1] < top ||
          this.projected[1] > bottom
        )
          continue;
        const surface = map.surface[index];
        const terrainSurface =
          surface === 1 ? 'sand' : surface === 4 ? 'dirt' : surface === 5 ? 'rock' : 'grass';
        const mask = map.slope[index];
        const worldCorners = [
          (height + (mask & 1)) * 64,
          (height + ((mask >> 1) & 1)) * 64,
          (height + ((mask >> 2) & 1)) * 64,
          (height + ((mask >> 3) & 1)) * 64,
        ] as const;
        const corners = viewTerrainCornerHeights(worldCorners, camera.rotation);
        this.append(
          rx * TILE_UNITS,
          ry * TILE_UNITS,
          height * 64,
          TILE_W,
          TILE_H,
          terrainSurfaceSpriteName(terrainSurface),
          2 * (rx + ry) - height,
          1,
          corners,
          terrainLightFactor(corners),
        );
        const tileCorners = terrainTileCorners(x, y, height, mask);
        for (let direction = 0; direction < 4; direction++) {
          const onMapEdge =
            (direction === 0 && x === map.width - 1) ||
            (direction === 1 && y === map.height - 1) ||
            (direction === 2 && x === 0) ||
            (direction === 3 && y === 0);
          if (!onMapEdge) continue;
          const face = terrainEdgeFace(tileCorners, direction, 0);
          if (!face) continue;
          const top = Math.max(face.start.height, face.end.height);
          const bottom = face.bottomHeight;
          if (top <= bottom) continue;
          this.append(
            face.start.x * TILE_UNITS,
            face.start.y * TILE_UNITS,
            bottom * 64,
            (face.end.x - face.start.x) * TILE_UNITS,
            (face.end.y - face.start.y) * TILE_UNITS,
            terrainCliffSpriteName(terrainSurface, (direction + camera.rotation) & 3),
            2 * (rx + ry) - height - bottom + 0.25,
            4,
            [face.start.height * 64, face.end.height * 64, bottom * 64, bottom * 64],
          );
        }
        const waterLevel = map.waterLevel?.[index] ?? 0;
        if (waterIntersectsTerrainTile(waterLevel, mask, height)) {
          this.append(
            rx * TILE_UNITS,
            ry * TILE_UNITS,
            map.waterLevel![index] * 64 - WATER_BANK.surfaceInset,
            TILE_W,
            TILE_H,
            waterSpriteName(waterFrameIndex(tick)),
            2 * (rx + ry) - map.waterLevel![index] + 2,
            3,
            corners,
          );
        } else if (surface === 3 || surface === 6)
          this.append(
            (x + 0.5) * TILE_UNITS,
            (y + 0.5) * TILE_UNITS,
            height * 64 + 1,
            44,
            24,
            pathSpriteName(surface === 6 ? 'queue' : 'tarmac', 0),
            2 * (rx + ry) - height + 1,
          );
      }
    }
  }

  private appendAmbientTrees(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        if (map.surface[index] !== 0 || (x * 17 + y * 31) % 23 !== 7) continue;
        const sprite = scenerySpriteName(TREE_NAMES[(x * 3 + y * 5) % TREE_NAMES.length]);
        const z = map.heights[index] * Z_STEP;
        const worldX = x * TILE_UNITS + TILE_UNITS / 2;
        const worldY = y * TILE_UNITS + TILE_UNITS / 2;
        const depth =
          2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation) + 2;
        project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
        if (
          inViewport(
            this.projected[0],
            this.projected[1],
            camera,
            viewportWidth,
            viewportHeight,
            34,
            44,
          )
        )
          this.append(worldX, worldY, z, 34, 44, sprite, depth);
      }
    }
  }

  private appendGrounds(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const count = Math.min(map.width * map.height, snapshot.grounds.length);
    for (let index = 0; index < count; index++) {
      if ((snapshot.grounds[index] & FLOWER_BED) === 0) continue;
      const x = index % map.width;
      const y = Math.floor(index / map.width);
      const z = map.heights[index] * Z_STEP + 1;
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const depth =
        2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation) + 1;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          30,
          12,
        )
      )
        this.append(worldX, worldY, z, 30, 12, scenerySpriteName('flower-bed'), depth);
    }
  }

  private appendParkGate(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const { entranceX, entranceY } = snapshot.park;
    if (entranceX < 0 || entranceY < 0 || entranceX >= map.width || entranceY >= map.height) return;
    const z = map.heights[entranceY * map.width + entranceX] * Z_STEP + 1;
    const worldX = entranceX * TILE_UNITS + TILE_UNITS / 2;
    const worldY = entranceY * TILE_UNITS + TILE_UNITS / 2;
    const depth =
      2 * rotatedPositionSum(entranceX * TILE_UNITS, entranceY * TILE_UNITS, map, camera.rotation) +
      3;
    project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
    if (
      inViewport(
        this.projected[0],
        this.projected[1],
        camera,
        viewportWidth,
        viewportHeight,
        46,
        40,
      )
    )
      this.appendAtlasSprite(
        worldX,
        worldY,
        z,
        `${scenerySpriteName('park-entrance')}/view-${camera.rotation}`,
        depth,
        map,
        camera,
        viewportWidth,
        viewportHeight,
      );
  }

  private appendPathElements(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const paths = map.pathElements;
    const count = Math.min(map.pathCount ?? 0, paths ? paths.length / 6 : 0);
    if (!paths) return;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const x = paths[o];
      const y = paths[o + 1];
      const z = paths[o + 2] * Z_STEP;
      const flags = paths[o + 3];
      const slope = (flags & PathFlag.Sloped) !== 0;
      const direction = (flags & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT;
      const isQueue = (flags & PathFlag.Queue) !== 0;
      const edges = (flags & PathFlag.Edges) | ((flags & PathFlag.Forced) >> 4);
      const sprite = pathSpriteName(
        isQueue
          ? 'queue'
          : ((['tarmac', 'crazy-paving', 'dirt'][paths[o + 5]] ?? 'tarmac') as PathSurface),
        edges,
        slope ? direction : undefined,
        camera.rotation,
      );
      const depth =
        2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation) - z / Z_STEP;
      const worldX = x * TILE_UNITS + 128;
      const worldY = y * TILE_UNITS + 128;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          40,
          26,
        )
      )
        this.append(worldX, worldY, z, 40, 26, sprite, depth + 1);
      if ((flags & (PathFlag.Bin | PathFlag.Bench | PathFlag.Lamp | PathFlag.Shelter)) !== 0) {
        const sprite = scenerySpriteName(
          (flags & PathFlag.Bin) !== 0
            ? 'bin'
            : (flags & PathFlag.Bench) !== 0
              ? 'bench'
              : (flags & PathFlag.Shelter) !== 0
                ? 'shelter'
                : 'lamp',
        );
        this.append(worldX, worldY, z + Z_STEP, 12, 16, sprite, depth + 2);
      }
      if (isQueue)
        this.append(
          worldX,
          worldY,
          z + Z_STEP / 2,
          30,
          10,
          scenerySpriteName('queue-rail'),
          depth + 2,
        );
    }
  }

  private appendSceneryElements(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const items = map.sceneryElements;
    const count = Math.min(map.sceneryCount ?? 0, items ? items.length / 5 : 0);
    if (!items) return;
    for (let i = 0; i < count; i++) {
      const offset = i * 5;
      const x = items[offset];
      const y = items[offset + 1];
      const z = items[offset + 2] * Z_STEP;
      const item = SCENERY_CATALOG[items[offset + 4]];
      if (!item) continue;
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const depth =
        2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation) + 2;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      const spriteHeight = item.height * 12;
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          item.width,
          spriteHeight,
        )
      )
        continue;
      this.append(
        worldX,
        worldY,
        z,
        item.width,
        spriteHeight,
        scenerySpriteName(item.sprite),
        depth,
      );
    }
  }

  private appendRideMarkers(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const flags = snapshot.rideInfo[o + RideInfo.Flags];
      const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
      const category = RIDE_CATALOG[type]?.category;
      if (!category || ['shop', 'stall', 'facility'].includes(category)) continue;
      this.rideTypes.set(snapshot.rideInfo[o + RideInfo.Id], type);
      for (const [flag, xField, yField, part] of [
        [RideFlag.EntrancePlaced, RideInfo.EntranceX, RideInfo.EntranceY, 'entrance'],
        [RideFlag.ExitPlaced, RideInfo.ExitX, RideInfo.ExitY, 'exit'],
      ] as const) {
        if ((flags & flag) === 0) continue;
        const x = snapshot.rideInfo[o + xField];
        const y = snapshot.rideInfo[o + yField];
        const facing = rideHutFacing(
          snapshot.rideInfo[o + RideInfo.RideX],
          snapshot.rideInfo[o + RideInfo.RideY],
          x,
          y,
        );
        const index = y * map.width + x;
        const z = map.heights[index] * Z_STEP + 1;
        const depth =
          2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation) -
          z / Z_STEP +
          2;
        const centerX = x * TILE_UNITS + 128;
        const centerY = y * TILE_UNITS + 128;
        this.appendAtlasSprite(
          centerX,
          centerY,
          z,
          rideHutSpriteKey(type, part, facing, camera.rotation),
          depth,
          map,
          camera,
          viewportWidth,
          viewportHeight,
        );
      }
    }
  }

  private appendRideSprites(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
      const def = RIDE_CATALOG[type];
      if (!def || def.usesTrack) continue;
      const x = snapshot.rideInfo[o + RideInfo.RideX];
      const y = snapshot.rideInfo[o + RideInfo.RideY];
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const mapIndex = y * map.width + x;
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const z = map.heights[mapIndex] * Z_STEP + 1;
      const depth = 2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, map, camera.rotation);
      const isFacility = ['shop', 'stall', 'facility'].includes(def.category);
      const key = isFacility
        ? facilitySpriteKey(
            type,
            facilityFacingFromPaths(x, y, map.pathElements, map.pathCount ?? 0),
            camera.rotation,
          )
        : rideSpriteKey(type, camera.rotation);
      const frameCount = this.atlasFrames[key]?.frames.length ?? 1;
      this.appendAtlasSprite(
        worldX,
        worldY,
        z,
        `${key}#${frameForTick(snapshot.tick, frameCount)}`,
        depth,
        map,
        camera,
        viewportWidth,
        viewportHeight,
      );
    }
  }

  private appendRideTracks(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    this.rideTypes.clear();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      this.rideTypes.set(
        snapshot.rideInfo[offset + RideInfo.Id],
        snapshot.rideInfo[offset + RideInfo.Type] as RideType,
      );
    }
    const tracks = snapshot.tracks;
    for (let i = 0; i < tracks.count; i++) {
      const offset = i * SNAPSHOT_STRIDE;
      const x = Math.floor(tracks.data[offset] / TILE_UNITS);
      const y = Math.floor(tracks.data[offset + 1] / TILE_UNITS);
      const z = tracks.data[offset + 2];
      const packed = tracks.data[offset + 3];
      const rideId = packed >>> 16;
      const type = this.rideTypes.get(rideId);
      if (type === undefined) continue;
      const style = trackStyleForRide(type);
      const direction = (packed >>> 8) & 0xff;
      const cells = trackCells(packed & 0xff, direction, camera.rotation, style);
      for (const cell of cells) {
        const cellX = x + cell.dx;
        const cellY = y + cell.dy;
        const worldX = cellX * TILE_UNITS + TILE_UNITS / 2;
        const worldY = cellY * TILE_UNITS + TILE_UNITS / 2;
        const depth =
          2 * rotatedPositionSum(cellX * TILE_UNITS, cellY * TILE_UNITS, map, camera.rotation) -
          z / Z_STEP +
          1;
        this.appendAtlasSprite(
          worldX,
          worldY,
          z,
          cell.key,
          depth,
          map,
          camera,
          viewportWidth,
          viewportHeight,
        );
      }
    }
  }

  private appendAtlasSprite(
    x: number,
    y: number,
    z: number,
    sprite: string,
    depth: number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const name = sprite.replace(/#\d+$/, '');
    const entry = this.atlasFrames[name];
    const frameIndex = Number(/#(\d+)$/.exec(sprite)?.[1] ?? 0);
    const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
    const width = frame?.width ?? 64;
    const height = frame?.height ?? 64;
    project(x, y, z, map.width, map.height, camera.rotation, this.projected);
    if (
      !inViewport(
        this.projected[0],
        this.projected[1],
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
      )
    )
      return;
    this.append(x, y, z, width, height, sprite, depth);
  }

  private appendGuests(
    layer: SnapshotLayer,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0, offset = 0; i < layer.count; i++, offset += SNAPSHOT_STRIDE) {
      const tint = layer.data[offset + 3] & 0xff;
      const depth =
        2 * rotatedPositionSum(layer.data[offset], layer.data[offset + 1], map, camera.rotation) -
        layer.data[offset + 2] / 64;
      this.appendLayerSprite(
        layer,
        offset,
        11 + (tint % 8),
        map,
        camera,
        viewportWidth,
        viewportHeight,
        7,
        9,
        depth,
      );
    }
  }

  private appendLayer(
    layer: SnapshotLayer,
    sprite: number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
    offset = 0,
  ): void {
    for (let i = 0; i < layer.count; i++) {
      const dataOffset = i * SNAPSHOT_STRIDE;
      const depth =
        2 *
          rotatedPositionSum(
            layer.data[dataOffset],
            layer.data[dataOffset + 1],
            map,
            camera.rotation,
          ) -
        layer.data[dataOffset + 2] / 64 +
        offset;
      this.appendLayerSprite(
        layer,
        dataOffset,
        sprite,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
        depth,
      );
    }
  }

  private appendVariantLayer(
    layer: SnapshotLayer,
    spriteFor: (kind: number) => number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
  ): void {
    for (let i = 0; i < layer.count; i++) {
      const offset = i * SNAPSHOT_STRIDE;
      const dataOffset = offset + 3;
      const depth =
        2 * rotatedPositionSum(layer.data[offset], layer.data[offset + 1], map, camera.rotation) -
        layer.data[offset + 2] / 64;
      this.appendLayerSprite(
        layer,
        offset,
        spriteFor(layer.data[dataOffset] & 0xff),
        map,
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
        depth,
      );
    }
  }

  private appendLayerSprite(
    layer: SnapshotLayer,
    offset: number,
    sprite: number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    const x = layer.data[offset];
    const y = layer.data[offset + 1];
    const z = layer.data[offset + 2];
    project(x, y, z, map.width, map.height, camera.rotation, this.projected);
    if (
      !inViewport(
        this.projected[0],
        this.projected[1],
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
      )
    )
      return;
    this.append(x, y, z, width, height, sprite, depth);
  }

  private append(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    sprite: number | string,
    depth: number,
    meshMode = 0,
    cornerHeights: readonly number[] = [z, z, z, z],
    terrainShade = 1,
  ): void {
    if (this.count === this.depths.length) this.grow();
    const offset = this.count * INSTANCE_FLOATS;
    let frame: SpriteFrame | undefined;
    let entry: SpriteEntry | undefined;
    let frameIndex: number;
    let fallbackIndex = -1;
    if (typeof sprite === 'string') {
      const match = /#(\d+)$/.exec(sprite);
      const spriteName = match ? sprite.slice(0, match.index) : sprite;
      frameIndex = match ? Number(match[1]) : 0;
      entry = this.atlasFrames[spriteName];
      frame = entry?.frames[frameIndex] ?? entry?.frames[0];
    } else {
      fallbackIndex = sprite;
    }
    let u0: number;
    let v0: number;
    let u1: number;
    let v1: number;
    if (frame) {
      u0 = (frame.x + 0.5) / this.atlasWidth;
      v0 = 1 - (frame.y + frame.height - 0.5) / this.atlasHeight;
      u1 = (frame.x + frame.width - 0.5) / this.atlasWidth;
      v1 = 1 - (frame.y + 0.5) / this.atlasHeight;
      if (!meshMode && entry?.native) {
        width = frame.width;
        height = frame.height;
        z += nativeSpriteWorldOffset(frame.height, entry.anchor.y);
      } else if (!meshMode && entry)
        z += (entry.anchor.y / frame.height - 0.5) * height * (Z_PIXELS / 64);
      if (meshMode === 2) {
        const insetX = 0.28;
        const oldU0 = u0;
        const oldV0 = v0;
        u0 = oldU0 + (u1 - oldU0) * insetX;
        u1 = oldU0 + (u1 - oldU0) * (1 - insetX);
        v0 = oldV0 + (v1 - oldV0) * 0.28;
        v1 = oldV0 + (v1 - oldV0) * 0.72;
      }
    } else {
      if (fallbackIndex < 0) {
        fallbackIndex = 0;
        if (typeof sprite === 'string') {
          if (sprite.startsWith('paths/')) fallbackIndex = sprite.includes('/queue/') ? 10 : 9;
          else if (sprite.startsWith('water/')) fallbackIndex = 8;
          else if (sprite.includes('/bench')) fallbackIndex = 29;
          else if (sprite.includes('/bin')) fallbackIndex = 28;
          else if (sprite.includes('/lamp')) fallbackIndex = 30;
          else if (sprite.includes('/park-entrance')) fallbackIndex = 31;
          else if (sprite.includes('/flower-bed')) fallbackIndex = 0;
        }
      }
      const fallbackX = (this.generatedAtlas?.image.width ?? 0) + (this.generatedAtlas ? 2 : 0);
      const x = fallbackX + (fallbackIndex % ATLAS_COLUMNS) * CELL;
      const y = Math.floor(fallbackIndex / ATLAS_COLUMNS) * CELL;
      u0 = x / this.atlasWidth;
      v0 = 1 - (y + CELL) / this.atlasHeight;
      u1 = (x + CELL) / this.atlasWidth;
      v1 = 1 - y / this.atlasHeight;
    }
    this.instanceData[offset] = x;
    this.instanceData[offset + 1] = y;
    this.instanceData[offset + 2] = z;
    this.instanceData[offset + 3] = width;
    this.instanceData[offset + 4] = height;
    this.instanceData[offset + 5] = u0;
    this.instanceData[offset + 6] = v0;
    this.instanceData[offset + 7] = u1;
    this.instanceData[offset + 8] = v1;
    this.instanceData[offset + 9] = meshMode;
    this.instanceData[offset + 10] = cornerHeights[0] ?? z;
    this.instanceData[offset + 11] = cornerHeights[1] ?? z;
    this.instanceData[offset + 12] = cornerHeights[2] ?? z;
    this.instanceData[offset + 13] = cornerHeights[3] ?? z;
    this.instanceData[offset + 14] = meshMode === 1 && this.gridlinesActive ? 1 : 0;
    this.instanceData[offset + 15] = terrainShade;
    this.depths[this.count] = Math.round(depth * 2);
    this.count++;
  }

  private grow(): void {
    const nextCapacity = this.depths.length * 2;
    const nextData = new Float32Array(nextCapacity * INSTANCE_FLOATS);
    nextData.set(this.instanceData);
    this.instanceData = nextData;
    const nextDepths = new Int32Array(nextCapacity);
    nextDepths.set(this.depths);
    this.depths = nextDepths;
    const nextOrdered = new Float32Array(nextCapacity * INSTANCE_FLOATS);
    nextOrdered.set(this.orderedData);
    this.orderedData = nextOrdered;
    const gl = this.gl;
    if (gl && this.instanceBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    }
  }

  private uploadInPainterOrder(): void {
    const gl = this.gl;
    const buffer = this.instanceBuffer;
    if (!gl || !buffer) return;
    this.order.length = this.count;
    for (let i = 0; i < this.count; i++) this.order[i] = i;
    this.order.sort((a, b) => this.depths[a] - this.depths[b] || a - b);
    for (let i = 0; i < this.count; i++) {
      const from = this.order[i] * INSTANCE_FLOATS;
      const to = i * INSTANCE_FLOATS;
      for (let j = 0; j < INSTANCE_FLOATS; j++)
        this.orderedData[to + j] = this.instanceData[from + j];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.orderedData.subarray(0, this.count * INSTANCE_FLOATS),
      gl.DYNAMIC_DRAW,
    );
  }
}

function drawAtlas(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < ATLAS_COLUMNS * ATLAS_ROWS; i++) {
    const x = (i % ATLAS_COLUMNS) * CELL;
    const y = Math.floor(i / ATLAS_COLUMNS) * CELL;
    ctx.save();
    ctx.translate(x, y);
    if (i <= 8) drawTerrain(ctx, i);
    else if (i === 9 || i === 10) drawPath(ctx, i === 10);
    else if (i >= 11 && i <= 18) drawGuest(ctx, i - 11);
    else if (i >= 19 && i <= 22) drawStaff(ctx, i - 19);
    else if (i === 23) drawTrain(ctx);
    else if (i === 24 || i === 25) drawLitter(ctx, i === 25);
    else if (i === 26) drawRide(ctx);
    else if (i === 27) drawTrack(ctx);
    else if (i === 28) drawPathAddition(ctx, 'bin');
    else if (i === 29) drawPathAddition(ctx, 'bench');
    else if (i === 30) drawPathAddition(ctx, 'lamp');
    else if (i === 31) drawMarker(ctx, 'in');
    else if (i === 32) drawMarker(ctx, 'out');
    else if (i >= 33 && i <= 36) drawRamp(ctx, i - 33);
    else if (i === 37) drawPathAddition(ctx, 'shelter');
    ctx.restore();
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D, sprite: number): void {
  const colors = [
    '#56a84f',
    '#62ad55',
    '#d5c184',
    '#c7ad6a',
    '#987044',
    '#a0784b',
    '#8b8c91',
    '#777980',
    '#4388bb',
  ];
  ctx.fillStyle = colors[sprite];
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(60, 32);
  ctx.lineTo(32, 56);
  ctx.lineTo(4, 32);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = sprite === 8 ? '#75b8da' : '#3c7139';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (sprite % 2 === 1 && sprite < 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(60, 32);
    ctx.lineTo(32, 32);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPath(ctx: CanvasRenderingContext2D, queue: boolean): void {
  ctx.fillStyle = queue ? '#b77d9d' : '#b59a70';
  ctx.fillRect(24, 14, 16, 36);
  ctx.fillRect(14, 24, 36, 16);
  ctx.strokeStyle = '#715b3f';
  ctx.strokeRect(24, 14, 16, 36);
}

function drawGuest(ctx: CanvasRenderingContext2D, variant: number): void {
  const colors = [
    '#e7474d',
    '#edc53b',
    '#3cb66d',
    '#4194d0',
    '#a46bc6',
    '#eee9db',
    '#e58c43',
    '#34b9a3',
  ];
  ctx.fillStyle = '#252a31';
  ctx.beginPath();
  ctx.arc(32, 27, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors[variant];
  ctx.fillRect(23, 35, 18, 15);
  ctx.fillStyle = '#f3d7ad';
  ctx.beginPath();
  ctx.arc(32, 25, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStaff(ctx: CanvasRenderingContext2D, kind: number): void {
  const coats = ['#4ca95b', '#397cb3', '#855ea8', '#de8840'];
  ctx.fillStyle = coats[kind] ?? coats[0];
  ctx.fillRect(22, 18, 20, 33);
  if (kind === 0) {
    ctx.fillStyle = '#dfd6ad';
    ctx.fillRect(18, 21, 28, 4);
  } else if (kind === 1) {
    ctx.fillStyle = '#d0d8e2';
    ctx.fillRect(28, 29, 10, 7);
  } else if (kind === 2) {
    ctx.fillStyle = '#e7d45d';
    ctx.fillRect(27, 29, 10, 7);
  } else {
    ctx.fillStyle = '#f0d5a5';
    ctx.fillRect(25, 10, 14, 4);
  }
  ctx.fillStyle = '#f6d6ac';
  ctx.beginPath();
  ctx.arc(32, 17, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#d8483d';
  ctx.fillRect(10, 26, 44, 17);
  ctx.fillStyle = '#f2d987';
  ctx.fillRect(16, 20, 10, 8);
  ctx.fillRect(32, 20, 10, 8);
  ctx.fillStyle = '#34383e';
  ctx.beginPath();
  ctx.arc(20, 46, 5, 0, Math.PI * 2);
  ctx.arc(45, 46, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawLitter(ctx: CanvasRenderingContext2D, vomit: boolean): void {
  ctx.fillStyle = vomit ? '#91b84b' : '#6b4f2a';
  ctx.beginPath();
  ctx.ellipse(32, 35, vomit ? 12 : 8, vomit ? 6 : 9, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!vomit) {
    ctx.fillStyle = '#b2a47d';
    ctx.fillRect(26, 21, 12, 5);
  }
}

function drawRide(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#6f75bd';
  ctx.fillRect(13, 19, 38, 28);
  ctx.fillStyle = '#c9d7ec';
  ctx.fillRect(18, 24, 28, 4);
  ctx.fillStyle = '#f2bf42';
  ctx.fillRect(25, 31, 14, 12);
}

function drawTrack(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#cf5650';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(10, 45);
  ctx.lineTo(22, 23);
  ctx.lineTo(40, 37);
  ctx.lineTo(54, 16);
  ctx.stroke();
  ctx.strokeStyle = '#453e3b';
  ctx.lineWidth = 2;
  for (let i = 14; i < 53; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 46);
    ctx.lineTo(i + 4, 50);
    ctx.stroke();
  }
}

function drawPathAddition(
  ctx: CanvasRenderingContext2D,
  kind: 'bin' | 'bench' | 'lamp' | 'shelter',
): void {
  if (kind === 'bin') {
    ctx.fillStyle = '#547d58';
    ctx.fillRect(23, 23, 18, 27);
    ctx.fillStyle = '#bbc3aa';
    ctx.fillRect(21, 22, 22, 5);
    ctx.fillStyle = '#29392d';
    ctx.fillRect(27, 30, 10, 3);
  } else if (kind === 'bench') {
    ctx.fillStyle = '#805535';
    ctx.fillRect(17, 33, 30, 7);
    ctx.fillRect(21, 40, 4, 10);
    ctx.fillRect(39, 40, 4, 10);
    ctx.fillRect(17, 28, 30, 4);
  } else if (kind === 'lamp') {
    ctx.fillStyle = '#424951';
    ctx.fillRect(30, 25, 4, 28);
    ctx.fillStyle = '#e9d784';
    ctx.beginPath();
    ctx.arc(32, 21, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#5c6fa1';
    ctx.beginPath();
    ctx.moveTo(12, 30);
    ctx.quadraticCurveTo(32, 8, 52, 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#554b44';
    ctx.fillRect(29, 29, 6, 24);
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, kind: 'in' | 'out'): void {
  ctx.fillStyle = kind === 'in' ? '#46ae72' : '#d36355';
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(53, 20);
  ctx.lineTo(32, 32);
  ctx.lineTo(11, 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff4cf';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(kind === 'in' ? 'IN' : 'OUT', 32, 26);
}

function drawRamp(ctx: CanvasRenderingContext2D, direction: number): void {
  ctx.fillStyle = '#b59a70';
  ctx.beginPath();
  const offsets = [
    [-14, 9],
    [14, 9],
    [14, -9],
    [-14, -9],
  ][direction & 3];
  ctx.moveTo(32 - offsets[0], 32 - offsets[1]);
  ctx.lineTo(32 + offsets[0], 32 + offsets[1]);
  ctx.lineTo(48, 32);
  ctx.lineTo(32, 48);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#715b3f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32 - offsets[0], 32 - offsets[1]);
  ctx.lineTo(32 + offsets[0], 32 + offsets[1]);
  ctx.stroke();
}

function unrotateForDraw(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Rotation,
  out: Int32Array,
): void {
  switch (rotation) {
    case 0:
      out[0] = x;
      out[1] = y;
      break;
    case 1:
      out[0] = y;
      out[1] = height - 1 - x;
      break;
    case 2:
      out[0] = width - 1 - x;
      out[1] = height - 1 - y;
      break;
    case 3:
      out[0] = width - 1 - y;
      out[1] = x;
      break;
  }
}

function rotatedPositionSum(x: number, y: number, map: MapData, rotation: Rotation): number {
  const tx = x / TILE_UNITS;
  const ty = y / TILE_UNITS;
  switch (rotation) {
    case 0:
      return tx + ty;
    case 1:
      return map.height - ty + tx;
    case 2:
      return map.width - tx + map.height - ty;
    case 3:
      return ty + map.width - tx;
  }
}

function project(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  rotation: Rotation,
  out: Float64Array,
): void {
  const tx = x / TILE_UNITS;
  const ty = y / TILE_UNITS;
  let rx: number;
  let ry: number;
  switch (rotation) {
    case 0:
      rx = tx;
      ry = ty;
      break;
    case 1:
      rx = height - ty;
      ry = tx;
      break;
    case 2:
      rx = width - tx;
      ry = height - ty;
      break;
    case 3:
      rx = ty;
      ry = width - tx;
      break;
  }
  out[0] = (rx - ry) * (TILE_W / 2);
  out[1] = (rx + ry) * (TILE_H / 2) - (z / 64) * Z_PIXELS;
}

function inViewport(
  x: number,
  y: number,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): boolean {
  const halfWidth = viewportWidth / camera.zoom / 2 + width;
  const halfHeight = viewportHeight / camera.zoom / 2 + height;
  return Math.abs(x - camera.x) <= halfWidth && Math.abs(y - camera.y) <= halfHeight;
}
