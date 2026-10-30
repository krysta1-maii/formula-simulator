/* =========================================================================
   FS-01 · Stage 02 dynamic chassis
   00-core.js — constants, state schema, road frame and static load solver
   ========================================================================= */

const GRAVITY = 9.80665;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const STORAGE_KEY = 'fs01.dynamic.setup.v1';
const APP_VERSION = '0.2.0';

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
  motionRatioF: [0.3, 0.9],
  motionRatioR: [0.3, 0.9],
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
  motionRatioF: 0.58,
  motionRatioR: 0.62,
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
  const heave = solved[0];
  const pitch = solved[1];
  const roll = solved[2];

  const cornerY = wheels.map((wheel) => heave + wheel.x * pitch - wheel.z * roll);
  // A positive roll lowers the right side, so the right-hand bar arm is twisted
  // in the bump direction and the bar pushes that wheel down (increasing its
  // normal load); the left side receives the equal-and-opposite force.
  const arbForce = wheels.map((wheel) => {
    const rate = wheel.axle === 'front' ? arbRate.front : arbRate.rear;
    const track = wheel.axle === 'front' ? dims.tf : dims.tr;
    return wheel.zSign * rate * track * roll;
  });
  const arbMoment = arbForce.reduce((acc, value, i) => acc + value * wheels[i].z, 0);
  const rawLoads = cornerY.map((y, i) => baseLoads[i] - k[i] * y + arbForce[i]);
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

  // Stage-02 dynamic reference. The wheel rate remains the primary spring
  // parameter; the motion ratio maps it to the coil spring and to the damper
  // shaft. Damping is specified as a fraction of critical damping at the wheel,
  // which keeps the transient response readable when mass or wheel rate moves.
  const motionRatio = {
    front: clamp(Number.isFinite(source.motionRatioF) ? source.motionRatioF : DEFAULTS.motionRatioF, 0.3, 0.9),
    rear: clamp(Number.isFinite(source.motionRatioR) ? source.motionRatioR : DEFAULTS.motionRatioR, 0.3, 0.9)
  };
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
  const springRateCoil = k.map((ki, i) => ki / Math.pow(wheels[i].axle === 'front' ? motionRatio.front : motionRatio.rear, 2));
  const damperRateShaft = damperRateWheel.map((ci, i) => ci / Math.pow(wheels[i].axle === 'front' ? motionRatio.front : motionRatio.rear, 2));
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
