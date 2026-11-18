/* =========================================================================
   FS-01 · Stage 02 dynamic chassis
   00-core.js — constants, state schema, road frame and static load solver
   ========================================================================= */

const GRAVITY = 9.80665;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const STORAGE_KEY = 'fs01.dynamic.setup.v1';
const APP_VERSION = '0.4.0';

const CORNERS = [
  { key: 'FL', zh: '左前', axle: 'front', side: 'left', zSign: -1 },
  { key: 'FR', zh: '右前', axle: 'front', side: 'right', zSign: 1 },
  { key: 'RL', zh: '左后', axle: 'rear', side: 'left', zSign: -1 },
  { key: 'RR', zh: '右后', axle: 'rear', side: 'right', zSign: 1 }
];

const NUM_LIMITS = {
  slope: [-10, 10],
  bank: [-10, 10],
  friction: [0.2, 1.8],
  mass: [600, 1000],
  frontWeightPct: [40, 55],
  cgHeight: [0.15, 0.6],
  cgLateral: [-0.12, 0.12],
  wheelbase: [3.2, 3.9],
  trackFront: [1.45, 1.75],
  trackRear: [1.4, 1.72],
  wheelRadius: [0.31, 0.39],
  wheelRateF: [50, 320],
  wheelRateR: [50, 320],
  dampingF: [0.05, 1.2],
  dampingR: [0.05, 1.2],
  arbFront: [0, 100],
  arbRear: [0, 100],
  steer: [-18, 18]
};

// Maximum equivalent wheel-rate contribution of each anti-roll bar at 100 %
// blade stiffness. The blade is treated as an ideal rectangular section whose
// bending stiffness follows cos^2(theta), so the UI percentage maps directly to
// the effective wheel rate while the visible blade rotates by acos(sqrt(p)).
const ARB_MAX_RATE = { front: 70000, rear: 90000 };

const DEFAULTS = Object.freeze({
  mass: 798,
  frontWeightPct: 45.5,
  cgHeight: 0.30,
  cgLateral: 0.0,
  wheelbase: 3.55,
  trackFront: 1.62,
  trackRear: 1.58,
  wheelRadius: 0.36,
  tireWidthF: 0.305,
  tireWidthR: 0.405,
  wheelRateF: 140,
  wheelRateR: 160,
  dampingF: 0.35,
  dampingR: 0.38,
  arbFront: 60,
  arbRear: 60,
  slope: 0,
  bank: 0,
  steer: 0,
  friction: 1.4,
  showLoads: true,
  showCG: true,
  showLabels: false,
  showParts: true,
  xray: false,
  units: 'N'
});

const state = Object.assign({}, DEFAULTS);
let autoRotate = false;


// B3-2: geometry generations. Six dimension keys define one immutable
// hard-point set; the revision is allocated monotonically and the active
// revision (the one the running sim owns) is never evicted.
const GEOMETRY_KEYS = ['wheelbase', 'trackFront', 'trackRear', 'wheelRadius', 'tireWidthF', 'tireWidthR'];
let GEOMETRY_SERIAL = 0;
let ACTIVE_GEOMETRY_KEY = '';
const GEOMETRY_REVISIONS = new Map();

function geometrySignature(source = state) {
  return GEOMETRY_KEYS.map((key) => Number(source[key]).toFixed(6)).join('|');
}

function setActiveGeometry(source = state) {
  ACTIVE_GEOMETRY_KEY = geometrySignature(source);
  return geometryRevisionFor(source);
}

function geometryRevisionFor(source = state) {
  const key = geometrySignature(source);
  let revision = GEOMETRY_REVISIONS.get(key);
  if (!revision) {
    GEOMETRY_SERIAL += 1;
    revision = GEOMETRY_SERIAL;
    GEOMETRY_REVISIONS.set(key, revision);
    while (GEOMETRY_REVISIONS.size > 64) {
      let evict = null;
      for (const candidate of GEOMETRY_REVISIONS.keys()) {
        if (candidate !== ACTIVE_GEOMETRY_KEY) {
          evict = candidate;
          break;
        }
      }
      if (!evict) break;
      GEOMETRY_REVISIONS.delete(evict);
    }
  }
  return revision;
}

function cloneState(source = state) {
  return Object.assign({}, source);
}

function copyDefaults() {
  Object.assign(state, DEFAULTS);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const nearly = (a, b, eps = 1e-7) => Math.abs(a - b) <= eps;

function sanitizeState(input) {
  const out = Object.assign({}, DEFAULTS);
  if (!input || typeof input !== 'object') return out;
  for (const [key, [lo, hi]] of Object.entries(NUM_LIMITS)) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) out[key] = clamp(value, lo, hi);
  }
  for (const key of ['tireWidthF', 'tireWidthR']) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) out[key] = clamp(value, 0.24, 0.5);
  }
  for (const key of ['showLoads', 'showCG', 'showLabels', 'showParts', 'xray']) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  if (input.units === 'kg' || input.units === 'N') out.units = input.units;
  return out;
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch (_error) {
    return null;
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    /* file:// origins may deny storage; the tool remains fully usable */
  }
}

function computeDims(source = state) {
  const L = source.wheelbase;
  const tf = source.trackFront;
  const tr = source.trackRear;
  return {
    L,
    tf,
    tr,
    R: source.wheelRadius,
    wF: source.tireWidthF,
    wR: source.tireWidthR,
    xF: L / 2,
    xR: -L / 2,
    zF: tf / 2,
    zR: tr / 2,
    xCG: (source.frontWeightPct / 100 - 0.5) * L
  };
}

/**
 * Bodywork stations shared by the loft renderer and suspension packaging tests.
 * X stations are relative to the front axle so dimension changes preserve the
 * established Formula-car silhouette. No suspension hardpoint is stored here.
 */
function buildBodyworkProfiles(dims) {
  const at = (section) => Object.assign({}, section, { x: dims.xF + section.x });
  return {
    monocoque: [
      { x: 0.83, w: 0.075, y0: 0.190, y1: 0.278, e: 0.82 },
      { x: 0.62, w: 0.11, y0: 0.165, y1: 0.315, e: 0.8 },
      { x: 0.38, w: 0.17, y0: 0.140, y1: 0.365, e: 0.76 },
      { x: 0.13, w: 0.245, y0: 0.115, y1: 0.425, e: 0.73 },
      { x: -0.15, w: 0.32, y0: 0.096, y1: 0.492, e: 0.7 },
      { x: -0.45, w: 0.40, y0: 0.082, y1: 0.555, e: 0.68 },
      { x: -0.80, w: 0.47, y0: 0.074, y1: 0.600, e: 0.66 },
      { x: -1.15, w: 0.53, y0: 0.068, y1: 0.625, e: 0.64 },
      { x: -1.45, w: 0.56, y0: 0.064, y1: 0.645, e: 0.64 },
      { x: -1.75, w: 0.54, y0: 0.063, y1: 0.650, e: 0.66 },
      { x: -2.10, w: 0.45, y0: 0.070, y1: 0.620, e: 0.7 },
      { x: -2.45, w: 0.34, y0: 0.083, y1: 0.545, e: 0.74 },
      { x: -2.80, w: 0.22, y0: 0.110, y1: 0.430, e: 0.8 },
      { x: -3.08, w: 0.12, y0: 0.150, y1: 0.320, e: 0.88 }
    ].map(at),
    engineCover: [
      { x: -1.60, w: 0.245, y0: 0.58, y1: 0.700, e: 0.8 },
      { x: -1.80, w: 0.27, y0: 0.55, y1: 0.755, e: 0.75 },
      { x: -2.02, w: 0.27, y0: 0.50, y1: 0.815, e: 0.72 },
      { x: -2.30, w: 0.24, y0: 0.43, y1: 0.800, e: 0.7 },
      { x: -2.60, w: 0.20, y0: 0.36, y1: 0.735, e: 0.7 },
      { x: -2.95, w: 0.14, y0: 0.29, y1: 0.620, e: 0.74 },
      { x: -3.25, w: 0.085, y0: 0.24, y1: 0.470, e: 0.82 },
      { x: -3.48, w: 0.045, y0: 0.22, y1: 0.335, e: 0.9 }
    ].map(at)
  };
}

/**
 * Equivalent body inertia about the centre of mass. The car is treated as a
 * filled box whose length, width and height follow the current dimensions. The
 * values are deliberately modest but physically sized: the roll inertia is
 * dominated by the track, the pitch and yaw inertias by the wheelbase.
 */
function computeBodyInertia(source, dims) {
  const mass = source.mass;
  const length = dims.L + 0.7;
  const width = Math.max(dims.tf, dims.tr) + 0.18;
  const height = 0.86;
  return {
    Ixx: (mass / 12) * (height * height + width * width),
    Iyy: (mass / 12) * (length * length + width * width),
    Izz: (mass / 12) * (length * length + height * height)
  };
}

/**
 * Road-frame convention (identical to the Three.js scene):
 *   +X forward (uphill for positive slope)
 *   +Y normal to the road plane (up)
 *   +Z right (right side lower for positive bank)
 * The road group is rotated by slope about world Z, then bank about the
 * rotated forward axis. Gravity remains world-vertical.
 */
function roadQuaternion(slopeDeg, bankDeg) {
  const slope = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slopeDeg * DEG);
  const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bankDeg * DEG);
  return slope.multiply(bank);
}

function computeRoadFrame(source = state) {
  const q = roadQuaternion(source.slope, source.bank);
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const gravityWorld = new THREE.Vector3(0, -GRAVITY, 0);
  const gravityLocal = gravityWorld.clone().applyQuaternion(q.clone().invert());
  const beta = Math.acos(clamp(normal.y, -1, 1));
  return {
    q,
    forward,
    normal,
    right,
    gravityWorld,
    gravityLocal,
    beta,
    betaDeg: beta * RAD,
    cosBeta: Math.cos(beta),
    sinBeta: Math.sin(beta),
    frictionDemand: Math.tan(beta)
  };
}

/** Gaussian elimination with partial pivoting for a 3x3 system. */
function solve3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]]
  ];
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    if (pivot !== col) {
      const tmp = M[pivot];
      M[pivot] = M[col];
      M[col] = tmp;
    }
    const diag = M[col][col];
    for (let row = col + 1; row < 3; row += 1) {
      const factor = M[row][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < 4; c += 1) M[row][c] -= factor * M[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = M[row][3];
    for (let c = row + 1; c < 3; c += 1) sum -= M[row][c] * x[c];
    x[row] = sum / M[row][row];
  }
  if (!x.every(Number.isFinite)) return null;
  return x;
}

/**
 * Stage-01 static load model.
 *
 * The car is represented as a rigid body supported by four linear wheel-rate
 * springs. The contact plane is the road plane. Gravity's normal component is
 * carried by the four normal forces; its tangent component is held by tyre
 * friction. The line of action of the vertical weight intersects the plane at
 * P, and the four normal forces must satisfy force and moment equilibrium.
 *
 * Corner spring force: N_i = N_i0 - k_i * (h + x_i p - z_i r)
 * where N_i0 are the design corner loads at the level design attitude, h is
 * heave along the road normal, p is nose-up pitch and r is right-side-down
 * roll. The three equilibrium equations determine h, p and r uniquely.
 */
function computeStatic(source = state) {
  const dims = computeDims(source);
  const frame = computeRoadFrame(source);
  const mass = source.mass;
  const totalWeight = mass * GRAVITY;
  const totalNormal = -mass * frame.gravityLocal.y; // mg cos(beta)
  const xCG = dims.xCG;
  const zCG = source.cgLateral;
  const hCG = source.cgHeight;

  // Vertical gravity line through the CG intersected with the road plane.
  const t = -hCG / frame.gravityLocal.y;
  const px = xCG + t * frame.gravityLocal.x;
  const pz = zCG + t * frame.gravityLocal.z;

  const wheels = [
    { key: 'FL', zh: '左前', x: dims.xF, z: -dims.zF, axle: 'front', side: 'left', zSign: -1 },
    { key: 'FR', zh: '右前', x: dims.xF, z: dims.zF, axle: 'front', side: 'right', zSign: 1 },
    { key: 'RL', zh: '左后', x: dims.xR, z: -dims.zR, axle: 'rear', side: 'left', zSign: -1 },
    { key: 'RR', zh: '右后', x: dims.xR, z: dims.zR, axle: 'rear', side: 'right', zSign: 1 }
  ];

  // Design corner loads at the level design attitude. Longitudinal split from
  // the front axle load ratio; lateral split from the lateral CG position at
  // each axle's own track. These become the reference/preload state of the
  // four corner springs; at beta = 0 the solved attitude is exactly level.
  const frontPct = source.frontWeightPct / 100;
  const frontAxle = totalWeight * frontPct;
  const rearAxle = totalWeight - frontAxle;
  const rightShareF = clamp(0.5 + zCG / dims.tf, 0.02, 0.98);
  const rightShareR = clamp(0.5 + zCG / dims.tr, 0.02, 0.98);
  const baseLoads = [
    frontAxle * (1 - rightShareF),
    frontAxle * rightShareF,
    rearAxle * (1 - rightShareR),
    rearAxle * rightShareR
  ];

  const k = wheels.map((wheel) => (wheel.axle === 'front' ? source.wheelRateF : source.wheelRateR) * 1000);
  const arbRate = {
    front: (source.arbFront / 100) * ARB_MAX_RATE.front,
    rear: (source.arbRear / 100) * ARB_MAX_RATE.rear
  };
  const arbRollStiffness = arbRate.front * dims.tf * dims.tf + arbRate.rear * dims.tr * dims.tr;

  let sumK = 0;
  let sumKX = 0;
  let sumKZ = 0;
  let sumKXX = 0;
  let sumKXZ = 0;
  let sumKZZ = 0;
  wheels.forEach((wheel, i) => {
    const ki = k[i];
    sumK += ki;
    sumKX += ki * wheel.x;
    sumKZ += ki * wheel.z;
    sumKXX += ki * wheel.x * wheel.x;
    sumKXZ += ki * wheel.x * wheel.z;
    sumKZZ += ki * wheel.z * wheel.z;
  });

  const b0 = baseLoads.reduce((a, v) => a + v, 0) - totalNormal;
  const b1 = baseLoads.reduce((a, v, i) => a + v * wheels[i].x, 0) - totalNormal * px;
  const b2 = baseLoads.reduce((a, v, i) => a + v * wheels[i].z, 0) - totalNormal * pz;

  // The anti-roll bars add no net vertical force and no pitch moment: their
  // equal-and-opposite wheel forces form a pure roll couple. Only the third
  // (roll) equation therefore gains a term, +K_arb * roll.
  const A = [
    [sumK, sumKX, -sumKZ],
    [sumKX, sumKXX, -sumKXZ],
    [sumKZ, sumKXZ, -sumKZZ - arbRollStiffness]
  ];
  const solved = solve3(A, [b0, b1, b2]) || [0, 0, 0];
  let heave = solved[0];
  let pitch = solved[1];
  let roll = solved[2];

  // Stage-02 dynamic reference. The wheel rate remains the design parameter; the
  // motion ratio is no longer an input. It is measured from the actual hardpoint
  // geometry by solving the four corner mechanisms, so the coil rate, the
  // preload and the force path all follow the same linkage that is drawn.
  const dampingRatio = {
    front: clamp(Number.isFinite(source.dampingF) ? source.dampingF : DEFAULTS.dampingF, 0.02, 1.5),
    rear: clamp(Number.isFinite(source.dampingR) ? source.dampingR : DEFAULTS.dampingR, 0.02, 1.5)
  };
  const cornerMass = baseLoads.map((value) => value / GRAVITY);
  const criticalDamping = k.map((ki, i) => 2 * Math.sqrt(ki * Math.max(cornerMass[i], 1e-6)));
  const damperRateWheel = k.map((ki, i) => {
    const ratio = wheels[i].axle === 'front' ? dampingRatio.front : dampingRatio.rear;
    return ratio * criticalDamping[i];
  });

  const cornerGeometry = suspensionBuild({ dims, wheels });
  const designQuat = new THREE.Quaternion();
  const designLevel = cornerGeometry.corners.map((corner) =>
    suspSolveCorner(corner, { x: 0, y: 0, z: 0 }, designQuat, 0, null, true));
  const cornerRatio = designLevel.map((solution) => {
    if (solution.motionRatio != null && Number.isFinite(solution.motionRatio) && Math.abs(solution.motionRatio) > 1e-3) {
      return solution.motionRatio;
    }
    return 0.5;
  });
  const motionRatio = {
    front: (Math.abs(cornerRatio[0]) + Math.abs(cornerRatio[1])) / 2,
    rear: (Math.abs(cornerRatio[2]) + Math.abs(cornerRatio[3])) / 2
  };
  const springRateCoil = k.map((ki, i) => ki / Math.pow(cornerRatio[i], 2));
  const damperRateShaft = damperRateWheel.map((ci, i) => ci / Math.pow(cornerRatio[i], 2));
  const springDesign = designLevel.map((solution, i) => {
    const dLdDelta = -cornerRatio[i];
    const ratio = Math.abs(cornerRatio[i]) > 1e-3 ? cornerRatio[i] : 0.5;
    const length0 = solution.coilLength;
    const refLength = length0 + baseLoads[i] / (springRateCoil[i] * ratio);
    return {
      length0,
      refLength,
      motionRatio: cornerRatio[i],
      dLdDelta,
      rockerAngle0: solution.rockerAngle,
      coilRate: springRateCoil[i],
      coilDamping: damperRateShaft[i]
    };
  });

  // Geometric static equilibrium. The linear solve only supplies a starting
  // pose; the reference attitude is refined with the same mechanism forces that
  // the integrator evaluates, so static and dynamic equilibria agree.
  const staticSeeds = [null, null, null, null];
  const evaluateStatic = (h, p, r) => {
    const quat = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), p)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r));
    const bodyPos = { x: 0, y: h, z: 0 };
    const cornerY = wheels.map((wheel) => h + wheel.x * p - wheel.z * r);
    const arb = [0, 0, 0, 0];
    for (const pair of [[0, 1], [2, 3]]) {
      const rate = arbRate[wheels[pair[0]].axle] || 0;
      const delta = cornerY[pair[0]] - cornerY[pair[1]];
      arb[pair[0]] = -rate * delta;
      arb[pair[1]] = rate * delta;
    }
    const raw = cornerGeometry.corners.map((corner, i) => {
      const solution = suspSolveCorner(corner, bodyPos, quat, 0, staticSeeds[i], true);
      staticSeeds[i] = solution.seed;
      const ratio = solution.motionRatio != null ? solution.motionRatio : springDesign[i].motionRatio;
      const spring = springDesign[i].coilRate * (solution.coilLength - springDesign[i].refLength) * (-ratio);
      return spring + arb[i];
    });
    const sum = raw.reduce((acc, value) => acc + value, 0);
    const mx = raw.reduce((acc, value, i) => acc + value * wheels[i].x, 0);
    const mz = raw.reduce((acc, value, i) => acc + value * wheels[i].z, 0);
    return { raw, arb, cornerY, sum, mx, mz };
  };
  {
    const target = [totalNormal, totalNormal * px, totalNormal * pz];
    for (let iter = 0; iter < 6; iter += 1) {
      const evaluation = evaluateStatic(heave, pitch, roll);
      const residual = [evaluation.sum - target[0], evaluation.mx - target[1], evaluation.mz - target[2]];
      if (Math.max(Math.abs(residual[0]), Math.abs(residual[1]), Math.abs(residual[2])) < 1e-7) break;
      const hStep = 1e-4;
      const aStep = 1e-5;
      const eh = evaluateStatic(heave + hStep, pitch, roll);
      const ep = evaluateStatic(heave, pitch + aStep, roll);
      const er = evaluateStatic(heave, pitch, roll + aStep);
      const J = [
        [(eh.sum - evaluation.sum) / hStep, (ep.sum - evaluation.sum) / aStep, (er.sum - evaluation.sum) / aStep],
        [(eh.mx - evaluation.mx) / hStep, (ep.mx - evaluation.mx) / aStep, (er.mx - evaluation.mx) / aStep],
        [(eh.mz - evaluation.mz) / hStep, (ep.mz - evaluation.mz) / aStep, (er.mz - evaluation.mz) / aStep]
      ];
      const delta = solve3(J, [-residual[0], -residual[1], -residual[2]]);
      if (!delta) break;
      heave += clamp(delta[0], -0.01, 0.01);
      pitch += clamp(delta[1], -0.005, 0.005);
      roll += clamp(delta[2], -0.005, 0.005);
    }
  }
  const staticState = evaluateStatic(heave, pitch, roll);
  const cornerY = staticState.cornerY;
  const arbForce = staticState.arb;
  const arbMoment = arbForce.reduce((acc, value, i) => acc + value * wheels[i].z, 0);
  const rawLoads = staticState.raw;
  const loads = rawLoads.map((value) => Math.max(0, value));
  const minRawLoad = Math.min(...rawLoads);
  const liftedCount = rawLoads.filter((value) => value < -1e-6).length;

  const sumLoads = loads.reduce((a, v) => a + v, 0);
  const frontLoad = loads[0] + loads[1];
  const rearLoad = loads[2] + loads[3];
  const leftLoad = loads[0] + loads[2];
  const rightLoad = loads[1] + loads[3];
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const normalMomentX = loads.reduce((a, v, i) => a + v * wheels[i].x, 0);
  const normalMomentZ = loads.reduce((a, v, i) => a + v * wheels[i].z, 0);
  const forceError = Math.abs(rawLoads.reduce((a, v) => a + v, 0) - totalNormal);
  const momentXError = Math.abs(rawLoads.reduce((a, v, i) => a + v * wheels[i].x, 0) - totalNormal * px);
  const momentZError = Math.abs(rawLoads.reduce((a, v, i) => a + v * wheels[i].z, 0) - totalNormal * pz);
  const frictionOk = frame.beta <= Math.atan(source.friction) + 1e-9;

  const levelLoads = baseLoads.slice();
  const levelFront = levelLoads[0] + levelLoads[1];
  const levelRear = levelLoads[2] + levelLoads[3];
  const levelLeft = levelLoads[0] + levelLoads[2];
  const levelRight = levelLoads[1] + levelLoads[3];

  const inertia = computeBodyInertia(source, dims);
  const heaveStiffness = sumK;
  const rollStiffnessSpring = wheels.reduce((acc, wheel, i) => acc + k[i] * Math.pow(wheel.z - zCG, 2), 0);
  const rollStiffness = rollStiffnessSpring + arbRollStiffness;
  const pitchStiffness = wheels.reduce((acc, wheel, i) => acc + k[i] * Math.pow(wheel.x - xCG, 2), 0);
  const criticalHeave = 2 * Math.sqrt(Math.max(heaveStiffness * mass, 1e-9));
  const frequencies = {
    heave: Math.sqrt(Math.max(heaveStiffness / mass, 0)) / (2 * Math.PI),
    roll: Math.sqrt(Math.max(rollStiffness / inertia.Ixx, 0)) / (2 * Math.PI),
    pitch: Math.sqrt(Math.max(pitchStiffness / inertia.Izz, 0)) / (2 * Math.PI)
  };

  const denom = sumLoads > 1e-9 ? sumLoads : 1;
  const frontShare = frontLoad / denom;
  const leftShare = leftLoad / denom;

  return {
    source,
    geometryRevision: geometryRevisionFor(source),
    geometrySignature: geometrySignature(source),
    dims,
    frame,
    mass,
    totalWeight,
    totalNormal,
    xCG,
    zCG,
    hCG,
    px,
    pz,
    projection: { x: px, z: pz, dx: px - xCG, dz: pz - zCG },
    wheels,
    baseLoads,
    levelLoads,
    level: {
      loads: levelLoads,
      front: levelFront,
      rear: levelRear,
      left: levelLeft,
      right: levelRight
    },
    springRates: k,
    cornerMass,
    dampingRatio,
    criticalDamping,
    damperRateWheel,
    damperRateShaft,
    springRateCoil,
    motionRatio,
    suspension: {
      corners: cornerGeometry.corners,
      design: springDesign
    },
    inertia,
    stiffness: {
      heave: heaveStiffness,
      rollSpring: rollStiffnessSpring,
      roll: rollStiffness,
      pitch: pitchStiffness
    },
    frequencies,
    heaveDampingRatio: damperRateWheel.reduce((acc, value) => acc + value, 0) / criticalHeave,
    arbRate,
    arbMaxRate: ARB_MAX_RATE,
    arbRollStiffness,
    arbMoment,
    arbForce,
    arbBladeAngleDeg: {
      front: Math.acos(Math.sqrt(clamp(source.arbFront / 100, 0, 1))) * RAD,
      rear: Math.acos(Math.sqrt(clamp(source.arbRear / 100, 0, 1))) * RAD
    },
    heave,
    pitch,
    roll,
    referencePoint: { x: 0, y: heave, z: 0 },
    poseDeg: {
      pitch: pitch * RAD,
      roll: roll * RAD
    },
    cornerY,
    travelMm: cornerY.map((y) => -y * 1000),
    rawLoads,
    loads,
    liftedCount,
    minRawLoad,
    sumLoads,
    frontLoad,
    rearLoad,
    leftLoad,
    rightLoad,
    maxLoad,
    minLoad,
    frontShare,
    rearShare: 1 - frontShare,
    leftShare,
    rightShare: 1 - leftShare,
    normalMomentX,
    normalMomentZ,
    forceError,
    momentXError,
    momentZError,
    frictionOk,
    frictionDemand: frame.frictionDemand,
    frictionCapacity: source.friction,
    equilibriumOk: forceError < 0.05 && momentXError < 0.05 && momentZError < 0.05,
    contactOk: liftedCount === 0 && minLoad > 0.01,
    cgBody: { x: xCG, y: hCG, z: zCG },
    contactPoints: wheels.map((wheel) => ({ x: wheel.x, y: 0, z: wheel.z })),
    wheelCenters: wheels.map((wheel) => ({ x: wheel.x, y: dims.R, z: wheel.z }))
  };
}

/** Level-road reference with the current setup, independent of current tilt. */
function computeLevelReference(source = state) {
  return computeStatic(Object.assign({}, source, { slope: 0, bank: 0 }));
}

function formatInt(value) {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function formatFixed(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toFixed(digits);
}

function formatSigned(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  const fixed = Number(value).toFixed(digits);
  return (value > 0 ? '+' : '') + fixed;
}

function formatLoadValue(newtons, units = state.units) {
  if (!Number.isFinite(newtons)) return '—';
  if (units === 'kg') return formatFixed(newtons / GRAVITY, 1);
  return formatInt(newtons);
}

function loadUnitLabel(units = state.units) {
  return units === 'kg' ? 'kg' : 'N';
}

function massEquivalentKg(newtons) {
  return newtons / GRAVITY;
}

function frictionUtilization(model) {
  const capacity = Math.max(1e-9, model.frictionCapacity);
  return model.frictionDemand / capacity;
}

function runSelfTests(source = state) {
  const tests = [];
  const record = (name, ok, detail) => tests.push({ name, ok, detail });
  const level = computeStatic(Object.assign({}, source, { slope: 0, bank: 0 }));
  const slope = computeStatic(Object.assign({}, source, { slope: 7, bank: 0 }));
  const bank = computeStatic(Object.assign({}, source, { slope: 0, bank: 7 }));

  const levelSum = level.loads.reduce((a, v) => a + v, 0);
  record('水平总法向力 = mg', Math.abs(levelSum - level.totalWeight) < 0.05, `${formatInt(levelSum)} N`);

  const frontRatio = level.frontLoad / level.totalWeight * 100;
  record('水平前轴荷比 = 质心设定', Math.abs(frontRatio - source.frontWeightPct) < 0.005, `${frontRatio.toFixed(2)} %`);

  const lateralSource = Object.assign({}, source, { slope: 0, bank: 0, cgLateral: 0.06 });
  const lateral = computeStatic(lateralSource);
  const lateralMoment = lateral.loads.reduce((acc, value, i) => acc + value * lateral.wheels[i].z, 0);
  const lateralExpected = lateral.totalWeight * 0.06;
  record(
    '水平横向载荷跟随质心',
    Math.abs(lateralMoment - lateralExpected) < 0.05 && lateral.rightLoad > lateral.leftLoad,
    `横向矩 ${lateralMoment.toFixed(2)} N·m`
  );

  record('倾斜总法向力 = mg cosβ', Math.abs(slope.sumLoads - slope.totalNormal) < 0.05, `${formatInt(slope.totalNormal)} N`);
  record('倾斜力矩平衡', slope.momentXError < 0.05 && slope.momentZError < 0.05, `${slope.momentXError.toExponential(1)} N·m`);

  const slopeRearGain = slope.rearLoad - level.rearLoad;
  record('上坡时载荷后移', slopeRearGain > 0.1, `后轴 +${formatInt(slopeRearGain)} N`);

  const bankRightGain = bank.rightLoad - level.rightLoad;
  record('右倾时载荷右移', bankRightGain > 0.1, `右轮 +${formatInt(bankRightGain)} N`);

  const doubled = computeStatic(Object.assign({}, source, { slope: 0, bank: 0, mass: source.mass * 2 }));
  const massDelta = Math.max(...doubled.loads.map((value, i) => Math.abs(value - level.loads[i] * 2)));
  record('质量缩放保持载荷比例', massDelta < 1e-6, `Δmax ${massDelta.toExponential(1)} N`);

  const levelFullArb = computeStatic(Object.assign({}, source, {
    slope: 0,
    bank: 0,
    arbFront: 100,
    arbRear: 100
  }));
  const arbLevelDelta = Math.max(...levelFullArb.loads.map((value, i) => Math.abs(value - level.loads[i])));
  record('水平路面防倾杆无预载', arbLevelDelta < 1e-6, `Δmax ${arbLevelDelta.toExponential(1)} N`);

  const bankNoArb = computeStatic(Object.assign({}, source, {
    slope: 0,
    bank: 7,
    arbFront: 0,
    arbRear: 0
  }));
  const bankFullArb = computeStatic(Object.assign({}, source, {
    slope: 0,
    bank: 7,
    arbFront: 100,
    arbRear: 100
  }));
  const rollDrop = Math.abs(bankNoArb.poseDeg.roll) - Math.abs(bankFullArb.poseDeg.roll);
  record(
    '防倾杆降低侧倾角',
    rollDrop > 1e-4 && bankFullArb.momentZError < 0.05,
    `${formatSigned(bankNoArb.poseDeg.roll, 3)}° → ${formatSigned(bankFullArb.poseDeg.roll, 3)}°`
  );

  const frontOnly = computeStatic(Object.assign({}, source, { slope: 0, bank: 7, arbFront: 100, arbRear: 0 }));
  const rearOnly = computeStatic(Object.assign({}, source, { slope: 0, bank: 7, arbFront: 0, arbRear: 100 }));
  const frontOnlyFront = frontOnly.loads[1] - frontOnly.loads[0];
  const frontOnlyRear = frontOnly.loads[3] - frontOnly.loads[2];
  const rearOnlyFront = rearOnly.loads[1] - rearOnly.loads[0];
  const rearOnlyRear = rearOnly.loads[3] - rearOnly.loads[2];
  const arbMomentOk = Math.abs(frontOnly.normalMomentZ - frontOnly.totalNormal * frontOnly.pz) < 0.05 &&
    Math.abs(rearOnly.normalMomentZ - rearOnly.totalNormal * rearOnly.pz) < 0.05;
  record(
    '防倾杆前后分配侧倾载荷转移',
    frontOnlyFront > rearOnlyFront + 5 && frontOnlyRear < rearOnlyRear - 5 && arbMomentOk,
    `前 ${formatFixed(frontOnlyFront, 0)} → ${formatFixed(rearOnlyFront, 0)} N`
  );

  const lowMu = computeStatic(Object.assign({}, source, { slope: 10, bank: 10, friction: 0.2 }));
  record(
    '低附着工况触发附着警告',
    lowMu.frictionOk === false && lowMu.frictionDemand > 0.2,
    `μreq ${lowMu.frictionDemand.toFixed(3)} / 0.20`
  );

  const lift = computeStatic(Object.assign({}, source, {
    slope: 35,
    bank: 35,
    cgHeight: 0.9,
    cgLateral: 0.3,
    trackFront: 1.2,
    trackRear: 1.2
  }));
  record(
    '超包线输入触发负载荷保护',
    lift.liftedCount > 0 && lift.rawLoads.some((value) => value < 0) && lift.loads.every((value) => value >= 0) && lift.contactOk === false,
    `${lift.liftedCount} 轮卸载 · raw min ${formatFixed(lift.minRawLoad, 0)} N`
  );

  const contact = level.contactOk && slope.contactOk && bank.contactOk;
  record('常规工况四轮保持接地', contact, contact ? '4 / 4' : '出现离地');

  return tests;
}
