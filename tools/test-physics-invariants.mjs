import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(ROOT, name), 'utf8');

const threeModule = { exports: {} };
new Function('module', 'exports', 'globalThis', read('vendor/three.min.js') + '\n;')
  .call(threeModule.exports, threeModule, threeModule.exports, globalThis);
const THREE = threeModule.exports;

const factory = new Function('THREE', 'localStorage',
  read('src/js/00-core.js') + '\n' + read('src/js/03-suspension.js') + '\n' + read('src/js/05-body-dynamics.js') + '\nreturn {' +
  ' DEFAULTS, computeStatic, simCreate, simStep, simRunFor, simBuildModel, simApplyImpulse, simEvaluate,' +
  ' simReferencePoint, simQuatRotate, suspSolveCorner, suspSolveRaw, suspRockerAngle, suspRockerAngleNewton,' +
  ' suspRockerPoint, suspCoilLength, suspDesign, suspEval, suspEvalReset, suspEvalCount, suspensionBuild,' +
  ' SIM_DT, simEulerFromQuat' +
  '};');
const api = factory(THREE, { getItem: () => null, setItem: () => {} });

const args = process.argv.slice(2);
let group = 'all';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--group') group = args[i + 1] || 'all';
  else if (args[i].startsWith('--group=')) group = args[i].slice('--group='.length);
}
const runGroup = (name) => group === 'all' || group === name;

let checks = 0;
let failures = 0;
function check(id, ok, detail = '') {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error('  FAIL ' + id + (detail ? '  [' + detail + ']' : ''));
}
function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function make(patch) {
  return Object.assign({}, api.DEFAULTS, patch);
}
function cgOf(sim) {
  const state = sim.state;
  return [state.x, state.y, state.z];
}
function refOf(sim) {
  const p = api.simReferencePoint(sim);
  return [p.x, p.y, p.z];
}

/* group cg: free rigid body, no external force */
if (runGroup('cg')) {
  const axes = [['x', 'wx'], ['y', 'wy'], ['z', 'wz']];
  for (const [axis, omegaKey] of axes) {
    const sim = api.simCreate(api.DEFAULTS, { settle: 0 });
    const reference = sim.reference;
    reference.frame.gravityLocal.set(0, 0, 0);
    reference.baseLoads = [0, 0, 0, 0];
    reference.springRates = [0, 0, 0, 0];
    reference.damperRateWheel = [0, 0, 0, 0];
    reference.arbRate = { front: 0, rear: 0 };
    reference.suspension = null;
    const state = sim.state;
    state.x = 0; state.y = 0; state.z = 0;
    state.vx = 0; state.vy = 0; state.vz = 0;
    state.qw = 1; state.qx = 0; state.qy = 0; state.qz = 0;
    state.wx = 0; state.wy = 0; state.wz = 0;
    state[omegaKey] = 1;
    const cb = [reference.cgBody.x, reference.cgBody.y, reference.cgBody.z];
    const cg0 = cgOf(sim);
    const ref0 = refOf(sim);
    for (let i = 0; i < 500; i += 1) api.simStep(sim);
    const cg1 = cgOf(sim);
    const ref1 = refOf(sim);
    const drift = Math.hypot(cg1[0] - cg0[0], cg1[1] - cg0[1], cg1[2] - cg0[2]);
    const refDisp = Math.hypot(ref1[0] - ref0[0], ref1[1] - ref0[1], ref1[2] - ref0[2]);
    const perp = axis === 'x' ? Math.hypot(cb[1], cb[2]) : axis === 'y' ? Math.hypot(cb[0], cb[2]) : Math.hypot(cb[0], cb[1]);
    const expected = 2 * perp * Math.sin(0.5);
    check('cg/' + axis + '-drift', drift < 1e-9, (drift * 1000).toFixed(4) + ' mm');
    check('cg/' + axis + '-ref-path', Math.abs(refDisp - expected) < 1e-4, (refDisp * 1000).toFixed(3) + ' / ' + (expected * 1000).toFixed(3) + ' mm');
    check('cg/' + axis + '-omega', Math.abs(sim.state[omegaKey] - 1) < 1e-12);
    const q = [sim.state.qw, sim.state.qx, sim.state.qy, sim.state.qz];
    check('cg/' + axis + '-qnorm', Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) < 1e-12);
  }
}

/* group rocker: closed form vs legacy Newton, reachability */
if (runGroup('rocker')) {
  const reference = api.computeStatic(api.DEFAULTS);
  const corners = reference.suspension.corners;
  const quat = new THREE.Quaternion();
  let maxAngleDiff = 0;
  let maxResidual = 0;
  for (const mm of [-25, -15, 0, 15, 25]) {
    for (const corner of corners) {
      const solved = api.suspSolveCorner(corner, { x: 0, y: -mm / 1000, z: 0 }, quat, 0, null, true);
      const legacy = api.suspRockerAngleNewton(corner, solved.pushPoint, corner.rocker.baseAngle);
      maxAngleDiff = Math.max(maxAngleDiff, Math.abs(solved.rocker.angle - legacy));
      maxResidual = Math.max(maxResidual, solved.rocker.residual);
    }
  }
  check('rocker/closed-form-vs-newton', maxAngleDiff < 1e-9, maxAngleDiff.toExponential(2));
  check('rocker/closure-residual', maxResidual < 1e-12, maxResidual.toExponential(2));
  const random = mulberry32(20261119);
  let randomBad = 0;
  for (let i = 0; i < 1000; i += 1) {
    const pitch = (random() * 2 - 1) * 10 * Math.PI / 180;
    const roll = (random() * 2 - 1) * 10 * Math.PI / 180;
    const travel = (random() * 2 - 1) * 0.025;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, 0, pitch));
    const corner = corners[i % 4];
    const solved = api.suspSolveCorner(corner, { x: 0, y: travel, z: 0 }, q, 0, null, true);
    if (!Number.isFinite(solved.rocker.angle) || !Number.isFinite(solved.rocker.residual)) randomBad += 1;
    if (solved.rocker.feasible && solved.rocker.residual > 1e-9) randomBad += 1;
    if (!solved.rocker.feasible && !(solved.rocker.residual > 0)) randomBad += 1;
  }
  check('rocker/random-1000', randomBad === 0, String(randomBad));
}

/* group corner: converged vs ok split under the 4.1 setup */
if (runGroup('corner')) {
  const setup = make({ mass: 600, wheelRateF: 50, wheelRateR: 50, dampingF: 0.05, dampingR: 0.05, arbFront: 0, arbRear: 0 });
  const sim = api.simCreate(setup, { settle: 1.5 });
  api.simApplyImpulse(sim, 'pitch');
  let convergedButNotOk = 0;
  let okCount = 0;
  let badResidualWhenOk = 0;
  for (let step = 0; step < 400; step += 1) {
    api.simStep(sim);
    const model = api.simBuildModel(sim);
    for (const row of model.solved) {
      if (!row) continue;
      if (row.converged && !row.ok) convergedButNotOk += 1;
      if (row.ok) {
        okCount += 1;
        if (row.rocker.residual > 1e-4) badResidualWhenOk += 1;
      }
    }
  }
  check('corner/converged-without-ok', convergedButNotOk > 0, String(convergedButNotOk));
  check('corner/ok-present', okCount > 0, String(okCount));
  check('corner/ok-residual', badResidualWhenOk === 0, String(badResidualWhenOk));
  const level = api.simCreate(api.DEFAULTS, { settle: 2.5 });
  const levelModel = api.simBuildModel(level);
  check('corner/level-solver-ok', levelModel.solverOk === true);
}

/* group seed: external corner.angle writes must not change physics */
if (runGroup('seed')) {
  const setup = make({ mass: 600, wheelRateF: 50, wheelRateR: 50, dampingF: 0.05, dampingR: 0.05, arbFront: 0, arbRear: 0 });
  const run = (offset) => {
    const sim = api.simCreate(setup, { settle: 1.2 });
    api.simApplyImpulse(sim, 'pitch');
    for (let step = 0; step < 300; step += 1) {
      for (const corner of sim.reference.suspension.corners) corner.angle = corner.rocker.baseAngle + offset;
      api.simStep(sim);
    }
    return sim;
  };
  const a = run(0);
  const b = run(1.2);
  const keys = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'qw', 'qx', 'qy', 'qz', 'wx', 'wy', 'wz'];
  let maxDelta = 0;
  for (const key of keys) maxDelta = Math.max(maxDelta, Math.abs(a.state[key] - b.state[key]));
  maxDelta = Math.max(maxDelta, Math.abs(a.time - b.time));
  const flagsEqual = ['holding', 'sliding', 'finite', 'boundary', 'recovered'].every((key) => a.flags[key] === b.flags[key]);
  check('seed/angle-independence', maxDelta <= 1e-12, maxDelta.toExponential(2));
  check('seed/flags-identical', flagsEqual);
}

/* group ratio: analytic vs numeric, continuity, suspEval budget */
if (runGroup('ratio')) {
  const reference = api.computeStatic(api.DEFAULTS);
  const corners = reference.suspension.corners;
  const quat = new THREE.Quaternion();
  let maxRel = 0;
  for (const mm of [-25, -15, 0, 15, 25]) {
    for (const corner of corners) {
      const solved = api.suspSolveCorner(corner, { x: 0, y: -mm / 1000, z: 0 }, quat, 0, null, true);
      const eps = 1e-4;
      const high = api.suspSolveCorner(corner, { x: 0, y: -mm / 1000 + eps, z: 0 }, quat, 0, solved.seed, true);
      const low = api.suspSolveCorner(corner, { x: 0, y: -mm / 1000 - eps, z: 0 }, quat, 0, solved.seed, true);
      const numeric = (high.coilLength - low.coilLength) / (2 * eps);
      if (Math.abs(numeric) > 1e-9 && solved.motionRatio != null) {
        maxRel = Math.max(maxRel, Math.abs(solved.motionRatio - numeric) / Math.abs(numeric));
      }
    }
  }
  // ±25 mm extreme travel is the worst case; the default travel band is < 1e-3.
  check('ratio/analytic-vs-numeric', maxRel < 2e-3, maxRel.toExponential(2));

  const sim = api.simCreate(api.DEFAULTS, { settle: 1.5 });
  api.simApplyImpulse(sim, 'pitch');
  let signFlip = 0;
  let maxEval = 0;
  let previous = null;
  for (let step = 0; step < 500; step += 1) {
    api.suspEvalReset();
    api.simStep(sim);
    maxEval = Math.max(maxEval, api.suspEvalCount());
    const model = api.simBuildModel(sim);
    for (const row of model.solved) {
      if (!row || row.motionRatioState !== 'ok') continue;
      if (row.motionRatio <= 0) signFlip += 1;
      if (previous != null && Math.sign(row.motionRatio) !== Math.sign(previous)) signFlip += 1;
      previous = row.motionRatio;
    }
  }
  check('ratio/no-sign-flip', signFlip === 0, String(signFlip));
  check('ratio/suspEval-budget', maxEval <= 30, String(maxEval));
}

/* group shadow: reference.source must be mandatory */
if (runGroup('shadow')) {
  const sim = api.simCreate(make({ friction: 0.2 }));
  const withSource = api.simEvaluate(sim);
  const capacity = withSource.capacity;
  delete sim.reference.source;
  let threw = false;
  let message = '';
  try {
    api.simEvaluate(sim);
  } catch (error) {
    threw = true;
    message = error && error.message ? error.message : String(error);
  }
  check('shadow/throws', threw);
  check('shadow/message', /reference\.source/.test(message), message);
  check('shadow/capacity-source', Number.isFinite(capacity) && capacity > 0);
}

if (failures > 0) {
  console.error('FAIL  ' + (checks - failures) + '/' + checks + ' checks');
  process.exitCode = 1;
} else {
  console.log('PASS  ' + checks + '/' + checks + ' checks');
}
