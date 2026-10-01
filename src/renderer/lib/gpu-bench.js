const WIDTH = 1920;
const HEIGHT = 1080;
const ALU = 160;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy;
  float x = uv.x * 0.001 + uSeed;
  float y = uv.y * 0.001 + 0.37;
  float v = 0.15 + uSeed;
  for (int i = 0; i < ${ALU}; i++) {
    v = sin(v * 1.17 + x * 0.73) * cos(y * 0.91 + v);
    x = fract(x * 1.31 + v + float(i) * 0.017);
    y = fract(y * 1.27 + v * 1.13);
  }
  frag = vec4(v, x, y, 1.0);
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

export function runGpuBench({ durationMs = 2600, onProgress, onSample, onTick, isCancelled } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-4000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(canvas);

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });

  function cleanup() {
    const lose = gl?.getExtension?.('WEBGL_lose_context');
    try { lose?.loseContext(); } catch { /* already lost */ }
    canvas.remove();
  }

  if (!gl) {
    canvas.remove();
    return Promise.resolve({ skipped: 'This PC did not start a graphics test.' });
  }

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
  } catch {
    cleanup();
    return Promise.resolve({ skipped: 'This PC could not compile the graphics test.' });
  }

  const seed = gl.getUniformLocation(program, 'uSeed');
  const renderer = gpuLabel(gl);
  const pixel = new Uint8Array(4);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.viewport(0, 0, WIDTH, HEIGHT);
  gl.useProgram(program);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  function draw(n) {
    for (let i = 0; i < n; i++) {
      gl.uniform1f(seed, (i + 1) * 0.013);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    let passes = 4;
    let passTotal = 0;
    let busyMs = 0;
    let ticking = false;
    let lastTick = 0;
    let pauseUntil = 0;

    function result() {
      const seconds = busyMs / 1000;
      const gigaSteps = seconds > 0
        ? (passTotal * WIDTH * HEIGHT * ALU) / seconds / 1e9
        : 0;
      return { method: 'load', gigaSteps, seconds, renderer };
    }

    function finish(payload) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    }

    function burst() {
      if (settled) return;
      if (performance.now() < pauseUntil) {
        setTimeout(burst, 200);
        return;
      }
      if (isCancelled?.() || performance.now() - started >= durationMs) {
        const sample = result();
        onSample?.(sample);
        if (sample.seconds > 0 && sample.gigaSteps > 0) finish(sample);
        else finish({ skipped: 'Cancelled.' });
        return;
      }

      const budgetStart = performance.now();
      while (performance.now() - budgetStart < 45) {
        if (isCancelled?.()) break;
        const one = performance.now();
        draw(passes);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const dt = performance.now() - one;
        passTotal += passes;
        busyMs += dt;
        if (dt > 70) passes = Math.max(1, passes - 2);
        else if (dt < 18) passes = Math.min(48, passes + 2);
      }

      const sample = result();
      onSample?.(sample);
      onProgress?.(Math.max(0, Math.min(1, (performance.now() - started) / durationMs)));
      const now = performance.now();
      if (!ticking && now - lastTick > 2000) {
        ticking = true;
        lastTick = now;
        Promise.resolve(onTick?.()).then((pace) => {
          ticking = false;
          if (pace === 'pause') pauseUntil = performance.now() + 1500;
        });
      }
      const wait = performance.now() < pauseUntil ? 200 : 0;
      setTimeout(burst, wait);
    }

    setTimeout(burst, 0);
  });
}
