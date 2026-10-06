const WIDTH = 1280;
const HEIGHT = 720;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 frag;

float hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float best) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return best;
  h = sqrt(h);
  float t = -b - h;
  if (t <= 0.001) t = -b + h;
  if (t > 0.001 && t < best) return t;
  return best;
}

float rnd(inout float s) {
  s = fract(sin(s) * 43758.5453);
  s += 1.0;
  return fract(s * 12.9898);
}

vec3 sky(vec3 rd) {
  float up = rd.y * 0.5 + 0.5;
  return vec3(0.52 + up * 0.28, 0.56 + up * 0.24, 0.64 + up * 0.2);
}

struct Hit {
  vec3 color;
  vec3 pos;
  vec3 n;
  float mirror;
};

Hit trace(vec3 ro, vec3 rd, float seed) {
  Hit hit;
  hit.color = sky(rd);
  hit.pos = ro;
  hit.n = rd;
  hit.mirror = 0.0;
  float best = 1e9;
  int id = 0;
  if (rd.y < -0.0001) {
    float plane = -ro.y / rd.y;
    if (plane > 0.001 && plane < best) { best = plane; id = 1; }
  }
  float t = hitSphere(ro, rd, vec3(-0.15, 0.62, 0.1), 0.62, best);
  if (t < best) { best = t; id = 2; }
  t = hitSphere(ro, rd, vec3(-1.25, 0.38, 0.35), 0.38, best);
  if (t < best) { best = t; id = 3; }
  t = hitSphere(ro, rd, vec3(0.95, 0.3, 0.55), 0.3, best);
  if (t < best) { best = t; id = 4; }
  t = hitSphere(ro, rd, vec3(0.25, 0.26, 1.15), 0.26, best);
  if (t < best) { best = t; id = 5; }
  if (id == 0) return hit;

  vec3 p = ro + rd * best;
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 albedo = vec3(0.7);
  if (id == 1) {
    float fade = 1.0 / (1.0 + dot(p.xz, p.xz) * 0.02);
    albedo = vec3(0.55 + 0.28 * fade, 0.57 + 0.26 * fade, 0.62 + 0.22 * fade);
  } else if (id == 2) {
    n = p - vec3(-0.15, 0.62, 0.1); albedo = vec3(0.95, 0.34, 0.12);
  } else if (id == 3) {
    n = p - vec3(-1.25, 0.38, 0.35); albedo = vec3(0.12, 0.72, 0.78);
  } else if (id == 4) {
    n = p - vec3(0.95, 0.3, 0.55); albedo = vec3(0.9, 0.88, 0.82);
  } else {
    n = p - vec3(0.25, 0.26, 1.15); albedo = vec3(0.95, 0.95, 0.98); hit.mirror = 1.0;
  }
  n = normalize(n);
  float light = 0.0;
  float rng = seed;
  for (int s = 0; s < 36; s++) {
    float ang = rnd(rng) * 6.2831853;
    float rad = sqrt(rnd(rng)) * 0.55;
    vec3 lp = vec3(0.2 + cos(ang) * rad, 2.45, 0.35 + sin(ang) * rad);
    vec3 ld = lp - p;
    float dist = length(ld);
    ld /= dist;
    float ndotl = dot(n, ld);
    if (ndotl <= 0.0) continue;
    vec3 so = p + n * 0.02;
    float block = hitSphere(so, ld, vec3(-0.15, 0.62, 0.1), 0.62, dist);
    if (block < dist - 0.02) continue;
    block = hitSphere(so, ld, vec3(-1.25, 0.38, 0.35), 0.38, dist);
    if (block < dist - 0.02) continue;
    block = hitSphere(so, ld, vec3(0.95, 0.3, 0.55), 0.3, dist);
    if (block < dist - 0.02) continue;
    block = hitSphere(so, ld, vec3(0.25, 0.26, 1.15), 0.26, dist);
    if (block < dist - 0.02) continue;
    light += ndotl;
  }
  light = light / 36.0 * 7.5 + (n.y * 0.5 + 0.5) * 0.22;
  hit.color = albedo * light;
  hit.pos = p;
  hit.n = n;
  return hit;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${WIDTH}.0, ${HEIGHT}.0);
  float aspect = ${WIDTH}.0 / ${HEIGHT}.0;
  float sx = (uv.x * 2.0 - 1.0) * aspect * 0.78;
  float sy = (1.0 - uv.y * 2.0) * 0.78;
  vec3 rd = normalize(vec3(sx, -0.1763 + sy * 0.9844, -0.9844 - sy * 0.1763));
  vec3 color = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float seed = uSeed + uv.x * 13.0 + uv.y * 7.0 + float(i) * 17.0;
    Hit first = trace(vec3(0.0, 1.05, 3.35), rd, seed);
    vec3 sampleColor = first.color;
    if (first.mirror > 0.5) {
      vec3 rr = reflect(rd, first.n);
      Hit bounce = trace(first.pos + first.n * 0.02, rr, seed + 19.0);
      sampleColor = sampleColor * 0.08 + bounce.color * 0.92;
    }
    color += sampleColor;
  }
  color = (color / 24.0) / (1.0 + color / 24.0);
  frag = vec4(pow(max(color, vec3(0.0)), vec3(0.4545)), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'shader';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function gpuLabel(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/GeForce [^,(]+|Radeon [^,(]+|Intel\(R\) Arc [^,(]+|Intel\(R\) UHD [^,(]+|Intel\(R\) Iris[^,(]+|Intel\(R\) Graphics[^,(]*/i);
  return (match ? match[0] : text).trim();
}

export function runGpuBench({ canvas, durationMs = 60000, onSample, onTick, isCancelled } = {}) {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = WIDTH;
  glCanvas.height = HEIGHT;
  const gl = glCanvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return Promise.resolve({ skipped: 'This PC did not start a graphics test.' });

  let program = null;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'link');
    }
  } catch (err) {
    return Promise.resolve({
      skipped: 'This PC could not compile the graphics test.',
      detail: String(err?.message || err).slice(0, 400),
    });
  }

  const seed = gl.getUniformLocation(program, 'uSeed');
  const renderer = gpuLabel(gl);
  const pixel = new Uint8Array(4);
  const view = canvas?.getContext?.('2d') || null;
  gl.bindVertexArray(gl.createVertexArray());
  gl.viewport(0, 0, WIDTH, HEIGHT);
  gl.useProgram(program);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    let frames = 0;
    let busyMs = 0;
    let ticking = false;
    let lastTick = 0;
    let lastSampleAt = 0;

    function result() {
      const seconds = busyMs / 1000;
      const samples = frames * WIDTH * HEIGHT;
      return {
        samples,
        seconds,
        frames,
        renderer,
        rate: seconds > 0 ? samples / seconds : 0,
      };
    }

    function finish(payload) {
      if (settled) return;
      settled = true;
      const lose = gl.getExtension('WEBGL_lose_context');
      try { lose?.loseContext(); } catch { /* already lost */ }
      resolve(payload);
    }

    let hold = false;

    function burst() {
      if (settled) return;
      if (isCancelled?.() || performance.now() - started >= durationMs) {
        const sample = result();
        onSample?.(sample);
        if (sample.seconds > 0 && sample.samples > 0) finish(sample);
        else finish({ skipped: 'Cancelled.' });
        return;
      }

      const now = performance.now();
      if (!ticking && (hold || now - lastTick > 800)) {
        ticking = true;
        lastTick = now;
        Promise.resolve()
          .then(() => onTick?.() ?? 'run')
          .then((pace) => {
            if (settled) return;
            ticking = false;
            hold = pace === 'pause';
            setTimeout(burst, hold ? 250 : 0);
          })
          .catch(() => {
            if (settled) return;
            ticking = false;
            hold = false;
            setTimeout(burst, 250);
          });
        return;
      }
      if (hold) {
        setTimeout(burst, 250);
        return;
      }

      const budgetStart = performance.now();
      gl.uniform1f(seed, frames + 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames += 1;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (view && canvas) view.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
      busyMs += performance.now() - budgetStart;

      if (performance.now() - lastSampleAt > 250) {
        lastSampleAt = performance.now();
        onSample?.(result());
      }
      setTimeout(burst, 0);
    }

    setTimeout(burst, 0);
  });
}
