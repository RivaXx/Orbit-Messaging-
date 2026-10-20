// Adapted from the user's supplied gemini-code-1792477844739.html.
// No gate, controls, slogan, external media or persistent render loop.
window.createOrbitIntroScene=function(host,{reduced=false}={}) {
const cv = host.querySelector('[data-intro-canvas]'), ctx = cv.getContext('2d');
if(!ctx)throw new Error('Canvas unavailable');
const bl = host.querySelector('[data-intro-bloom]'), bctx = bl.getContext('2d');

let W, H, D, S, cx, cy;
function resize() {
  D = Math.min(devicePixelRatio || 1, 1.5);
  W = host.clientWidth;
  H = host.clientHeight;
  cv.width = W * D;
  cv.height = H * D;
  bl.width = Math.ceil(W / 4);
  bl.height = Math.ceil(H / 4);
  S = Math.min(W / 1100, H / 1400);
  cx = W / 2;
  cy = H * 0.40;
}
window.addEventListener('resize', resize);
resize();

// Math & Easing Helpers
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const easeO = x => 1 - Math.pow(1 - x, 3);
const easeIO = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const smoother = x => x * x * x * (x * (x * 6 - 15) + 10);
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;

// 3D Vector Utilities
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  mix: (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
};

/* ============================================================================
   EXACT SUBJECT GEOMETRY (3D Construction of Your Original 3 Orbits)
   When viewed from the front camera pose, these 3D orbits project to the
   EXACT rx, ry, and ang of your original design!
   ============================================================================ */
const orbits = [
  { rx: 500, ry: 122, ang: -91.5, col: [255, 190, 120] },
  { rx: 515, ry: 128, ang:  33.0, col: [130, 225, 255] },
  { rx: 530, ry: 125, ang: -33.0, col: [255, 150,  70] }
];

// Compute the 3D basis vectors of orbit `o` so that its XY projection has
// semi-major axis `rx` at angle `rot` and semi-minor axis `ry`, while its
// Z depth is `zDepth = sqrt(rx^2 - ry^2) * sin(theta)`!
function getOrbitBasis3D(o, i, timeVal) {
  const rot = (o.ang + 2.5 * Math.sin(timeVal * 0.35 + i * 2)) * Math.PI / 180;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const zAmp = Math.sqrt(Math.max(0, o.rx * o.rx - o.ry * o.ry));

  // Major axis vector in XY plane (length = rx)
  const U = [o.rx * cr, o.rx * sr, 0];
  // Minor axis vector tilted into 3D Z-depth (XY length = ry, Z depth = -zAmp so sin(t)>0 is closer to camera!)
  const V = [-o.ry * sr, o.ry * cr, -zAmp];
  // Unit normal to the 3D orbital plane
  const N = v3.norm(v3.cross(U, V));
  return { U, V, N, rot };
}

function evalOrbit3D(basis, theta) {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const pos = [
    ct * basis.U[0] + st * basis.V[0],
    ct * basis.U[1] + st * basis.V[1],
    ct * basis.U[2] + st * basis.V[2]
  ];
  const tan = v3.norm([
    -st * basis.U[0] + ct * basis.V[0],
    -st * basis.U[1] + ct * basis.V[1],
    -st * basis.U[2] + ct * basis.V[2]
  ]);
  const radOut = v3.norm(pos);
  return { pos, tan, radOut, binormal: basis.N };
}

// 6 Comets (2 per orbit). Comet on Orbit 2 (index 4) acts as the lead hero comet during the in-orbit camera ride!
const comets = [];
orbits.forEach((o, i) => {
  [0, Math.PI].forEach((off, j) => {
    comets.push({
      o: i,
      t: off + i,
      sp: (j ? -1 : 1) * (0.9 + i * 0.25 + j * 0.2),
      col: o.col,
      pd: undefined,
      hero: (i === 2 && j === 0)
    });
  });
});

// 3D Starfield + Orbital Stream Motes
const stars = Array.from({ length: 120 }, () => ({
  x: (Math.random() - 0.5) * 3200,
  y: (Math.random() - 0.5) * 2400,
  z: (Math.random() - 0.35) * 2200,
  r: Math.random() * 1.35 + 0.25,
  p: Math.random() * TAU,
  s: Math.random() * 2 + 0.5
}));

const motes = Array.from({ length: 48 }, (_, idx) => ({
  o: idx < 55 ? 2 : (idx % 3), // Extra stream particles inside Orbit 2 for the camera ride
  theta: Math.random() * TAU,
  sp: (Math.random() * 0.35 + 0.15) * (idx % 2 ? 1 : -1),
  radOff: (Math.random() - 0.5) * 110,
  binOff: (Math.random() - 0.5) * 110,
  z: Math.random() * 0.9 + 0.1,
  p: Math.random() * TAU
}));

let started = false, t0 = 0, time = 0, last = performance.now(), energy = 0;
let px = 0, py = 0, tx = 0, ty = 0;
let shake = 0, zap = null, nextZap = 5, ig = 0;
const sparks = [], shoot = [];

const pointerMove = e => {
  tx = (e.clientX / W) * 2 - 1;
  ty = (e.clientY / H) * 2 - 1;
};
window.addEventListener('pointermove',pointerMove,{passive:true});

/* ============================================================================
   3D CAMERA ENGINE WITH TELEPHOTO DOLLY-ZOOM
   Starts INSIDE Orbit 2 rotating & moving along the stream, then pulls out
   and converges 100% to your exact 2D emblem framing!
   ============================================================================ */
let camPos = [0, 0, -2400];
let camFwd = [0, 0, 1];
let camRight = [1, 0, 0];
let camUp = [0, 1, 0];
let focal = 2400;
let screenCenterX = 0, screenCenterY = 0;
const NEAR = 22;

function updateCamera3D(t, bases) {
  const hostBasis = bases[2]; // Orbit 2: Warm Ember-Gold Diagonal Orbit

  // 1. In-Orbit Camera State (Moving inside the orbit & corkscrewing around the stream)
  const orbitTheta = !started ? (time * 0.38) : (-1.95 + t * 1.08);
  const evHere = evalOrbit3D(hostBasis, orbitTheta);
  const evAhead = evalOrbit3D(hostBasis, orbitTheta + 0.52);

  // Spiral corkscrew around the orbital tube as we fly inside it
  const corkscrewAngle = !started ? (time * 0.45) : (t * 2.15);
  const tubeOffset = !started ? 32 : mix(24, 58, clamp(t / 4.2));
  const cCos = Math.cos(corkscrewAngle), cSin = Math.sin(corkscrewAngle);

  const inOrbitPos = [
    evHere.pos[0] + (evHere.radOut[0] * cCos + evHere.binormal[0] * cSin) * tubeOffset,
    evHere.pos[1] + (evHere.radOut[1] * cCos + evHere.binormal[1] * cSin) * tubeOffset,
    evHere.pos[2] + (evHere.radOut[2] * cCos + evHere.binormal[2] * cSin) * tubeOffset
  ];

  // Look forward along the orbital stream, slightly inward so the core glints ahead
  const inOrbitTarget = [
    evAhead.pos[0] * 0.84,
    evAhead.pos[1] * 0.84,
    evAhead.pos[2] * 0.84
  ];

  // 2. Pullout & Hero Reveal Transition Curves
  // `pullout`: 0 while riding inside the orbit (0..2.8s), smoothly easing to 1 at 10.2s
  const pullout = !started ? 0 : smoother(clamp((t - 2.6) / 7.6));
  const gazeShift = !started ? 0 : smoother(clamp((t - 2.0) / 4.6));

  // Telephoto Dolly-Zoom Distance:
  // Close & wide-angle when inside the orbit; long telephoto when viewing the full emblem
  // so perspective distortion vanishes and the ellipses match your exact rx/ry!
  const heroDist = 3200;
  const swirlAzimuth = (1 - pullout) * 1.45;
  const swirlElevation = (1 - pullout) * -0.28;

  const heroPos = [
    Math.sin(swirlAzimuth) * Math.cos(swirlElevation) * heroDist - px * 28 * pullout,
    Math.sin(swirlElevation) * heroDist - py * 20 * pullout,
    -Math.cos(swirlAzimuth) * Math.cos(swirlElevation) * heroDist
  ];

  camPos = v3.mix(inOrbitPos, heroPos, pullout);

  // Camera shake on core ignition
  const shX = (Math.random() - 0.5) * shake * 1.4;
  const shY = (Math.random() - 0.5) * shake * 1.4;

  const lookTarget = v3.mix(inOrbitTarget, [0, 0, 0], gazeShift);
  camFwd = v3.norm(v3.sub(lookTarget, camPos));

  // Barrel Roll: Full 360° rotation while flying inside the orbit, settling to 0° upright
  const rollBlend = !started ? 0 : smoother(clamp((t - 0.2) / 8.8));
  const barrelRoll = !started
    ? Math.sin(time * 0.3) * 0.25
    : (1 - rollBlend) * (TAU + 0.52);

  // Up vector blends from the orbit's 3D binormal to screen-vertical [0, -1, 0]
  // (Note: in screen coordinates Y points down, so world Up is [0, -1, 0] to match 2D canvas!)
  const upRef = v3.norm(v3.mix(hostBasis.N, [0, -1, 0], smoother(clamp((t - 2.4) / 5.2))));
  let r0 = v3.cross(camFwd, upRef);
  if (v3.len(r0) < 0.001) r0 = [1, 0, 0];
  r0 = v3.norm(r0);
  const u0 = v3.norm(v3.cross(r0, camFwd));

  const cr = Math.cos(barrelRoll), sr = Math.sin(barrelRoll);
  camRight = [
    r0[0] * cr + u0[0] * sr,
    r0[1] * cr + u0[1] * sr,
    r0[2] * cr + u0[2] * sr
  ];
  camUp = [
    u0[0] * cr - r0[0] * sr,
    u0[1] * cr - r0[1] * sr,
    u0[2] * cr - r0[2] * sr
  ];

  // Focal length scales with camera distance so that at the final pose (`pullout = 1`),
  // `focal / heroDist = S` (100% exact scale match to your original 2D code!)
  const camDist = v3.len(camPos);
  const punch = started && t > 3.8 ? Math.exp(-(t - 3.8) * 1.6) * 0.04 : 0;
  focal = mix(560, camDist, pullout) * S * (1 + punch);

  // Smoothly shift optical center from screen center `(W/2, H/2)` during the tunnel ride
  // to `(cx, cy = H*0.44)` for the hero reveal above the ORBIT title
  screenCenterX = mix(W * 0.5, cx + px * 12 + Math.sin(time * 0.2) * 6, pullout) + shX;
  screenCenterY = mix(H * 0.5, cy + py * 9 + Math.cos(time * 0.17) * 5, pullout) + shY;
}

function project3D(p) {
  const dx = p[0] - camPos[0], dy = p[1] - camPos[1], dz = p[2] - camPos[2];
  const vx = dx * camRight[0] + dy * camRight[1] + dz * camRight[2];
  const vy = dx * camUp[0]    + dy * camUp[1]    + dz * camUp[2];
  const vz = dx * camFwd[0]   + dy * camFwd[1]   + dz * camFwd[2];
  if (vz <= NEAR) return null;
  const sc = focal / vz;
  return {
    x: screenCenterX + vx * sc,
    y: screenCenterY + vy * sc,
    z: vz,
    sc
  };
}

// Helper for soft radial glows (identical to your original `glow()`, safe against negative radii)
function glow(x, y, r, c, a) {
  if (r <= 0.5 || a <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${clamp(a, 0, 1)})`);
  g.addColorStop(0.25, rgba(c, 0.8 * a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function burst(pos3D, col, n, sp) {
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, phi = Math.random() * TAU;
    const sq = Math.sqrt(1 - u * u), v = sp * (0.3 + Math.random());
    const L = 0.7 + Math.random() * 0.8;
    sparks.push({
      pos: [pos3D[0], pos3D[1], pos3D[2]],
      vel: [sq * Math.cos(phi) * v, u * v, sq * Math.sin(phi) * v],
      l: L, m: L,
      c: col
    });
  }
  if (sparks.length > 180) sparks.splice(0, sparks.length - 180);
}

/* ============================================================================
   SEAMLESS CONTINUOUS ORBIT & RIBBON COMET RENDERERS (ZERO BEADS!)
   ============================================================================ */
// Strokes a continuous array of projected 2D points in ONE single beginPath() call
function strokeContinuousCurve(pts2D, dx, dy) {
  if (pts2D.length < 2) return;
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i < pts2D.length; i++) {
    const p = pts2D[i];
    if (!p) { penDown = false; continue; }
    if (!penDown) {
      ctx.moveTo(p.x + dx, p.y + dy);
      penDown = true;
    } else {
      ctx.lineTo(p.x + dx, p.y + dy);
    }
  }
  ctx.stroke();
}

function drawOrbit3D(o, i, basis, p, coreVZ, pass) {
  if (p <= 0) return;
  const end = p * TAU;
  const steps = 90;

  // Sample continuous arc `[a, b]` and split cleanly into behind-core (pass 0) or front-of-core (pass 1)
  const renderArcLayer = (a, b, k) => {
    if (b <= a + 0.001) return;
    const pts = [];
    let sumScale = 0, validCount = 0;

    for (let s = 0; s <= steps; s++) {
      const th = a + (b - a) * (s / steps);
      const ev = evalOrbit3D(basis, th);
      const pr = project3D(ev.pos);
      if (!pr) {
        pts.push(null);
        continue;
      }
      pts.push(pr);
      sumScale += pr.sc;
      validCount++;
    }
    if (validCount < 2) return;

    const Z = clamp(sumScale / validCount, S * 0.5, S * 3.2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Exact 5-layer chromatic aberration recipe from your original code, stroked continuously!
    ctx.strokeStyle = rgba(o.col, 0.1 * k * (1 + energy));
    ctx.lineWidth = 20 * Z;
    strokeContinuousCurve(pts, 0, 0);

    ctx.strokeStyle = rgba(o.col, 0.35 * k);
    ctx.lineWidth = 5 * Z;
    strokeContinuousCurve(pts, 0, 0);

    ctx.strokeStyle = `rgba(255,40,30,${0.55 * k})`;
    ctx.lineWidth = 1.8 * Z;
    strokeContinuousCurve(pts, -3 * Z, 0);

    ctx.strokeStyle = `rgba(40,120,255,${0.7 * k})`;
    ctx.lineWidth = 2 * Z;
    strokeContinuousCurve(pts, 3.5 * Z, 0);

    ctx.strokeStyle = `rgba(255,245,225,${0.9 * k})`;
    ctx.lineWidth = 1.4 * Z;
    strokeContinuousCurve(pts, 0, 0);
  };

  if (pass === 0) {
    renderArcLayer(Math.PI, end, 0.4);
  } else {
    renderArcLayer(0, Math.min(end, Math.PI), 1.0);
  }

  // Leading laser head glow while orbit draws in
  if (p < 1) {
    const headFront = end <= Math.PI;
    if ((pass === 1 && headFront) || (pass === 0 && !headFront)) {
      const pr = project3D(evalOrbit3D(basis, end).pos);
      if (pr) glow(pr.x, pr.y, 46 * clamp(pr.sc, S * 0.5, S * 3), [255, 240, 220], 1);
    }
  }
}

// Filled Tapered Polygon Ribbon for Comets (100% smooth taper, ZERO internal stroke caps or dots!)
function fillTaperedRibbon(spinePts, halfWidthFn, fillStyle) {
  const valid = spinePts.filter(Boolean);
  if (valid.length < 3) return;
  const n = valid.length;
  const left = [], right = [];

  for (let i = 0; i < n; i++) {
    const p = valid[i];
    const pPrev = valid[Math.max(0, i - 1)];
    const pNext = valid[Math.min(n - 1, i + 1)];
    let tx = pNext.x - pPrev.x, ty = pNext.y - pPrev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    const f = i / (n - 1); // 0 = tail tip, 1 = comet head
    const w = halfWidthFn(f, p.sc);
    left.push([p.x + nx * w, p.y + ny * w]);
    right.push([p.x - nx * w, p.y - ny * w]);
  }

  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  // Round cap around the head
  const head = valid[n - 1];
  const headW = halfWidthFn(1, head.sc);
  const dx = left[n - 1][0] - head.x, dy = left[n - 1][1] - head.y;
  const ang = Math.atan2(dy, dx);
  ctx.arc(head.x, head.y, headW, ang, ang + Math.PI, false);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

function drawComet3D(c, basis, al, pass) {
  if (al <= 0) return;
  const d = Math.sin(c.t);
  const isFront = d >= 0;
  if ((pass === 1 && !isFront) || (pass === 0 && isFront)) return;

  const dir = Math.sign(c.sp);
  const tailArc = 1.25;
  const samples = 28;
  const spinePts = [];

  for (let k = 0; k <= samples; k++) {
    const f = k / samples; // 0 = tail tip, 1 = head
    const th = c.t - dir * tailArc * (1 - f);
    const pr = project3D(evalOrbit3D(basis, th).pos);
    if (pr) spinePts.push(pr);
  }
  if (spinePts.length < 3) return;

  const head = spinePts[spinePts.length - 1];
  const tail = spinePts[0];
  const Z = clamp(head.sc, S * 0.5, S * 3.5);
  const dk = 0.55 + 0.45 * (d + 1) * 0.5;

  // Linear gradient from transparent tail tip to incandescent head
  const gradOuter = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  gradOuter.addColorStop(0, rgba(c.col, 0));
  gradOuter.addColorStop(0.5, rgba(c.col, 0.22 * al * dk));
  gradOuter.addColorStop(1, rgba(c.col, 0.65 * al * dk));

  const gradInner = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  gradInner.addColorStop(0, 'rgba(255,248,235,0)');
  gradInner.addColorStop(0.45, `rgba(255,248,235,${0.35 * al * dk})`);
  gradInner.addColorStop(1, `rgba(255,252,245,${0.95 * al * dk})`);

  // 1. Wide outer glowing wake ribbon (zero beads!)
  fillTaperedRibbon(spinePts, (f, sc) => Math.pow(f, 1.5) * 10 * clamp(sc, S * 0.5, S * 3.2) * dk, gradOuter);
  // 2. Medium plasma body ribbon
  fillTaperedRibbon(spinePts, (f, sc) => Math.pow(f, 1.7) * 4.5 * clamp(sc, S * 0.5, S * 3.2) * dk, gradOuter);
  // 3. Crisp white-hot core spine ribbon
  fillTaperedRibbon(spinePts, (f, sc) => Math.pow(f, 2.0) * 1.8 * clamp(sc, S * 0.5, S * 3.2) * dk, gradInner);

  // 4. Glowing Comet Head with Chromatic Split (exact match to your original)
  const sc = 0.7 + 0.3 * (d + 1) * 0.5;
  glow(head.x, head.y, (40 + energy * 16) * Z * sc, c.col, al);
  glow(head.x - 2 * Z, head.y, 14 * Z * sc, [255, 60, 40], 0.5 * al);
  glow(head.x + 2 * Z, head.y, 14 * Z * sc, [60, 130, 255], 0.5 * al);
}

/* ============================================================================
   MAIN RENDER LOOP
   ============================================================================ */
let disposed=false,raf=0,lastDraw=-Infinity;
function frame(now) {
  if(disposed)return;
  if(!reduced)raf=requestAnimationFrame(frame);
  if(!reduced&&now-lastDraw<1000/30)return;
  lastDraw=now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  const t = reduced ? 12 : started ? (now - t0) / 1000 * 1.15 : 0;

  energy = 0.18 + 0.05 * Math.sin(time * 1.1);
  energy = clamp(energy, 0, 1.2);

  px += (tx - px) * 0.04;
  py += (ty - py) * 0.04;
  shake *= 0.94;

  // Compute 3D orbital bases & update 3D Camera
  const bases = orbits.map((o, i) => getOrbitBasis3D(o, i, time));
  updateCamera3D(t, bases);

  // Core ignition timing (detonates at t = 3.8s right as camera swings out of the orbit onto the Core!)
  const T_IG = 3.8;
  const coreK = !started ? 0.35 : (t < T_IG ? 0.35 + 0.2 * (t / T_IG) : 0.55 + 0.45 * easeO(clamp((t - T_IG) / 2.4)));
  const flash = started && t > T_IG ? Math.exp(-(t - T_IG) * 3.0) : 0;

  if (started && t >= T_IG && !ig) {
    ig = 1;
    shake = 2;
    burst([0, 0, 0], [255, 210, 150], 110, 420);
    burst([0, 0, 0], [120, 200, 255], 45, 290);

  }

  bl.style.opacity = 0.9 + 0.2 * flash;

  // Clear Canvas
  ctx.setTransform(D, 0, 0, D, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#020204';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  // Project Central Core Position
  const coreProj = project3D([0, 0, 0]);
  const ox = coreProj ? coreProj.x : screenCenterX;
  const oy = coreProj ? coreProj.y : screenCenterY;
  const coreZ = coreProj ? clamp(coreProj.sc, S * 0.4, S * 2.4) : S;
  const coreVZ = coreProj ? coreProj.z : 2000;

  // 1. Ambient Core Bloom
  if (coreProj) {
    const ambR = 520 * coreZ;
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, ambR);
    g.addColorStop(0, `rgba(255,70,20,${0.16 * coreK + energy * 0.05})`);
    g.addColorStop(1, 'rgba(255,40,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox - ambR, oy - ambR, ambR * 2, ambR * 2);
  }

  // 2. 3D Starfield (with speed streaks while flying inside the orbit)
  const inOrbitSpeed = started ? Math.sin(clamp(t / 9.5) * Math.PI) : 0.25;
  for (const s of stars) {
    const pr = project3D([s.x, s.y, s.z]);
    if (!pr) continue;
    const a = 0.25 + 0.5 * Math.abs(Math.sin(time * s.s * 0.6 + s.p));
    const r = clamp(s.r * (pr.sc / S), 0.3, 2.6);
    ctx.fillStyle = `rgba(255,230,210,${a * 0.8})`;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, r, 0, TAU);
    ctx.fill();

    if (inOrbitSpeed > 0.04) {
      const dx = pr.x - screenCenterX, dy = pr.y - screenCenterY;
      const dl = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = r * 0.8;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - (dx / dl) * inOrbitSpeed * 32 * r, pr.y - (dy / dl) * inOrbitSpeed * 32 * r);
      ctx.stroke();
    }
  }

  // 3. 3D Orbital Stream Dust & Shooting Stars
  for (const m of motes) {
    m.theta += m.sp * dt;
    const b = bases[m.o];
    const ev = evalOrbit3D(b, m.theta);
    const wPos = [
      ev.pos[0] + ev.radOut[0] * m.radOff + ev.binormal[0] * m.binOff,
      ev.pos[1] + ev.radOut[1] * m.radOff + ev.binormal[1] * m.binOff,
      ev.pos[2] + ev.radOut[2] * m.radOff + ev.binormal[2] * m.binOff
    ];
    const pr = project3D(wPos);
    if (!pr) continue;
    const lit = clamp(1 - Math.hypot(wPos[0], wPos[1], wPos[2]) / 620);
    const r = clamp((1.5 + m.z * 7) * pr.sc, 0.8, 26);
    const alpha = (0.05 + 0.28 * lit) * m.z * (0.7 + 0.3 * Math.sin(time * 2 + m.p));
    ctx.fillStyle = `rgba(255,${(150 + lit * 90) | 0},${(90 + lit * 60) | 0},${clamp(alpha, 0, 0.45)})`;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, r, 0, TAU);
    ctx.fill();
  }

  if (started && t > 6 && Math.random() < dt * 0.15) {
    shoot.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.4,
      vx: -(400 + Math.random() * 500),
      vy: 200 + Math.random() * 250,
      l: 1
    });
  }
  for (let i = shoot.length - 1; i >= 0; i--) {
    const s = shoot[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.l -= dt * 1.4;
    if (s.l <= 0) { shoot.splice(i, 1); continue; }
    ctx.strokeStyle = `rgba(255,235,215,${s.l * 0.8})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12);
    ctx.stroke();
  }

  // 4. Update Comets & Meridian Crossings
  comets.forEach(c => {
    if (!started && c.hero) {
      c.t = time * 0.38 + 0.42; // Lead comet glides right ahead of the camera in the gate preview
    } else if (started && c.hero && t < 3.8) {
      // During Act I, the camera chases the hero comet inside Orbit 2 and overtakes it as it exits!
      c.t = (-1.95 + t * 1.08) + mix(0.45, -0.12, easeIO(clamp(t / 3.8)));
    } else {
      c.t += c.sp * dt * (1 + energy * 0.4);
    }

    const ev = evalOrbit3D(bases[c.o], c.t);
    c.pos3D = ev.pos;
    const d = Math.sin(c.t);
    if (started && t > 3.8 && c.pd !== undefined && Math.sign(c.pd) !== Math.sign(d)) {
      burst(ev.pos, c.col, 14, 130);
      const pr = project3D(ev.pos);

      shake += 0.8;
    }
    c.pd = d;
    if (Math.random() < 0.5) burst(ev.pos, c.col, 1, 40);
  });

  //Orbits draw-in progress: Orbit 2 (host orbit) is already live at t=0 so we can ride inside it;
  // Orbits 0 & 1 trace in smoothly as the camera pulls out!
  const getOrbitProg = i => {
    if (!started) return i === 2 ? 1 : 0.35;
    if (i === 2) return 1;
    return easeIO(clamp((t - 1.2 - i * 0.6) / 3.2));
  };
  const getCometAlpha = c => {
    if (!started) return c.hero ? 1 : 0;
    if (c.hero) return 1;
    return easeO(clamp((t - 3.2 - c.o * 0.4) / 1.6));
  };

  // 5. BACK PASS: Orbits & Comets Behind the Core (sin(theta) < 0)
  orbits.forEach((o, i) => drawOrbit3D(o, i, bases[i], getOrbitProg(i), coreVZ, 0));
  comets.forEach(c => drawComet3D(c, bases[c.o], getCometAlpha(c), 0));

  // 6. MAIN SUBJECT CORE PASS (Your exact clean, radiant core + corona arcs + anamorphic flare!)
  if (coreProj) {
    // Clean circular corona arcs
    if (coreK > 0.3) {
      for (let i = 0; i < 3; i++) {
        const a0 = time * (1 + i * 0.4) + i;
        ctx.strokeStyle = `rgba(255,190,110,${0.28 * coreK})`;
        ctx.lineWidth = 1.5 * coreZ;
        ctx.beginPath();
        ctx.arc(ox, oy, (70 + i * 26) * coreZ * coreK, a0, a0 + 1.6 + Math.sin(time + i));
        ctx.stroke();
      }
    }

    // 14 Volumetric rotating rays
    const R = 150 * coreZ * coreK * (1 + energy * 0.2) * (1 + 0.03 * Math.sin(time * 23) + 0.02 * Math.sin(time * 37));
    if (coreK > 0.2) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(time * 0.12);
      for (let i = 0; i < 14; i++) {
        ctx.rotate(TAU / 14);
        const L = (210 + 90 * Math.sin(time * 1.3 + i * 1.7)) * coreZ * coreK * (1 + energy * 0.4);
        ctx.fillStyle = `rgba(255,200,130,${0.05 + energy * 0.04})`;
        ctx.beginPath();
        ctx.moveTo(0, -3 * coreZ);
        ctx.lineTo(L, 0);
        ctx.lineTo(0, 3 * coreZ);
        ctx.fill();
      }
      ctx.restore();
    }

    // Incandescent core radial gradient
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 1.8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,244,184,.95)');
    g.addColorStop(0.4, 'rgba(255,164,58,.55)');
    g.addColorStop(1, 'rgba(255,58,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox - R * 1.8, oy - R * 1.8, R * 3.6, R * 3.6);

    // Anamorphic lens flare
    if (coreK > 0.3) {
      const fw = W * (0.55 + 0.25 * energy) * coreK;
      const fh = (2.5 + energy * 4) * coreZ;
      let fg = ctx.createLinearGradient(ox - fw, 0, ox + fw, 0);
      fg.addColorStop(0, 'rgba(255,120,60,0)');
      fg.addColorStop(0.5, `rgba(255,235,205,${0.7 + energy * 0.2})`);
      fg.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(ox - fw, oy - fh / 2, fw * 2, fh);

      fg = ctx.createLinearGradient(ox - fw, 0, ox + fw, 0);
      fg.addColorStop(0, 'rgba(60,140,255,0)');
      fg.addColorStop(0.5, 'rgba(90,170,255,.35)');
      fg.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(ox - fw * 1.2, oy + fh * 1.2, fw * 2.4, fh * 0.6);
    }
  }

  // 7. FRONT PASS: Orbits & Comets In Front of the Core (sin(theta) >= 0)
  orbits.forEach((o, i) => drawOrbit3D(o, i, bases[i], getOrbitProg(i), coreVZ, 1));
  comets.forEach(c => drawComet3D(c, bases[c.o], getCometAlpha(c), 1));

  // 8. 3D Sparks
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.l -= dt;
    if (s.l <= 0) { sparks.splice(i, 1); continue; }
    const prev = [s.pos[0], s.pos[1], s.pos[2]];
    s.pos[0] += s.vel[0] * dt;
    s.pos[1] += s.vel[1] * dt;
    s.pos[2] += s.vel[2] * dt;
    s.vel[0] *= 0.985; s.vel[1] *= 0.985; s.vel[2] *= 0.985;

    const p0 = project3D(prev), p1 = project3D(s.pos);
    if (!p0 || !p1) continue;
    ctx.strokeStyle = rgba(s.c, s.l / s.m);
    ctx.lineWidth = 1.6 * clamp(p1.sc, S * 0.5, S * 2.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p0.x, p0.y);
    ctx.stroke();
  }

  // 9. Core-to-Comet Lightning Arc
  nextZap -= dt;
  if (false) {
    zap = { c: comets[Math.floor(Math.random() * comets.length)], l: 0.18 };
    nextZap = 2.5 + Math.random() * 3.5;
    shake += 2;

  }
  if (zap) {
    zap.l -= dt;
    const targetPr = zap.c.pos3D ? project3D(zap.c.pos3D) : null;
    if (targetPr && zap.l > 0) {
      const N = 16, pts = [[ox, oy]];
      for (let k = 1; k < N; k++) {
        const f = k / N, j = Math.sin(Math.PI * f) * 30 * coreZ;
        pts.push([
          ox + (targetPr.x - ox) * f + (Math.random() - 0.5) * j,
          oy + (targetPr.y - oy) * f + (Math.random() - 0.5) * j
        ]);
      }
      pts.push([targetPr.x, targetPr.y]);
      ctx.lineJoin = 'round';
      for (const [w, col] of [
        [10, 'rgba(110,170,255,.22)'],
        [3, 'rgba(190,225,255,.75)'],
        [1.2, 'rgba(255,255,255,1)']
      ]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w * coreZ;
        ctx.beginPath();
        pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.stroke();
      }
    } else {
      zap = null;
    }
  }

  // 10. Shockwave & Ignition Flash
  if (started && t > T_IG && t < T_IG + 3.0) {
    const dtIg = t - T_IG;
    const r = dtIg * 560 * coreZ, a = Math.max(0, 1 - dtIg / 3.0);
    ctx.strokeStyle = `rgba(255,200,150,${a * 0.5})`;
    ctx.lineWidth = (4 + 8 * a) * coreZ;
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = `rgba(90,170,255,${a * 0.3})`;
    ctx.lineWidth = 2.5 * coreZ;
    ctx.beginPath();
    ctx.arc(ox, oy, r * 0.97, 0, TAU);
    ctx.stroke();
  }
  if (flash > 0.01) {
    ctx.fillStyle = `rgba(255,240,220,${flash * 0.06})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Vignette & Bloom
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.33, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  bctx.drawImage(cv, 0, 0, bl.width, bl.height);
}
started=true;t0=performance.now();last=t0;host.classList.add('go');
raf=requestAnimationFrame(frame);
return ()=>{disposed=true;cancelAnimationFrame(raf);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',pointerMove);cv.width=cv.height=bl.width=bl.height=0;};

};
