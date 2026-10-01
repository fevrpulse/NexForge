const WIDTH = 1280;
const HEIGHT = 720;
const ALU = 64;
const PASSES = 8;

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
  float x = gl_FragCoord.x * 0.001 + uSeed;
  float y = gl_FragCoord.y * 0.001 + 0.25;
  for (int i = 0; i < ${ALU}; i++) {
    x = fract(x * 1.37 + y * 0.91 + float(i) * 0.017);
    y = fract(y * 1.61 + x * 0.73 + 0.013);
  }
  frag = vec4(x, y, fract(x + y), 1.0);
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

function workPerPass() {
  return WIDTH * HEIGHT * ALU;
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

export function runGpuBench({ durationMs = 2600, onProgress, isCancelled } = {}) {
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
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
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
      gl.uniform1f(seed, (i + 1) * 0.017);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    if (!timer) {
      finishFallback();
      return;
    }

    const pending = [];
    let gpuNs = 0;
    let passes = 0;
    let samples = 0;

    function drain() {
      if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        gpuNs = 0;
        passes = 0;
        samples = 0;
        return;
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const query = pending[i];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        gl.deleteQuery(query);
        pending.splice(i, 1);
        if (ns > 0) {
          gpuNs += ns;
          passes += PASSES;
          samples += 1;
        }
      }
    }

    function timedResult(seconds) {
      return {
        method: 'timer',
        gigaSteps: (passes * workPerPass()) / seconds / 1e9 + pixel[0] * 0,
        seconds,
        renderer,
      };
    }

    function frame() {
      if (isCancelled?.()) {
        drain();
        pending.forEach((query) => gl.deleteQuery(query));
        if (samples >= 1 && gpuNs > 0) finish(timedResult(gpuNs / 1e9));
        else finish({ skipped: 'Cancelled.' });
        return;
      }
      drain();
      const elapsed = performance.now() - started;
      onProgress?.(Math.max(0, Math.min(1, elapsed / durationMs)));
      if (elapsed < durationMs) {
        const query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        draw(PASSES);
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        pending.push(query);
        requestAnimationFrame(frame);
        return;
      }
      const waitStarted = performance.now();
      function wait() {
        drain();
        if (pending.length && performance.now() - waitStarted < 2000) {
          requestAnimationFrame(wait);
          return;
        }
        pending.forEach((query) => gl.deleteQuery(query));
        if (samples < 2 || gpuNs <= 0) {
          finishFallback();
          return;
        }
        finish(timedResult(gpuNs / 1e9));
      }
      wait();
    }

    function finishFallback() {
      if (settled) return;
      const t0 = performance.now();
      let frames = 0;
      function loop() {
        if (isCancelled?.()) {
          const seconds = Math.max(0.05, (performance.now() - t0) / 1000);
          if (frames >= 2) {
            finish({
              method: 'frames',
              gigaSteps: (frames * 4 * workPerPass()) / seconds / 1e9,
              seconds,
              renderer,
            });
          } else finish({ skipped: 'Cancelled.' });
          return;
        }
        draw(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        frames += 1;
        const elapsed = performance.now() - t0;
        onProgress?.(Math.max(0, Math.min(1, elapsed / durationMs)));
        if (elapsed < durationMs) {
          requestAnimationFrame(loop);
          return;
        }
        const seconds = elapsed / 1000;
        if (pixel[0] + pixel[1] + pixel[2] < 0) {
          finish({ skipped: 'Graphics test returned nothing.' });
          return;
        }
        finish({
          method: 'frames',
          gigaSteps: (frames * 4 * workPerPass()) / seconds / 1e9,
          seconds,
          renderer,
        });
      }
      requestAnimationFrame(loop);
    }

    requestAnimationFrame(frame);
  });
}
