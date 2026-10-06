const { Worker } = require('worker_threads');
const os = require('os');

const VIEW_W = 640;
const VIEW_H = 360;
const TILE = 32;
const SPP = 16;

function sphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius, best) {
  const ocx = ox - cx;
  const ocy = oy - cy;
  const ocz = oz - cz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  let h = b * b - c;
  if (h < 0) return best;
  h = Math.sqrt(h);
  let t = -b - h;
  if (t <= 0.001) t = -b + h;
  if (t > 0.001 && t < best) return t;
  return best;
}

function shadeRay(ox, oy, oz, dx, dy, dz, depth, seed, scratch, slot) {
  const out = slot * 3;
  let best = 1e9;
  let id = 0;
  if (dy < -1e-4) {
    const plane = -oy / dy;
    if (plane > 0.001 && plane < best) {
      best = plane;
      id = 1;
    }
  }
  let t = sphereT(ox, oy, oz, dx, dy, dz, -0.15, 0.62, 0.1, 0.62, best);
  if (t < best) { best = t; id = 2; }
  t = sphereT(ox, oy, oz, dx, dy, dz, -1.25, 0.38, 0.35, 0.38, best);
  if (t < best) { best = t; id = 3; }
  t = sphereT(ox, oy, oz, dx, dy, dz, 0.95, 0.3, 0.55, 0.3, best);
  if (t < best) { best = t; id = 4; }
  t = sphereT(ox, oy, oz, dx, dy, dz, 0.25, 0.26, 1.15, 0.26, best);
  if (t < best) { best = t; id = 5; }

  if (!id || best > 1e8) {
    const up = dy * 0.5 + 0.5;
    scratch[out] = 0.52 + up * 0.28;
    scratch[out + 1] = 0.56 + up * 0.24;
    scratch[out + 2] = 0.64 + up * 0.2;
    return seed;
  }

  const hx = ox + dx * best;
  const hy = oy + dy * best;
  const hz = oz + dz * best;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  let ar = 0.45;
  let ag = 0.45;
  let ab = 0.45;
  let mirror = 0;
  if (id === 1) {
    const fade = 1 / (1 + (hx * hx + hz * hz) * 0.02);
    ar = 0.55 + 0.28 * fade;
    ag = 0.57 + 0.26 * fade;
    ab = 0.62 + 0.22 * fade;
  } else if (id === 2) {
    nx = hx + 0.15; ny = hy - 0.62; nz = hz - 0.1;
    ar = 0.95; ag = 0.34; ab = 0.12;
  } else if (id === 3) {
    nx = hx + 1.25; ny = hy - 0.38; nz = hz - 0.35;
    ar = 0.12; ag = 0.72; ab = 0.78;
  } else if (id === 4) {
    nx = hx - 0.95; ny = hy - 0.3; nz = hz - 0.55;
    ar = 0.9; ag = 0.88; ab = 0.82;
  } else {
    nx = hx - 0.25; ny = hy - 0.26; nz = hz - 1.15;
    ar = 0.95; ag = 0.95; ab = 0.98;
    mirror = 1;
  }
  if (id !== 1) {
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
  }

  const SHADOW = 28;
  let light = 0;
  for (let s = 0; s < SHADOW; s++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const ang = (seed / 4294967296) * 6.28318530718;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const rad = Math.sqrt(seed / 4294967296) * 0.55;
    const lx = 0.2 + Math.cos(ang) * rad;
    const ly = 2.45;
    const lz = 0.35 + Math.sin(ang) * rad;
    let ldx = lx - hx;
    let ldy = ly - hy;
    let ldz = lz - hz;
    const dist = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz) || 1;
    ldx /= dist; ldy /= dist; ldz /= dist;
    const ndotl = nx * ldx + ny * ldy + nz * ldz;
    if (ndotl <= 0) continue;
    const sox = hx + nx * 0.02;
    const soy = hy + ny * 0.02;
    const soz = hz + nz * 0.02;
    let blocked = sphereT(sox, soy, soz, ldx, ldy, ldz, -0.15, 0.62, 0.1, 0.62, dist);
    if (blocked < dist - 0.02) continue;
    blocked = sphereT(sox, soy, soz, ldx, ldy, ldz, -1.25, 0.38, 0.35, 0.38, dist);
    if (blocked < dist - 0.02) continue;
    blocked = sphereT(sox, soy, soz, ldx, ldy, ldz, 0.95, 0.3, 0.55, 0.3, dist);
    if (blocked < dist - 0.02) continue;
    blocked = sphereT(sox, soy, soz, ldx, ldy, ldz, 0.25, 0.26, 1.15, 0.26, dist);
    if (blocked < dist - 0.02) continue;
    light += ndotl;
  }
  light = (light / SHADOW) * 7.5 + (ny * 0.5 + 0.5) * 0.22;
  scratch[out] = ar * light;
  scratch[out + 1] = ag * light;
  scratch[out + 2] = ab * light;

  if (mirror && depth < 1) {
    const nd = nx * dx + ny * dy + nz * dz;
    const rx = dx - 2 * nd * nx;
    const ry = dy - 2 * nd * ny;
    const rz = dz - 2 * nd * nz;
    seed = shadeRay(hx + nx * 0.02, hy + ny * 0.02, hz + nz * 0.02, rx, ry, rz, depth + 1, seed, scratch, slot + 1);
    const ro = (slot + 1) * 3;
    scratch[out] = scratch[out] * 0.08 + scratch[ro] * 0.92;
    scratch[out + 1] = scratch[out + 1] * 0.08 + scratch[ro + 1] * 0.92;
    scratch[out + 2] = scratch[out + 2] * 0.08 + scratch[ro + 2] * 0.92;
  }
  return seed;
}

function tracePixel(x, y, width, height, seed, pixels, offset, spp, scratch) {
  const aspect = width / height;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let s = 0; s < spp; s++) {
    const jx = (((seed * 13 + s * 47) % 1000) / 1000 - 0.5) / width;
    const jy = (((seed * 29 + s * 91) % 1000) / 1000 - 0.5) / height;
    const sx = (((x + 0.5) / width) * 2 - 1 + jx) * aspect * 0.78;
    const sy = (1 - ((y + 0.5) / height) * 2 + jy) * 0.78;
    let dx = sx;
    let dy = -0.1763 + sy * 0.9844;
    let dz = -0.9844 + sy * -0.1763;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    seed = shadeRay(0, 1.05, 3.35, dx, dy, dz, 0, seed + s + 1, scratch, 0);
    r += scratch[0];
    g += scratch[1];
    b += scratch[2];
  }
  const n = spp || 1;
  pixels[offset] = enc(r / n);
  pixels[offset + 1] = enc(g / n);
  pixels[offset + 2] = enc(b / n);
  pixels[offset + 3] = 255;
  return seed >>> 0;
}

function enc(c) {
  if (c < 0) c = 0;
  c = c / (1 + c);
  return Math.max(0, Math.min(255, Math.round(Math.pow(c, 0.4545) * 255)));
}

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const flag = new Int32Array(workerData.control);
${sphereT.toString()}
${shadeRay.toString()}
${enc.toString()}
${tracePixel.toString()}
const scratch = new Float64Array(6);
parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'tile') return;
  if (Atomics.load(flag, 0) === 2) {
    parentPort.postMessage({ type: 'tile', aborted: true });
    return;
  }
  try {
  const pixels = new Uint8Array(msg.w * msg.h * 4);
  let seed = (msg.seed || 1) >>> 0;
  for (let y = 0; y < msg.h; y++) {
    if ((y & 7) === 0 && Atomics.load(flag, 0) === 2) {
      parentPort.postMessage({ type: 'tile', aborted: true });
      return;
    }
    for (let x = 0; x < msg.w; x++) {
      seed = tracePixel(msg.x + x, msg.y + y, msg.width, msg.height, seed, pixels, (y * msg.w + x) * 4, ${SPP}, scratch);
    }
  }
  parentPort.postMessage({
    type: 'tile',
    x: msg.x,
    y: msg.y,
    w: msg.w,
    h: msg.h,
    pass: msg.pass,
    samples: msg.w * msg.h * ${SPP},
    pixels,
  }, [pixels.buffer]);
  } catch (err) {
    parentPort.postMessage({ type: 'tile', aborted: true, error: String(err && err.message || err) });
  }
});
`;

let emitTile = () => {};
let current = null;

function setEmitter(fn) {
  emitTile = typeof fn === 'function' ? fn : () => {};
}

function prepare() {
  if (current) {
    const err = new Error('A benchmark is already running.');
    err.code = 'BUSY';
    throw err;
  }
  const control = new SharedArrayBuffer(4);
  const threads = Math.max(1, Math.min(os.cpus().length || 1, 32));
  current = {
    stop: false,
    control,
    flag: new Int32Array(control),
    workers: [],
    idle: [],
    queue: [],
    inflight: 0,
    threads,
    cpuName: (os.cpus()?.[0]?.model || '').replace(/\s+/g, ' ').trim() || null,
    width: VIEW_W,
    height: VIEW_H,
    samples: 0,
    busyMs: 0,
    mark: 0,
    eased: false,
    renderOn: false,
    rendering: false,
    renderThreads: 0,
    pass: 0,
    onIdle: null,
  };
  Atomics.store(current.flag, 0, 0);
  return { cpuName: current.cpuName, threads, width: VIEW_W, height: VIEW_H };
}

function buildTiles(job) {
  const tiles = [];
  for (let y = 0; y < job.height; y += TILE) {
    for (let x = 0; x < job.width; x += TILE) {
      tiles.push({
        type: 'tile',
        x,
        y,
        w: Math.min(TILE, job.width - x),
        h: Math.min(TILE, job.height - y),
        width: job.width,
        height: job.height,
        pass: job.pass,
        seed: (job.pass * 10007 + x * 13 + y * 29 + 1) >>> 0,
      });
    }
  }
  return tiles;
}

function pump(job) {
  if (!job.renderOn || job.stop || job.eased) return;
  while (job.idle.length && job.queue.length) {
    const worker = job.idle.pop();
    const tile = job.queue.shift();
    job.inflight += 1;
    worker.postMessage(tile);
  }
}

function beginPass(job) {
  if (!job.renderOn || job.stop) return;
  job.pass += 1;
  job.queue = buildTiles(job);
  pump(job);
}

function noteIdle(job) {
  if (job.inflight === 0 && job.queue.length === 0 && job.renderOn && !job.eased && !job.stop) {
    beginPass(job);
    return;
  }
  if (!job.renderOn && job.inflight === 0 && job.onIdle) job.onIdle();
}

function startRender(job, threads) {
  if (job.stop) return { stopped: true, threads: 0, width: job.width, height: job.height };
  if (job.rendering) return { threads: job.renderThreads, width: job.width, height: job.height };
  const count = Math.max(1, Math.min(threads || job.threads, job.threads));
  job.samples = 0;
  job.busyMs = 0;
  job.mark = Date.now();
  job.eased = false;
  job.renderOn = true;
  job.rendering = true;
  job.renderThreads = count;
  job.pass = 0;
  job.inflight = 0;
  job.idle = [];
  job.queue = [];
  job.workers = [];
  Atomics.store(job.flag, 0, 0);
  for (let i = 0; i < count; i++) {
    const worker = new Worker(WORKER_SRC, { eval: true, workerData: { control: job.control } });
    worker.on('message', (msg) => {
      if (!msg || msg.type !== 'tile') {
        if (msg?.type === 'ready') {
          job.idle.push(worker);
          pump(job);
        }
        return;
      }
      job.inflight = Math.max(0, job.inflight - 1);
      if (!msg.aborted) {
        job.samples += Number(msg.samples) || 0;
        try { emitTile(msg); } catch { /* window gone */ }
      }
      if (job.renderOn && !job.stop) job.idle.push(worker);
      pump(job);
      if (job.inflight === 0 && job.queue.length === 0) noteIdle(job);
    });
    worker.on('error', () => {
      job.inflight = Math.max(0, job.inflight - 1);
      noteIdle(job);
    });
    job.workers.push(worker);
  }
  beginPass(job);
  return { threads: count, width: job.width, height: job.height };
}

function setEase(job, on) {
  if (!job.rendering) return { eased: false };
  if (job.stop || Atomics.load(job.flag, 0) === 2) return { eased: true };
  if (on && !job.eased) {
    job.busyMs += Date.now() - job.mark;
    job.eased = true;
  } else if (!on && job.eased) {
    job.eased = false;
    job.mark = Date.now();
    pump(job);
  }
  return { eased: job.eased };
}

function snapshot(job) {
  const elapsed = job.busyMs + (job.rendering && !job.eased ? Date.now() - job.mark : 0);
  return {
    samples: job.samples || 0,
    elapsedMs: elapsed,
    threads: job.renderThreads || 0,
    pass: job.pass || 0,
    width: job.width,
    height: job.height,
  };
}

function stopRender(job) {
  if (!job.rendering) {
    return Promise.resolve({
      samples: job.samples || 0,
      elapsedMs: job.busyMs || 0,
      threads: job.renderThreads || 0,
      width: job.width,
      height: job.height,
    });
  }
  job.renderOn = false;
  Atomics.store(job.flag, 0, 2);
  Atomics.notify(job.flag, 0);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!job.eased) job.busyMs += Date.now() - job.mark;
      job.eased = true;
      job.rendering = false;
      for (const worker of job.workers) {
        try { worker.terminate(); } catch { /* already gone */ }
      }
      job.workers = [];
      job.idle = [];
      job.inflight = 0;
      resolve({
        samples: job.samples || 0,
        elapsedMs: Math.max(1, job.busyMs || 0),
        threads: job.renderThreads || 0,
        width: job.width,
        height: job.height,
      });
    };
    job.onIdle = finish;
    if (job.inflight === 0) finish();
    else setTimeout(finish, 700);
  });
}

async function phase(opts = {}) {
  const job = current;
  if (!job) {
    const err = new Error('Benchmark is not running.');
    err.code = 'IDLE';
    throw err;
  }
  if (opts.kind === 'render-snap') return snapshot(job);
  if (opts.kind === 'render-stop') return stopRender(job);
  if (job.stop && opts.kind !== 'render-stop') return { stopped: true, ...snapshot(job) };
  if (opts.kind === 'render-start') return startRender(job, Number(opts.threads) || job.threads);
  if (opts.kind === 'render-ease') return setEase(job, !!opts.on);
  return { skipped: 'Unknown test.' };
}

async function finish() {
  const job = current;
  current = null;
  if (!job) return { ok: true };
  job.stop = true;
  job.renderOn = false;
  Atomics.store(job.flag, 0, 2);
  Atomics.notify(job.flag, 0);
  for (const worker of job.workers) {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  return { ok: true };
}

function cancel() {
  if (!current) return { ok: true };
  current.stop = true;
  current.renderOn = false;
  Atomics.store(current.flag, 0, 2);
  Atomics.notify(current.flag, 0);
  return { ok: true };
}

module.exports = { prepare, phase, finish, cancel, setEmitter, tracePixel, VIEW_W, VIEW_H, SPP };

if (require.main === module) {
  (async () => {
    const prep = await prepare();
    console.log('prep', prep);
    await phase({ kind: 'render-start', threads: prep.threads });
    const t0 = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const snap = await phase({ kind: 'render-snap' });
    const stopped = await phase({ kind: 'render-stop' });
    const sec = stopped.elapsedMs / 1000;
    console.log('multi', {
      samples: stopped.samples,
      elapsedMs: stopped.elapsedMs,
      rate: Math.round(stopped.samples / sec),
      snapRate: Math.round(snap.samples / Math.max(0.001, snap.elapsedMs / 1000)),
      wall: Date.now() - t0,
      pass: snap.pass,
    });
    await finish();
  })().catch(async (err) => {
    console.error(err);
    try { await finish(); } catch { /* closed */ }
    process.exit(1);
  });
}
