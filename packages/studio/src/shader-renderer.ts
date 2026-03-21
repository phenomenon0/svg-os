/**
 * WebGPU / WebGL2 shader renderer — generates procedural textures as base64 PNG data URIs.
 *
 * Strategy: try WebGPU (WGSL) first, fall back to WebGL2 (GLSL 300 es).
 * Four pattern types: plasma, noise, voronoi, gradient — each parameterized by
 * two colors, a seed, and output dimensions.
 *
 * The rendered texture can be injected into an SVG `<image>` element's href,
 * enabling GPU-accelerated generative backgrounds in SVG templates.
 */

export interface ShaderParams {
  color1: string;    // hex color → vec3 uniform
  color2: string;    // hex color → vec3 uniform
  seed: number;      // float uniform for variation
  pattern: string;   // "plasma" | "noise" | "voronoi" | "gradient"
  width: number;
  height: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, string>();

function paramKey(p: ShaderParams): string {
  return `${p.pattern}:${p.color1}:${p.color2}:${p.seed}:${p.width}x${p.height}`;
}

// ── Hex → RGB ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ── Pattern index ────────────────────────────────────────────────────────────

function patternIndex(name: string): number {
  switch (name) {
    case "plasma":   return 0;
    case "noise":    return 1;
    case "voronoi":  return 2;
    case "gradient": return 3;
    case "smoke":    return 4;
    case "fire":     return 5;
    case "sphere":   return 6;
    case "clouds":   return 7;
    case "godrays":  return 8;
    default:         return 0;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Which GPU backend was used (set after first render). */
export let gpuBackend: "webgpu" | "webgl2" | "none" = "none";

/**
 * Render a procedural shader to a base64 PNG data URI.
 * Tries WebGPU first, falls back to WebGL2.
 */
export async function renderShader(params: ShaderParams): Promise<string> {
  const key = paramKey(params);
  const cached = cache.get(key);
  if (cached) return cached;

  let dataUri: string;

  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      dataUri = await renderWebGPU(params);
      gpuBackend = "webgpu";
    } catch (e) {
      console.warn("WebGPU render failed, falling back to WebGL2:", e);
      dataUri = renderWebGL2(params);
      gpuBackend = "webgl2";
    }
  } else {
    dataUri = renderWebGL2(params);
    gpuBackend = "webgl2";
  }

  cache.set(key, dataUri);
  return dataUri;
}

// ── WebGPU Implementation ────────────────────────────────────────────────────

async function renderWebGPU(params: ShaderParams): Promise<string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");
  const device = await adapter.requestDevice();

  const { width, height } = params;
  const [r1, g1, b1] = hexToRgb(params.color1);
  const [r2, g2, b2] = hexToRgb(params.color2);

  // Create output texture
  const texture = device.createTexture({
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  // Uniform buffer: color1(3f) + pad, color2(3f) + pad, seed, pattern, resolution(2f)
  const uniformData = new Float32Array([
    r1, g1, b1, 0,
    r2, g2, b2, 0,
    params.seed, patternIndex(params.pattern), width, height,
  ]);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const shaderModule = device.createShaderModule({ code: WGSL_SHADER });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-strip" },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: texture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(4);
  pass.end();

  // Copy texture → buffer for readback
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const readBuffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const rawData = new Uint8Array(readBuffer.getMappedRange());

  // Copy to canvas (handles bytesPerRow padding)
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcOffset = y * bytesPerRow;
    const dstOffset = y * width * 4;
    imageData.data.set(rawData.subarray(srcOffset, srcOffset + width * 4), dstOffset);
  }
  ctx.putImageData(imageData, 0, 0);

  readBuffer.unmap();
  device.destroy();

  return canvas.toDataURL("image/png");
}

// ── WGSL Shader ──────────────────────────────────────────────────────────────

const WGSL_SHADER = /* wgsl */ `
struct Uniforms {
  color1: vec4f,
  color2: vec4f,
  seed: f32,
  pattern: f32,
  resolution: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

// Simplex-style noise (2D)
fn hash2(p: vec2f) -> vec2f {
  let k = vec2f(0.3183099, 0.3678794);
  var q = p * k + k.yx;
  q = fract(sin(vec2f(dot(q, vec2f(127.1, 311.7)), dot(q, vec2f(269.5, 183.3)))) * 43758.5453);
  return q;
}

fn noise2d(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u_curve = f * f * (3.0 - 2.0 * f);
  let a = dot(hash2(i + vec2f(0.0, 0.0)) - 0.5, f - vec2f(0.0, 0.0));
  let b = dot(hash2(i + vec2f(1.0, 0.0)) - 0.5, f - vec2f(1.0, 0.0));
  let c = dot(hash2(i + vec2f(0.0, 1.0)) - 0.5, f - vec2f(0.0, 1.0));
  let d = dot(hash2(i + vec2f(1.0, 1.0)) - 0.5, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u_curve.x), mix(c, d, u_curve.x), u_curve.y) + 0.5;
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pos = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise2d(pos);
    pos = pos * 2.0 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

fn voronoi(p: vec2f) -> f32 {
  let n = floor(p);
  let f = fract(p);
  var md = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = hash2(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      md = min(md, d);
    }
  }
  return sqrt(md);
}

fn plasma(uv: vec2f, seed: f32) -> f32 {
  return 0.5 + 0.5 * sin(uv.x * 3.0 + seed * 0.5)
       + 0.5 + 0.5 * sin(uv.y * 4.0 + seed * 0.3)
       + 0.5 + 0.5 * sin((uv.x + uv.y) * 5.0 + seed * 0.7)
       + 0.5 + 0.5 * sin(length(uv - 0.5) * 8.0 - seed * 0.4);
}

// ── 3D noise helpers for volumetric patterns ──

fn hash3(p: vec3f) -> vec3f {
  var q = vec3f(
    dot(p, vec3f(127.1, 311.7, 74.7)),
    dot(p, vec3f(269.5, 183.3, 246.1)),
    dot(p, vec3f(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453);
}

fn noise3d(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let n000 = dot(hash3(i + vec3f(0.0, 0.0, 0.0)) - 0.5, f - vec3f(0.0, 0.0, 0.0));
  let n100 = dot(hash3(i + vec3f(1.0, 0.0, 0.0)) - 0.5, f - vec3f(1.0, 0.0, 0.0));
  let n010 = dot(hash3(i + vec3f(0.0, 1.0, 0.0)) - 0.5, f - vec3f(0.0, 1.0, 0.0));
  let n110 = dot(hash3(i + vec3f(1.0, 1.0, 0.0)) - 0.5, f - vec3f(1.0, 1.0, 0.0));
  let n001 = dot(hash3(i + vec3f(0.0, 0.0, 1.0)) - 0.5, f - vec3f(0.0, 0.0, 1.0));
  let n101 = dot(hash3(i + vec3f(1.0, 0.0, 1.0)) - 0.5, f - vec3f(1.0, 0.0, 1.0));
  let n011 = dot(hash3(i + vec3f(0.0, 1.0, 1.0)) - 0.5, f - vec3f(0.0, 1.0, 1.0));
  let n111 = dot(hash3(i + vec3f(1.0, 1.0, 1.0)) - 0.5, f - vec3f(1.0, 1.0, 1.0));

  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) + 0.5;
}

fn fbm3d(p: vec3f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pos = p;
  for (var i = 0; i < 4; i++) {
    v += a * noise3d(pos);
    pos = pos * 2.0 + vec3f(1.7, 9.2, 5.3);
    a *= 0.5;
  }
  return v;
}

// SDF sphere for raymarching
fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // Full-screen quad via triangle strip
  let x = f32((vi & 1u) << 1u) - 1.0;
  let y = f32((vi & 2u)) - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.resolution;
  let c1 = u.color1.rgb;
  let c2 = u.color2.rgb;
  let seed = u.seed;
  let pat = i32(u.pattern);

  var t = 0.0;

  if (pat == 0) {
    // Plasma
    t = plasma(uv, seed) / 4.0;
  } else if (pat == 1) {
    // Noise (FBM)
    t = fbm(uv * 4.0 + seed * 0.1);
  } else if (pat == 2) {
    // Voronoi
    t = voronoi(uv * 6.0 + seed * 0.05);
  } else if (pat == 3) {
    // Gradient with noise displacement
    let disp = fbm(uv * 3.0 + seed * 0.1) * 0.3;
    t = uv.y + disp;
  } else if (pat == 4) {
    // Smoke — domain-warped FBM: fbm(uv + fbm(uv))
    let warp = fbm(uv * 3.0 + seed * 0.1);
    t = fbm(uv * 3.0 + vec2f(warp * 1.5, warp * 1.2) + seed * 0.05);
  } else if (pat == 6) {
    // Sphere — raymarched glossy sphere with Phong lighting
    let ro = vec3f(0.0, 0.0, -2.5);
    let rd = normalize(vec3f(uv * 2.0 - 1.0, 1.5));
    var depth = 0.0;
    var hit = false;
    var hitPos = vec3f(0.0);
    for (var step = 0; step < 48; step++) {
      let p = ro + rd * depth;
      let d = sdSphere(p, 0.8);
      if (d < 0.001) { hit = true; hitPos = p; break; }
      if (depth > 5.0) { break; }
      depth += d;
    }
    if (hit) {
      let n = normalize(hitPos);
      let lightDir = normalize(vec3f(0.8, 1.0, -0.5));
      let diff = max(dot(n, lightDir), 0.0);
      let viewDir = normalize(-rd);
      let halfDir = normalize(lightDir + viewDir);
      let spec = pow(max(dot(n, halfDir), 0.0), 32.0);
      let fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
      t = diff * 0.7 + spec * 0.3 + fresnel * 0.2;
    } else {
      t = 0.0;
    }
  } else if (pat == 7) {
    // Clouds — volumetric cloud raymarching through 3D FBM slab
    let ro = vec3f(uv * 4.0 - 2.0, -1.0);
    let rd = vec3f(0.0, 0.0, 1.0);
    var alpha = 0.0;
    var accum = 0.0;
    for (var step = 0; step < 32; step++) {
      let zPos = f32(step) / 32.0 * 2.0;
      let samplePos = ro + rd * zPos;
      let density = fbm3d(samplePos * 2.0 + seed * 0.05);
      let d = max(density - 0.35, 0.0) * 0.15;
      accum += d * (1.0 - alpha);
      alpha += d;
      if (alpha > 0.95) { break; }
    }
    t = clamp(accum, 0.0, 1.0);
  } else {
    // Fire (pat == 5) or Godrays (pat == 8)
    if (pat == 8) {
      // Godrays — radial light shafts (2D approximation)
      let lightPos = vec2f(0.5 + sin(seed * 0.1) * 0.2, 0.3);
      let ray = uv - lightPos;
      var light = 0.0;
      for (var s = 0; s < 16; s++) {
        let sampleUv = uv - ray * f32(s) / 16.0 * 0.5;
        let n = fbm(sampleUv * 5.0 + seed * 0.05);
        let falloff = 1.0 - f32(s) / 16.0;
        light += n * falloff * 0.08;
      }
      t = clamp(light, 0.0, 1.0);
    } else {
      // Fire — vertically-biased FBM with upward flow
      let fire_uv = vec2f(uv.x * 3.0, uv.y * 2.0 - seed * 0.3);
      t = fbm(fire_uv + seed * 0.05);
      t = pow(t, 1.5);
    }
  }

  t = clamp(t, 0.0, 1.0);
  let col = mix(c1, c2, t);
  return vec4f(col, 1.0);
}
`;

// ── WebGL2 Fallback ──────────────────────────────────────────────────────────

function renderWebGL2(params: ShaderParams): string {
  const { width, height } = params;
  const [r1, g1, b1] = hexToRgb(params.color1);
  const [r2, g2, b2] = hexToRgb(params.color2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 not available");

  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, GLSL_VERT);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, GLSL_FRAG);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error("Fragment shader: " + gl.getShaderInfoLog(fs));
  }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Uniforms
  gl.uniform3f(gl.getUniformLocation(prog, "u_color1"), r1, g1, b1);
  gl.uniform3f(gl.getUniformLocation(prog, "u_color2"), r2, g2, b2);
  gl.uniform1f(gl.getUniformLocation(prog, "u_seed"), params.seed);
  gl.uniform1i(gl.getUniformLocation(prog, "u_pattern"), patternIndex(params.pattern));
  gl.uniform2f(gl.getUniformLocation(prog, "u_resolution"), width, height);

  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  return canvas.toDataURL("image/png");
}

const GLSL_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_seed;
uniform int u_pattern;
uniform vec2 u_resolution;
out vec4 fragColor;

vec2 hash2(vec2 p) {
  vec2 k = vec2(0.3183099, 0.3678794);
  vec2 q = p * k + k.yx;
  return fract(sin(vec2(dot(q, vec2(127.1, 311.7)), dot(q, vec2(269.5, 183.3)))) * 43758.5453);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i + vec2(0.0, 0.0)) - 0.5, f - vec2(0.0, 0.0));
  float b = dot(hash2(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
}

float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise2d(p);
    p = p * 2.0 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      md = min(md, dot(r, r));
    }
  }
  return sqrt(md);
}

float plasma(vec2 uv, float seed) {
  return (0.5 + 0.5 * sin(uv.x * 3.0 + seed * 0.5)
        + 0.5 + 0.5 * sin(uv.y * 4.0 + seed * 0.3)
        + 0.5 + 0.5 * sin((uv.x + uv.y) * 5.0 + seed * 0.7)
        + 0.5 + 0.5 * sin(length(uv - 0.5) * 8.0 - seed * 0.4)) / 4.0;
}

// ── 3D noise helpers for volumetric patterns ──

vec3 hash3(vec3 p) {
  vec3 q = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453);
}

float noise3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = dot(hash3(i + vec3(0.0, 0.0, 0.0)) - 0.5, f - vec3(0.0, 0.0, 0.0));
  float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)) - 0.5, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)) - 0.5, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)) - 0.5, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)) - 0.5, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)) - 0.5, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)) - 0.5, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)) - 0.5, f - vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) + 0.5;
}

float fbm3d(vec3 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3d(p);
    p = p * 2.0 + vec3(1.7, 9.2, 5.3);
    a *= 0.5;
  }
  return v;
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Flip Y for WebGL (origin is bottom-left)
  uv.y = 1.0 - uv.y;
  float t = 0.0;

  if (u_pattern == 0) {
    t = plasma(uv, u_seed);
  } else if (u_pattern == 1) {
    t = fbm(uv * 4.0 + u_seed * 0.1);
  } else if (u_pattern == 2) {
    t = voronoi(uv * 6.0 + u_seed * 0.05);
  } else if (u_pattern == 3) {
    float disp = fbm(uv * 3.0 + u_seed * 0.1) * 0.3;
    t = uv.y + disp;
  } else if (u_pattern == 4) {
    // Smoke — domain-warped FBM
    float warp = fbm(uv * 3.0 + u_seed * 0.1);
    t = fbm(uv * 3.0 + vec2(warp * 1.5, warp * 1.2) + u_seed * 0.05);
  } else if (u_pattern == 6) {
    // Sphere — raymarched glossy sphere with Phong lighting
    vec3 ro = vec3(0.0, 0.0, -2.5);
    vec3 rd = normalize(vec3(uv * 2.0 - 1.0, 1.5));
    float depth = 0.0;
    bool hit = false;
    vec3 hitPos = vec3(0.0);
    for (int step = 0; step < 48; step++) {
      vec3 p = ro + rd * depth;
      float d = sdSphere(p, 0.8);
      if (d < 0.001) { hit = true; hitPos = p; break; }
      if (depth > 5.0) { break; }
      depth += d;
    }
    if (hit) {
      vec3 n = normalize(hitPos);
      vec3 lightDir = normalize(vec3(0.8, 1.0, -0.5));
      float diff = max(dot(n, lightDir), 0.0);
      vec3 viewDir = normalize(-rd);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(n, halfDir), 0.0), 32.0);
      float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
      t = diff * 0.7 + spec * 0.3 + fresnel * 0.2;
    } else {
      t = 0.0;
    }
  } else if (u_pattern == 7) {
    // Clouds — volumetric cloud raymarching through 3D FBM slab
    vec3 ro = vec3(uv * 4.0 - 2.0, -1.0);
    vec3 rd = vec3(0.0, 0.0, 1.0);
    float alpha = 0.0;
    float accum = 0.0;
    for (int step = 0; step < 32; step++) {
      float zPos = float(step) / 32.0 * 2.0;
      vec3 samplePos = ro + rd * zPos;
      float density = fbm3d(samplePos * 2.0 + u_seed * 0.05);
      float d = max(density - 0.35, 0.0) * 0.15;
      accum += d * (1.0 - alpha);
      alpha += d;
      if (alpha > 0.95) { break; }
    }
    t = clamp(accum, 0.0, 1.0);
  } else if (u_pattern == 8) {
    // Godrays — radial light shafts (2D approximation)
    vec2 lightPos = vec2(0.5 + sin(u_seed * 0.1) * 0.2, 0.3);
    vec2 ray = uv - lightPos;
    float light = 0.0;
    for (int s = 0; s < 16; s++) {
      vec2 sampleUv = uv - ray * float(s) / 16.0 * 0.5;
      float n = fbm(sampleUv * 5.0 + u_seed * 0.05);
      float falloff = 1.0 - float(s) / 16.0;
      light += n * falloff * 0.08;
    }
    t = clamp(light, 0.0, 1.0);
  } else {
    // Fire — vertically-biased FBM with upward flow
    vec2 fire_uv = vec2(uv.x * 3.0, uv.y * 2.0 - u_seed * 0.3);
    t = fbm(fire_uv + u_seed * 0.05);
    t = pow(t, 1.5);
  }

  t = clamp(t, 0.0, 1.0);
  vec3 col = mix(u_color1, u_color2, t);
  fragColor = vec4(col, 1.0);
}
`;
