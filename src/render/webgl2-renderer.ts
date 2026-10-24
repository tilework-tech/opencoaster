import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import type { Camera, MapData, Renderer } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS } from './projection';
import type { Rotation } from './projection';

const CELL = 64;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 3;
const INSTANCE_FLOATS = 7;
const INITIAL_INSTANCE_CAPACITY = 16_384;

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

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aWorld;
layout(location=2) in vec2 aSize;
layout(location=3) in float aSprite;
layout(location=4) in float aSlopeMask;
uniform vec2 uViewport;
uniform vec2 uMapSize;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uRotation;
out vec2 vUv;
void main() {
  bool terrain = aSprite < 9.0;
  vec2 worldPosition = terrain ? aWorld.xy + aCorner * ${TILE_UNITS.toFixed(1)} : aWorld.xy;
  float raisedCorner = 0.0;
  if (terrain) {
    float cornerBit = aCorner.x < 0.5
      ? (aCorner.y < 0.5 ? 1.0 : 8.0)
      : (aCorner.y < 0.5 ? 2.0 : 4.0);
    raisedCorner = mod(floor(aSlopeMask / cornerBit), 2.0);
  }
  float z = aWorld.z + raisedCorner * ${Z_STEP.toFixed(1)};
  float rx = worldPosition.x / ${TILE_UNITS.toFixed(1)};
  float ry = worldPosition.y / ${TILE_UNITS.toFixed(1)};
  if (uRotation > 0.5 && uRotation < 1.5) {
    float next = uMapSize.y - ry;
    ry = rx;
    rx = next;
  } else if (uRotation > 1.5 && uRotation < 2.5) {
    rx = uMapSize.x - rx;
    ry = uMapSize.y - ry;
  } else if (uRotation > 2.5) {
    float next = ry;
    ry = uMapSize.x - rx;
    rx = next;
  }
  vec2 screen = vec2((rx - ry) * ${TILE_W / 2}.0,
                     (rx + ry) * ${TILE_H / 2}.0 - z * ${Z_PIXELS / Z_STEP}.0);
  screen = (screen - uCamera) * uZoom + uViewport * 0.5;
  if (!terrain) screen += (aCorner - 0.5) * aSize * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  float cell = floor(aSprite + 0.5);
  float col = mod(cell, ${ATLAS_COLUMNS}.0);
  float row = floor(cell / ${ATLAS_COLUMNS}.0);
  vec2 spriteUv = terrain
    ? vec2(0.5 + (aCorner.x - aCorner.y) * 0.4375,
           0.5 + (aCorner.x + aCorner.y - 1.0) * 0.375)
    : vec2(aCorner.x, 1.0 - aCorner.y);
  float textureRow = ${ATLAS_ROWS - 1}.0 - row;
  float textureY = terrain ? 1.0 - spriteUv.y : spriteUv.y;
  vUv = (vec2(col, textureRow) + vec2(spriteUv.x, textureY)) / vec2(${ATLAS_COLUMNS}.0, ${ATLAS_ROWS}.0);
}`;

const fragmentSource = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uAtlas;
out vec4 outColor;
void main() {
  outColor = texture(uAtlas, vUv);
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
  private readonly order: number[] = [];
  private count = 0;
  private visibleCount = 0;
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
    this.appendTiles(map, camera, viewportWidth, viewportHeight);
    if (snapshot) {
      if (snapshot.tracks)
        this.appendLayer(
          snapshot.tracks,
          23,
          map,
          camera,
          viewportWidth,
          viewportHeight,
          40,
          28,
          1,
        );
      this.appendLayer(snapshot.rides, 22, map, camera, viewportWidth, viewportHeight, 12, 14);
      this.appendLayer(snapshot.litter, 21, map, camera, viewportWidth, viewportHeight, 6, 7);
      this.appendLayer(snapshot.vehicles, 20, map, camera, viewportWidth, viewportHeight, 12, 12);
      this.appendLayer(snapshot.staff, 19, map, camera, viewportWidth, viewportHeight, 11, 13);
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
    this.setInstanceAttribute(3, 1, 5 * Float32Array.BYTES_PER_ELEMENT);
    this.setInstanceAttribute(4, 1, 6 * Float32Array.BYTES_PER_ELEMENT);
    this.texture = this.createAtlasTexture();
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

  private createAtlasTexture(): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const atlas = document.createElement('canvas');
    atlas.width = CELL * ATLAS_COLUMNS;
    atlas.height = CELL * ATLAS_ROWS;
    if (atlas.width > maxSize || atlas.height > maxSize)
      throw new Error('Sprite atlas exceeds GPU limit');
    const ctx = atlas.getContext('2d');
    if (!ctx) throw new Error('Could not generate sprite atlas');
    drawAtlas(ctx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate sprite atlas texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, atlas.width, atlas.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private appendTiles(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
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
        this.append(
          x * TILE_UNITS,
          y * TILE_UNITS,
          height * 64,
          TILE_W,
          48,
          terrainSpriteIndex(surface, map.slope[index]),
          2 * (rx + ry) - height,
          map.slope[index],
        );
        if (surface === 3 || surface === 6)
          this.append(
            (x + 0.5) * TILE_UNITS,
            (y + 0.5) * TILE_UNITS,
            height * 64 + 1,
            44,
            24,
            surface === 6 ? 10 : 9,
            2 * (rx + ry) - height + 1,
          );
      }
    }
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
    sprite: number,
    depth: number,
    slopeMask = 0,
  ): void {
    if (this.count === this.depths.length) this.grow();
    const offset = this.count * INSTANCE_FLOATS;
    this.instanceData[offset] = x;
    this.instanceData[offset + 1] = y;
    this.instanceData[offset + 2] = z;
    this.instanceData[offset + 3] = width;
    this.instanceData[offset + 4] = height;
    this.instanceData[offset + 5] = sprite;
    this.instanceData[offset + 6] = slopeMask;
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
    else if (i === 19) drawStaff(ctx);
    else if (i === 20) drawTrain(ctx);
    else if (i === 21) drawLitter(ctx);
    else if (i === 22) drawRide(ctx);
    else drawTrack(ctx);
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

function drawStaff(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f0a92f';
  ctx.fillRect(22, 18, 20, 33);
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

function drawLitter(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#6b4f2a';
  ctx.fillRect(23, 25, 18, 16);
  ctx.fillStyle = '#b2a47d';
  ctx.fillRect(26, 21, 12, 5);
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
