import {
  LAMP_HEAD_COLOUR,
  LAMP_HEAD_CORE,
  LAMP_HEAD_HALO,
  LAMP_HEAD_HEIGHT,
  LAMP_LIGHT_COLOUR,
  POOL_BANDS,
  POOL_RADIUS_X,
  POOL_RADIUS_Y,
  ambientTint,
} from './night-lighting';
import type { LampLightBuffer } from './night-lighting';

const MODE_TINT = 0;
const MODE_POOL = 1;
const MODE_HEAD = 2;

const glslVec3 = (c: readonly [number, number, number]): string =>
  `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;

const vertexSource = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aLamp;
uniform vec2 uViewport;
uniform float uScale;
uniform float uDpr;
uniform int uMode;
out vec2 vCorner;
void main() {
  if (uMode == ${MODE_TINT}) {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vCorner = vec2(0.0);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    return;
  }
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 centre = aLamp * uDpr;
  vec2 half_;
  if (uMode == ${MODE_POOL}) {
    half_ = vec2(${POOL_RADIUS_X.toFixed(1)}, ${POOL_RADIUS_Y.toFixed(1)}) * uScale;
  } else {
    centre.y -= ${LAMP_HEAD_HEIGHT.toFixed(1)} * uScale;
    half_ = vec2(${(LAMP_HEAD_HALO / 2).toFixed(2)}) * uScale;
  }
  vec2 pos = floor(centre + corner * half_ + 0.5);
  vCorner = corner;
  gl_Position = vec4(pos.x / uViewport.x * 2.0 - 1.0, 1.0 - pos.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const poolStrength = POOL_BANDS.map(
  ([edge, strength]) => `if (r <= ${edge.toFixed(3)}) return ${strength.toFixed(3)};`,
).join('\n  ');

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
uniform int uMode;
uniform vec3 uTint;
in vec2 vCorner;
out vec4 outColor;
float poolStrength(float r) {
  ${poolStrength}
  return -1.0;
}
void main() {
  if (uMode == ${MODE_TINT}) {
    outColor = vec4(uTint, 1.0);
  } else if (uMode == ${MODE_POOL}) {
    float strength = poolStrength(length(vCorner));
    if (strength < 0.0) discard;
    outColor = vec4(${glslVec3(LAMP_LIGHT_COLOUR)} * strength, 1.0);
  } else {
    float core = ${(LAMP_HEAD_CORE / LAMP_HEAD_HALO).toFixed(3)};
    float edge = max(abs(vCorner.x), abs(vCorner.y));
    outColor = edge <= core
      ? vec4(${glslVec3(LAMP_HEAD_COLOUR)}, 1.0)
      : vec4(${glslVec3(LAMP_LIGHT_COLOUR)} * 0.35, 1.0);
  }
}`;

/** WebGL2 night pass: multiplies the finished frame by the ambient tint, then adds lamp lights. */
export class WebGLNightPass {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffer: WebGLBuffer | null = null;
  private uniforms: {
    viewport: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
    dpr: WebGLUniformLocation | null;
    mode: WebGLUniformLocation | null;
    tint: WebGLUniformLocation | null;
  } | null = null;
  private capacity = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Drops GL objects; the next draw recreates them (after a context restore). */
  reset(): void {
    this.program = null;
    this.vao = null;
    this.buffer = null;
    this.uniforms = null;
    this.capacity = 0;
  }

  private compile(kind: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Could not create night-pass shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(`Night-pass shader failed: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  private ensureProgram(): void {
    if (this.program) return;
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create night-pass program');
    gl.attachShader(program, this.compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Night-pass program failed: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.uniforms = {
      viewport: gl.getUniformLocation(program, 'uViewport'),
      scale: gl.getUniformLocation(program, 'uScale'),
      dpr: gl.getUniformLocation(program, 'uDpr'),
      mode: gl.getUniformLocation(program, 'uMode'),
      tint: gl.getUniformLocation(program, 'uTint'),
    };
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 1);
  }

  /**
   * Draws into the currently bound framebuffer. `lights` hold viewport positions in CSS pixels;
   * `viewportWidth` and `viewportHeight` are the framebuffer size in device pixels and `zoom`
   * scales every light.
   */
  draw(
    darkness: number,
    lights: LampLightBuffer,
    lampCount: number,
    zoom: number,
    dpr: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (darkness <= 0 && lampCount === 0) return;
    const gl = this.gl;
    this.ensureProgram();
    const uniforms = this.uniforms!;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform1f(uniforms.scale, zoom * dpr);
    gl.uniform1f(uniforms.dpr, dpr);
    gl.enable(gl.BLEND);
    if (darkness > 0) {
      const [r, g, b] = ambientTint(darkness);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.uniform1i(uniforms.mode, MODE_TINT);
      gl.uniform3f(uniforms.tint, r / 255, g / 255, b / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (lampCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      const needed = lampCount * 2;
      if (needed > this.capacity) {
        this.capacity = Math.max(needed, lights.data.length);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lights.data, 0, needed);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1i(uniforms.mode, MODE_POOL);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lampCount);
      gl.uniform1i(uniforms.mode, MODE_HEAD);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lampCount);
    }
    gl.bindVertexArray(null);
  }
}
