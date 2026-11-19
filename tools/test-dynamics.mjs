import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), 'utf8');

const threeModule = { exports: {} };
new Function('module', 'exports', 'globalThis', read('vendor/three.min.js') + '\n;')
  .call(threeModule.exports, threeModule, threeModule.exports, globalThis);
const THREE = threeModule.exports;

const factory = new Function('THREE', 'localStorage',
  read('src/js/00-core.js') + '\n' + read('src/js/03-suspension.js') + '\n' + read('src/js/05-body-dynamics.js') + '\nreturn {' +
  ' computeStatic, computeBodyInertia, runSelfTests, DEFAULTS, NUM_LIMITS, GRAVITY,' +
  ' simCreate, simReset, simStep, simRunFor, simAdvance, simBuildModel, simApplyImpulse,' +
  ' simEvaluate, runDynamicSelfTests, SIM_DT, simQuatFromEuler, simQuatRotate, simEulerFromQuat,' +
  ' suspSolveCorner, suspensionBuild, suspRackForSteer, suspWheelSteer, simReferencePoint,' +
  ' simRetargetReference, simApplyForceAt, suspRockerPoint, suspEvalReset, suspEvalCount' +
  '};');
const api = factory(THREE, { getItem: () => null, setItem: () => {} });
const {
  computeStatic,
  runSelfTests,
  DEFAULTS,
  NUM_LIMITS,
  GRAVITY,
  simCreate,
  simReset,
  simStep,
  simRunFor,
  simAdvance,
  simBuildModel,
  simApplyImpulse,
  runDynamicSelfTests,
  SIM_DT,
  suspSolveCorner,
  suspensionBuild,
  suspRackForSteer,
  suspWheelSteer,
  simReferencePoint,
  simEvaluate,
  simQuatFromEuler,
  simQuatRotate,
  simRetargetReference,
  simApplyForceAt,
  suspRockerPoint,
  suspEvalReset,
  suspEvalCount
} = api;

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : ''));
    return;
  }
  failures += 1;
  console.error('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function make(patch) {
  return Object.assign({}, DEFAULTS, patch);
}
function maxAbs(values) {
  return Math.max(...values.map((value) => Math.abs(value)));
}
function loadError(model, reference) {
  return Math.max(...model.loads.map((value, index) => Math.abs(value - reference.loads[index])));
}
function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomBetween(random, lo, hi) {
  return lo + random() * (hi - lo);
}

console.log('FS-01 stage-02 dynamics verification');

console.log('\n[1] derived setup reference');
const reference = computeStatic(DEFAULTS);
check('inertia is finite and positive', finite(reference.inertia.Ixx) && reference.inertia.Ixx > 0 && reference.inertia.Iyy > 0 && reference.inertia.Izz > 0, JSON.stringify(reference.inertia));
check('natural frequencies are finite and positive', finite(reference.frequencies.heave) && reference.frequencies.heave > 0 && reference.frequencies.roll > 0 && reference.frequencies.pitch > 0, Object.values(reference.frequencies).map((value) => value.toFixed(2)).join(' / ') + ' Hz');
check('wheel damping is positive', reference.damperRateWheel.every((value) => finite(value) && value > 0));
check(
  'motion ratios follow the horizontal-spring design',
  reference.motionRatio.front > 1.20 && reference.motionRatio.front < 1.35 &&
    reference.motionRatio.rear > 0.95 && reference.motionRatio.rear < 1.10,
  reference.motionRatio.front.toFixed(4) + ' / ' + reference.motionRatio.rear.toFixed(4)
);
check('coil rate follows wheel rate / i^2', reference.springRateCoil.every((value, index) => Math.abs(value - reference.springRates[index] / Math.pow(reference.suspension.design[index].motionRatio, 2)) < 1e-6));
check(
  'coil rates recompute to the horizontal-spring targets',
  reference.springRateCoil.every((value, index) => Math.abs(value / 1000 - (index < 2 ? 87 : 158)) < 1),
  reference.springRateCoil.map((value) => (value / 1000).toFixed(2)).join(' / ') + ' N/mm'
);

console.log('\n[1b] mechanism kinematics');
const mechanism = reference.suspension.corners;
const designRows = reference.suspension.design;
const travelSamples = [-25, -15, 0, 15, 25];
let closureMax = 0;
let contactMax = 0;
const solvedRows = travelSamples.map((mm) => {
  const solved = mechanism.map((corner) => suspSolveCorner(
    corner,
    { x: 0, y: -mm / 1000, z: 0 },
    new THREE.Quaternion(),
    0,
    null,
    true
  ));
  closureMax = Math.max(closureMax, ...solved.map((row) => row.error));
  contactMax = Math.max(contactMax, ...solved.map((row) => Math.abs(row.contact.y - mm / 1000)));
  return solved;
});
check('four corner mechanisms close over ±25 mm travel', closureMax < 1e-6, (closureMax * 1000).toExponential(2) + ' mm');
check('tire contact stays on the road plane', contactMax < 1e-6, contactMax.toExponential(2) + ' m');
check(
  'bump shortens every coil and droop extends it',
  designRows.every((row, i) => solvedRows[3][i].coilLength < row.length0 - 1e-4 && solvedRows[1][i].coilLength > row.length0 + 1e-4),
  designRows.map((row, i) => ((solvedRows[3][i].coilLength - row.length0) * 1000).toFixed(2)).join(' / ') + ' mm'
);
check(
  'measured motion ratios stay inside the 0.2-2.5 guard',
  solvedRows.every((row) => row.every((corner) => corner.motionRatio != null && corner.motionRatio > 0.2 && corner.motionRatio < 2.5)),
  reference.motionRatio.front.toFixed(3) + ' / ' + reference.motionRatio.rear.toFixed(3)
);
check(
  'every ±25 mm mechanism solution is healthy above a ratio of 1',
  solvedRows.every((row) => row.every((corner) => corner.ok && corner.frame.converged && corner.rocker.feasible)),
  solvedRows.map((row) => row.map((corner) => corner.motionRatioState).join('/')).join(' · ')
);
// Low bump steer: the steering arm height is chosen so ±25 mm of wheel travel
// changes the wheel angle only marginally.
let frontBumpSteer = 0;
let rearBumpSteer = 0;
const bumpQuat = new THREE.Quaternion();
for (const corner of mechanism) {
  const base = suspSolveCorner(corner, { x: 0, y: 0, z: 0 }, bumpQuat, 0, null, false);
  for (const mm of [-25, 25]) {
    const moved = suspSolveCorner(corner, { x: 0, y: -mm / 1000, z: 0 }, bumpQuat, 0, base.seed, false);
    const delta = Math.abs(suspWheelSteer(moved.wheelQuat) - suspWheelSteer(base.wheelQuat)) * 180 / Math.PI;
    if (corner.front) frontBumpSteer = Math.max(frontBumpSteer, delta);
    else rearBumpSteer = Math.max(rearBumpSteer, delta);
  }
}
check(
  '±25 mm bump steer stays small',
  frontBumpSteer < 0.15 && rearBumpSteer < 0.06,
  '前 ' + frontBumpSteer.toFixed(4) + '° / 后 ' + rearBumpSteer.toFixed(4) + '°'
);

// Rack calibration: ±18° is about 32 mm of travel with this steering geometry.
const rackQuat = new THREE.Quaternion();
const rackOrigin = { x: 0, y: 0, z: 0 };
const rackTargets = [-18, -12, 0, 12, 18];
let rackWorstError = 0;
const rackShifts = [];
for (const deg of rackTargets) {
  const target = deg * Math.PI / 180;
  const shift = suspRackForSteer(mechanism, rackOrigin, rackQuat, target);
  const solved = mechanism.filter((corner) => corner.front).map((corner) =>
    suspSolveCorner(corner, rackOrigin, rackQuat, shift, null, false));
  const mean = solved.reduce((acc, row) => acc + suspWheelSteer(row.wheelQuat), 0) / solved.length;
  rackWorstError = Math.max(rackWorstError, Math.abs(mean - target) * 180 / Math.PI);
  rackShifts.push(shift);
}
check(
  'rack calibration reaches ±18° with a mean error below 1e-4°',
  rackWorstError < 1e-4,
  'worst ' + rackWorstError.toExponential(2) + '° at ' + rackShifts.map((value, index) => rackTargets[index] + '°=' + (value * 1000).toFixed(2) + 'mm').join(' / ')
);
check(
  'rack calibration returns a monotonic shift over the target range',
  rackShifts.every((value, index) => index === 0 || value > rackShifts[index - 1]),
  rackShifts.map((value) => (value * 1000).toFixed(2)).join(' / ') + ' mm'
);
check(
  'rack calibration does not write corner.rackSeed',
  mechanism.every((corner) => corner.rackSeed === undefined),
  mechanism.map((corner) => corner.rackSeed === undefined ? 'clean' : 'seeded').join(' / ')
);
const rackSteer18 = 18 * Math.PI / 180;
const rackShiftA = suspRackForSteer(mechanism, rackOrigin, rackQuat, rackSteer18);
for (const corner of mechanism) corner.rackSeed = { thL: 0.4, thU: -0.3, spin: 0.2 };
const rackShiftB = suspRackForSteer(mechanism, rackOrigin, rackQuat, rackSteer18);
const rackShiftC = suspRackForSteer(mechanism, rackOrigin, rackQuat, -rackSteer18);
for (const corner of mechanism) delete corner.rackSeed;
check(
  'rack calibration is repeatable and independent of stale seeds',
  rackShiftA === rackShiftB && Math.abs(rackShiftC + rackShiftA) < 1e-9,
  (rackShiftA * 1000).toFixed(6) + ' / ' + (rackShiftB * 1000).toFixed(6) + ' mm · -18° ' + (rackShiftC * 1000).toFixed(6) + ' mm'
);
const strokeSim = simCreate(DEFAULTS, { settle: 1.5 });
simApplyImpulse(strokeSim, 'heave');
simRunFor(strokeSim, 0.06);
const strokeModel = simBuildModel(strokeSim);
check(
  'telemetry compression equals the solved coil stroke',
  strokeModel.springCompressionMm.every((value, i) =>
    Math.abs(value - (designRows[i].length0 - strokeModel.solved[i].coilLength) * 1000) < 1e-6),
  strokeModel.springCompressionMm.map((value) => value.toFixed(2)).join(' / ') + ' mm'
);
check(
  'solved wheel poses remain on the plane',
  strokeModel.solved.every((row) => Math.abs(row.contact[1]) < 1e-6),
  strokeModel.solved.map((row) => row.contact[1].toExponential(1)).join(' / ')
);
const strokeEval = simEvaluate(strokeSim);
check(
  'telemetry coil length equals the force-chain length',
  strokeModel.solved.every((row, i) =>
    row && row.coilLength === strokeEval.corners[i].coilLength &&
    row.coilSource === strokeEval.corners[i].coilSource),
  strokeModel.solved.map((row) => row.coilSource).join(' / ')
);
check(
  'healthy telemetry reports the mechanism as the coil source',
  strokeModel.solved.every((row) => row && row.coilSource === 'mechanism'),
  strokeModel.solved.map((row) => row.coilSource).join(' / ')
);
check('static self-tests still pass', runSelfTests(DEFAULTS).every((test) => test.ok));

console.log('\n[2] level dynamic equilibrium');
const levelSim = simCreate(DEFAULTS, { settle: 2.5 });
const levelModel = simBuildModel(levelSim);
const levelError = loadError(levelModel, reference);
// B2-3: the unified contact patch carries the camber/toe offset of the solved
// mechanism, so the level equilibrium shifts by ~0.01 N and ~1e-6 deg.
check('level loads match the static reference', levelError < 0.05, levelError.toExponential(2) + ' N');
check('level attitude is exactly level', Math.abs(levelModel.poseDeg.pitch) < 1e-4 && Math.abs(levelModel.poseDeg.roll) < 1e-4);
check('level corner loads are the design loads', levelModel.loads.every((value, index) => Math.abs(value - reference.baseLoads[index]) < 0.01));
check('level total normal = mg', Math.abs(levelModel.sumLoads - DEFAULTS.mass * GRAVITY) < 0.01, levelModel.sumLoads.toFixed(3) + ' N');
check('level body is held by static friction', levelSim.flags.holding === true && levelModel.sim.holding === true);
check('level contact is maintained', levelModel.contactOk && levelModel.liftedCount === 0);

console.log('\n[3] tilted-plane convergence');
for (const patch of [{ slope: 8, bank: 0 }, { slope: 0, bank: 7 }, { slope: 6, bank: 5 }, { slope: -10, bank: -10 }]) {
  const source = make(patch);
  const target = computeStatic(source);
  const sim = simCreate(source, { settle: 4 });
  const model = simBuildModel(sim);
  const label = 'slope ' + (patch.slope || 0) + ' bank ' + (patch.bank || 0);
  check(label + ': dynamic loads converge to the static solution', loadError(model, target) < 1, loadError(model, target).toFixed(3) + ' N');
  check(label + ': total normal = mg cos(beta)', Math.abs(model.sumLoads - target.totalNormal) < 0.5, model.sumLoads.toFixed(2) + ' / ' + target.totalNormal.toFixed(2) + ' N');
  check(label + ': loads are non-negative and finite', model.loads.every((value) => finite(value) && value >= 0));
  check(label + ': vehicle remains grounded', model.contactOk);
}

console.log('\n[4] anti-roll bar dynamics');
const heaveSim = simCreate(DEFAULTS, { settle: 1.5 });
simApplyImpulse(heaveSim, 'heave');
let maxArbHeave = 0;
for (let i = 0; i < 300; i += 1) {
  simStep(heaveSim);
  const model = simBuildModel(heaveSim);
  maxArbHeave = Math.max(maxArbHeave, maxAbs(model.arbForce));
}
check('symmetric heave produces no anti-roll force', maxArbHeave < 1e-3, maxArbHeave.toExponential(2) + ' N');

const rollSoft = simCreate(make({ arbFront: 0, arbRear: 0 }), { settle: 1.2 });
const rollHard = simCreate(make({ arbFront: 100, arbRear: 100 }), { settle: 1.2 });
simApplyImpulse(rollSoft, 'roll');
simApplyImpulse(rollHard, 'roll');
let softPeak = 0;
let hardPeak = 0;
for (let i = 0; i < 450; i += 1) {
  simStep(rollSoft);
  simStep(rollHard);
  const softQ = [rollSoft.state.qw, rollSoft.state.qx, rollSoft.state.qy, rollSoft.state.qz];
  const hardQ = [rollHard.state.qw, rollHard.state.qx, rollHard.state.qy, rollHard.state.qz];
  softPeak = Math.max(softPeak, Math.abs(api.simEulerFromQuat(softQ).roll));
  hardPeak = Math.max(hardPeak, Math.abs(api.simEulerFromQuat(hardQ).roll));
}
check('higher ARB reduces the roll response', hardPeak < softPeak && softPeak > 1e-4, (softPeak * 180 / Math.PI).toFixed(3) + '° -> ' + (hardPeak * 180 / Math.PI).toFixed(3) + '°');

console.log('\n[5] impulse and damping');
const lowDamp = simCreate(make({ dampingF: 0.1, dampingR: 0.1 }), { settle: 1.5 });
const highDamp = simCreate(make({ dampingF: 0.9, dampingR: 0.9 }), { settle: 1.5 });
simApplyImpulse(lowDamp, 'heave');
simApplyImpulse(highDamp, 'heave');
let lowPeak = 0;
let highPeak = 0;
for (let i = 0; i < 600; i += 1) {
  simStep(lowDamp);
  simStep(highDamp);
  lowPeak = Math.max(lowPeak, Math.abs(simReferencePoint(lowDamp).y - lowDamp.reference.heave));
  highPeak = Math.max(highPeak, Math.abs(simReferencePoint(highDamp).y - highDamp.reference.heave));
}
simRunFor(lowDamp, 2.0);
simRunFor(highDamp, 2.0);
const lowTail = Math.abs(simReferencePoint(lowDamp).y - lowDamp.reference.heave);
const highTail = Math.abs(simReferencePoint(highDamp).y - highDamp.reference.heave);
check('heave impulse produces a visible response', lowPeak > 0.005, (lowPeak * 1000).toFixed(2) + ' mm');
check('higher damping leaves a smaller late amplitude', highTail < lowTail, (highTail * 1e6).toFixed(2) + ' vs ' + (lowTail * 1e6).toFixed(2) + ' um');
check('both damped responses remain finite', lowDamp.flags.finite && highDamp.flags.finite);

console.log('\n[6] determinism and fixed step');
const detA = simCreate(DEFAULTS, { settle: 0.4 });
const detB = simCreate(DEFAULTS, { settle: 0.4 });
simApplyImpulse(detA, 'pitch');
simApplyImpulse(detB, 'pitch');
simRunFor(detA, 1.0);
simRunFor(detB, 1.0);
check('identical runs are bit-identical', simReferencePoint(detA).y === simReferencePoint(detB).y && detA.state.qx === detB.state.qx && detA.state.wz === detB.state.wz);
const fixedA = simCreate(DEFAULTS, { settle: 0.4 });
const fixedB = simCreate(DEFAULTS, { settle: 0.4 });
simApplyImpulse(fixedA, 'roll');
simApplyImpulse(fixedB, 'roll');
for (let i = 0; i < 120; i += 1) simAdvance(fixedA, 1 / 60);
for (let i = 0; i < 288; i += 1) simAdvance(fixedB, 1 / 144);
check('60 Hz and 144 Hz frames produce the same simulation time', Math.abs(fixedA.time - fixedB.time) <= SIM_DT + 1e-12, fixedA.time.toFixed(6) + ' / ' + fixedB.time.toFixed(6));
check('60 Hz and 144 Hz frames produce the same body state', Math.abs(simReferencePoint(fixedA).y - simReferencePoint(fixedB).y) < 1e-9 && Math.abs(fixedA.state.qx - fixedB.state.qx) < 1e-9);
check('frame accumulation stays within one fixed step', Math.abs(fixedA.time - 2.4) <= SIM_DT + 1e-12 && Math.abs(fixedB.time - 2.4) <= SIM_DT + 1e-12);

console.log('\n[7] parking friction and sliding');
const parked = simCreate(make({ slope: 8, bank: 0 }), { settle: 2 });
const parkedReference = simReferencePoint(parked);
check('slope within mu is held', parked.flags.holding === true && Math.hypot(parkedReference.x, parkedReference.z) < 1e-6, Math.hypot(parkedReference.x, parkedReference.z).toExponential(2) + ' m');
const slide = simCreate(make({ slope: 10, bank: 10, friction: 0.2 }), { settle: 2 });
const slideDistance = Math.hypot(slide.state.x, slide.state.z);
check('low grip releases the planar degrees of freedom', slide.flags.sliding === true && slideDistance > 0.1, slideDistance.toFixed(3) + ' m');
check('sliding state stays finite', slide.flags.finite === true && finite(slide.state.x) && finite(slide.state.z));
const grip = simCreate(make({ slope: 10, bank: 10, friction: 1.4 }), { settle: 2 });
const gripReference = simReferencePoint(grip);
check('high grip holds the same geometry', grip.flags.holding === true && Math.hypot(gripReference.x, gripReference.z) < 1e-6);

console.log('\n[8] random envelope');
const random = mulberry32(20261031);
let randomFailures = 0;
let minDynamicLoad = Infinity;
for (let i = 0; i < 120; i += 1) {
  const source = make({
    slope: randomBetween(random, NUM_LIMITS.slope[0], NUM_LIMITS.slope[1]),
    bank: randomBetween(random, NUM_LIMITS.bank[0], NUM_LIMITS.bank[1]),
    friction: randomBetween(random, NUM_LIMITS.friction[0], NUM_LIMITS.friction[1]),
    mass: randomBetween(random, NUM_LIMITS.mass[0], NUM_LIMITS.mass[1]),
    frontWeightPct: randomBetween(random, NUM_LIMITS.frontWeightPct[0], NUM_LIMITS.frontWeightPct[1]),
    cgHeight: randomBetween(random, NUM_LIMITS.cgHeight[0], NUM_LIMITS.cgHeight[1]),
    cgLateral: randomBetween(random, NUM_LIMITS.cgLateral[0], NUM_LIMITS.cgLateral[1]),
    wheelbase: randomBetween(random, NUM_LIMITS.wheelbase[0], NUM_LIMITS.wheelbase[1]),
    trackFront: randomBetween(random, NUM_LIMITS.trackFront[0], NUM_LIMITS.trackFront[1]),
    trackRear: randomBetween(random, NUM_LIMITS.trackRear[0], NUM_LIMITS.trackRear[1]),
    wheelRadius: randomBetween(random, NUM_LIMITS.wheelRadius[0], NUM_LIMITS.wheelRadius[1]),
    wheelRateF: randomBetween(random, NUM_LIMITS.wheelRateF[0], NUM_LIMITS.wheelRateF[1]),
    wheelRateR: randomBetween(random, NUM_LIMITS.wheelRateR[0], NUM_LIMITS.wheelRateR[1]),
    dampingF: randomBetween(random, NUM_LIMITS.dampingF[0], NUM_LIMITS.dampingF[1]),
    dampingR: randomBetween(random, NUM_LIMITS.dampingR[0], NUM_LIMITS.dampingR[1]),
    arbFront: randomBetween(random, NUM_LIMITS.arbFront[0], NUM_LIMITS.arbFront[1]),
    arbRear: randomBetween(random, NUM_LIMITS.arbRear[0], NUM_LIMITS.arbRear[1])
  });
  const sim = simCreate(source, { settle: 0.5 });
  const impulse = ['heave', 'roll', 'pitch'][i % 3];
  simApplyImpulse(sim, impulse);
  simRunFor(sim, 0.6);
  const model = simBuildModel(sim);
  minDynamicLoad = Math.min(minDynamicLoad, model.minLoad);
  if (!model.loads.every((value) => finite(value) && value >= 0) || !sim.flags.finite ||
      !finite(model.heave) || !finite(model.poseDeg.pitch) || !finite(model.poseDeg.roll)) {
    randomFailures += 1;
  }
}
check('120 random setups stay finite and grounded', randomFailures === 0, randomFailures + ' failures');
check('random dynamic loads remain non-negative', minDynamicLoad >= 0, minDynamicLoad.toFixed(2) + ' N');

console.log('\n[9] built-in dynamic self-tests');
const dynamicTests = runDynamicSelfTests(DEFAULTS);
check('dynamic self-test count is at least 10', dynamicTests.length >= 10, String(dynamicTests.length));
check('all dynamic self-tests pass', dynamicTests.every((test) => test.ok), dynamicTests.filter((test) => !test.ok).map((test) => test.name).join(', '));


console.log('\n[10] contact state machine');
function contactMode(sim) {
  return sim.contact && sim.contact.mode ? sim.contact.mode : 'NONE';
}
{
  const sim = simCreate(make({ slope: 0, bank: 0 }));
  const x0 = sim.state.x;
  const z0 = sim.state.z;
  sim.state.vx = 0.0005;
  simStep(sim);
  const vxOne = sim.state.vx;
  for (let i = 0; i < 3; i += 1) simStep(sim);
  const travel = Math.hypot(sim.state.x - x0, sim.state.z - z0);
  check(
    'low speed holds without creeping',
    Math.abs(vxOne) < 1e-12 && contactMode(sim) === 'HOLD' && travel <= 2e-6,
    'vx ' + vxOne.toExponential(1) + ' · ' + contactMode(sim) + ' · ' + (travel * 1e6).toFixed(2) + ' um'
  );
}
{
  const sim = simCreate(make({ slope: 0, bank: 0 }), { settle: 0.5 });
  const model = simBuildModel(sim);
  check(
    'contact state is observable and mirrors the legacy flags',
    typeof sim.contact.mode === 'string' &&
      (sim.contact.mode === 'HOLD') === sim.flags.holding &&
      (sim.contact.mode === 'SLIP') === sim.flags.sliding &&
      model.sim.mode === sim.contact.mode,
    sim.contact.mode + ' · flags ' + String(sim.flags.holding) + '/' + String(sim.flags.sliding)
  );
}
{
  const sim = simCreate(make({ slope: 0, bank: 0 }));
  const x0 = sim.state.x;
  sim.state.vx = 0.01;
  simStep(sim);
  const dx = sim.state.x - x0;
  check(
    'one step cannot reverse the friction velocity',
    sim.state.vx >= 0 && sim.state.vx < 1e-6 && dx >= 0 && dx < 1e-4,
    'vx ' + sim.state.vx.toExponential(2) + ' · dx ' + (dx * 1000).toFixed(4) + ' mm'
  );
}
{
  const sim = simCreate(make({ slope: 8, friction: 1.4 }));
  const x0 = sim.state.x;
  const z0 = sim.state.z;
  sim.state.vx = 0.0005;
  for (let i = 0; i < 4; i += 1) simStep(sim);
  check(
    'slope perturbation re-parks',
    contactMode(sim) === 'HOLD' && Math.abs(sim.state.vx) < 1e-12 &&
      Math.hypot(sim.state.x - x0, sim.state.z - z0) < 1e-4,
    contactMode(sim) + ' · vx ' + sim.state.vx.toExponential(1)
  );
}
{
  const sim = simCreate(make({ slope: 10, bank: 10, friction: 0.2 }));
  sim.state.vx = 0.4;
  simRunFor(sim, 1.0);
  const before = { x: sim.state.x, z: sim.state.z, vx: sim.state.vx, vz: sim.state.vz, mode: contactMode(sim) };
  simRetargetReference(sim, make({ slope: 0, bank: 0, friction: 0.9 }));
  const preserved = sim.state.x === before.x && sim.state.z === before.z &&
    sim.state.vx === before.vx && sim.state.vz === before.vz &&
    contactMode(sim) === before.mode && sim.cornerSeed.every((seed) => seed === null);
  for (let i = 0; i < 50; i += 1) simStep(sim);
  const parkedQ = [sim.state.qw, sim.state.qx, sim.state.qy, sim.state.qz];
  const parkedYawRoad = simQuatRotate(parkedQ, [sim.state.wx, sim.state.wy, sim.state.wz])[1];
  const parked = contactMode(sim) === 'HOLD' &&
    Math.abs(sim.state.vx) < 1e-12 && Math.abs(sim.state.vz) < 1e-12 && Math.abs(parkedYawRoad) < 1e-12;
  const x1 = sim.state.x;
  const z1 = sim.state.z;
  for (let i = 0; i < 500; i += 1) simStep(sim);
  const drift = Math.hypot(sim.state.x - x1, sim.state.z - z1);
  check(
    'retarget to level re-parks and holds',
    preserved && parked && drift < 1e-9,
    'parked ' + String(parked) + ' · drift ' + drift.toExponential(1) + ' m'
  );
}
{
  const mu = 0.3;
  const cases = [0.99, 1.01].map((ratio) => {
    const deg = Math.atan(ratio * mu) * 180 / Math.PI;
    const sim = simCreate(make({ slope: deg, friction: mu }), { settle: 0.2 });
    const ev = simEvaluate(sim);
    for (let i = 0; i < 2500; i += 1) simStep(sim);
    return { ratio, demandRatio: ev.demand / ev.capacity, mode: contactMode(sim), changes: sim.contact.changes };
  });
  check(
    'capacity boundary does not chatter',
    cases[0].changes === 0 && cases[1].changes <= 2,
    cases.map((item) => item.ratio + ':' + item.mode + '/' + item.changes).join(' · ')
  );
}
{
  const target = 0.8;
  const rates = [10, 12, 30, 60, 144];
  const runs = rates.map((hz) => {
    const sim = simCreate(make({ slope: 0, bank: 0 }));
    sim.state.vx = 0.2;
    sim.state.vz = 0.05;
    let guard = 0;
    while (sim.time + 1e-12 < target && guard < 20000) {
      simAdvance(sim, Math.min(1 / hz, target - sim.time));
      guard += 1;
    }
    while (sim.time + 1e-12 < target) simStep(sim);
    return sim;
  });
  const ref = runs[0];
  const same = runs.every((sim) =>
    sim.time === ref.time &&
    sim.state.x === ref.state.x && sim.state.y === ref.state.y && sim.state.z === ref.state.z &&
    sim.state.vx === ref.state.vx && sim.state.vy === ref.state.vy && sim.state.vz === ref.state.vz &&
    sim.state.qw === ref.state.qw && sim.state.qx === ref.state.qx &&
    sim.state.qy === ref.state.qy && sim.state.qz === ref.state.qz &&
    sim.state.wx === ref.state.wx && sim.state.wy === ref.state.wy && sim.state.wz === ref.state.wz &&
    sim.contact.mode === ref.contact.mode && sim.contact.dwell === ref.contact.dwell &&
    sim.contact.changes === ref.contact.changes && sim.contact.lastChangeStep === ref.contact.lastChangeStep);
  check(
    '10/12/30/60/144 Hz reach the same state and contact sequence',
    same,
    't ' + ref.time.toFixed(6) + ' · steps ' + Math.round(ref.time / SIM_DT) + ' · ' + ref.contact.mode
  );
}
{
  const sim = simCreate(make({ slope: 8, bank: 7 }), { settle: 0.5 });
  const before = JSON.stringify(sim.contact);
  const time0 = sim.time;
  for (let i = 0; i < 100; i += 1) simBuildModel(sim);
  check(
    'telemetry does not advance the contact state',
    JSON.stringify(sim.contact) === before && sim.time === time0,
    sim.contact.mode + ' · changes ' + sim.contact.changes
  );
}
{
  const patches = [{ slope: 8, bank: 7, friction: 0.2 }, { slope: 10, bank: 10, friction: 0.2 }];
  const cases = patches.map((patch) => {
    const sim = simCreate(make(patch));
    sim.state.vx = 0.3;
    sim.state.wy = 0.5;
    const ev = simEvaluate(sim);
    const expected = sim.reference.inertia.Iyy * sim.state.wy +
      (ev.momentParts.normal[1] + ev.momentParts.impulse[1]) * SIM_DT;
    const withFriction = expected + ev.momentParts.friction[1] * SIM_DT;
    return { ev, expected, withFriction };
  });
  const matches = cases.every((item) => Math.abs(item.ev.arrest.yawMoment - item.expected) < 1e-9);
  const excludesFriction = cases.every((item) => Math.abs(item.withFriction - item.expected) > 1e-6);
  check(
    'yaw stopping budget uses only non-friction moments',
    matches && excludesFriction,
    cases.map((item) => item.ev.arrest.yawMoment.toFixed(4) + ' vs ' + item.expected.toFixed(4)).join(' · ')
  );
}

console.log('\n[11] impulse frame');
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function rot3(q, v) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}
const PITCH_FORCE = [0, -6200, 0];
function impulseSample(kind, yawDeg, pitchDeg, rollDeg) {
  const q = simQuatFromEuler(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180, rollDeg * Math.PI / 180);
  const base = simCreate(make({}));
  base.state.qw = q[0];
  base.state.qx = q[1];
  base.state.qy = q[2];
  base.state.qz = q[3];
  const baseEv = simEvaluate(base);
  const imp = simCreate(make({}));
  imp.state.qw = q[0];
  imp.state.qx = q[1];
  imp.state.qy = q[2];
  imp.state.qz = q[3];
  simApplyImpulse(imp, kind);
  const impEv = simEvaluate(imp);
  const road = impEv.moment.map((value, index) => value - baseEv.moment[index]);
  const body = rot3([q[0], -q[1], -q[2], -q[3]], road);
  return { q, road, body };
}
{
  const sample = impulseSample('pitch', 0, 0, 0);
  check(
    'pitch impulse moment at yaw 0 is -6880.45',
    Math.abs(sample.road[0]) < 1e-6 && Math.abs(sample.road[1]) < 1e-6 && Math.abs(sample.road[2] + 6880.45) < 1e-6,
    sample.road.map((value) => value.toFixed(2)).join(' / ')
  );
}
{
  const sample = impulseSample('pitch', 90, 0, 0);
  check(
    'yaw 90 keeps the body moment pure pitch',
    Math.abs(sample.body[0]) < 1e-9 && Math.abs(sample.body[1]) < 1e-9 && Math.abs(sample.body[2] + 6880.45) < 1e-9 &&
      Math.abs(sample.road[0] + 6880.45) < 1e-9,
    sample.body.map((value) => value.toFixed(3)).join(' / ')
  );
}
{
  let worst = 0;
  for (let deg = 0; deg < 360; deg += 15) {
    const sample = impulseSample('pitch', deg, 0, 0);
    worst = Math.max(worst, Math.abs(sample.body[0]), Math.abs(sample.body[1]), Math.abs(sample.body[2] + 6880.45));
  }
  check('24 yaw attitudes keep the body moment', worst <= 1e-9, worst.toExponential(2) + ' N m');
}
{
  const sample = impulseSample('pitch', 0, 10, 10);
  const lever = [
    0.95 - reference.cgBody.x,
    0 - reference.cgBody.y,
    0 - reference.cgBody.z
  ];
  const expected = cross3(rot3(sample.q, lever), PITCH_FORCE);
  const error = maxAbs(sample.road.map((value, index) => value - expected[index]));
  check('composite attitude follows (R x lever) x forceRoad', error <= 1e-9, error.toExponential(2) + ' N m');
}
{
  const heave = impulseSample('heave', 0, 0, 0);
  const roll = impulseSample('roll', 0, 0, 0);
  check(
    'heave acts at CG and roll keeps its own lever',
    maxAbs(heave.road) < 1e-9 &&
      Math.abs(roll.road[0] - 3780) < 1e-6 && Math.abs(roll.road[2] + 670.95) < 1e-6,
    'heave ' + heave.road.map((value) => value.toFixed(2)).join('/') +
      ' · roll ' + roll.road.map((value) => value.toFixed(2)).join('/')
  );
}
{
  const sample = impulseSample('pitch', 30, 0, 0);
  const lever = [
    0.95 - reference.cgBody.x,
    0 - reference.cgBody.y,
    0 - reference.cgBody.z
  ];
  const expected = cross3(rot3(sample.q, lever), PITCH_FORCE);
  const error = maxAbs(sample.road.map((value, index) => value - expected[index]));
  check('impulse difference only contains the impulse term', error <= 1e-9, error.toExponential(2) + ' N m');
}

console.log('\n[12] contact point and moment decomposition');
function poseAt(pitchDeg, rollDeg, patch) {
  const sim = simCreate(make(patch || {}), { settle: 0.8 });
  const q = simQuatFromEuler(0, pitchDeg * Math.PI / 180, rollDeg * Math.PI / 180);
  sim.state.qw = q[0];
  sim.state.qx = q[1];
  sim.state.qy = q[2];
  sim.state.qz = q[3];
  return sim;
}
{
  let maxGap = 0;
  let maxSolved = 0;
  let maxY = 0;
  for (const pitch of [0, 2, 5, 10]) {
    const sim = poseAt(pitch, 0);
    const ev = simEvaluate(sim);
    const model = simBuildModel(sim);
    for (let index = 0; index < 4; index += 1) {
      const contact = ev.corners[index].contact;
      const solved = model.solved[index].contact;
      const point = model.contactPoints[index];
      maxGap = Math.max(maxGap, Math.abs(contact[0] - point.x), Math.abs(contact[2] - point.z));
      maxSolved = Math.max(maxSolved,
        Math.abs(contact[0] - solved[0]), Math.abs(contact[1] - solved[1]), Math.abs(contact[2] - solved[2]));
      maxY = Math.max(maxY, Math.abs(contact[1]), Math.abs(solved[1]));
    }
  }
  check(
    'pitch attitudes share one contact point',
    maxGap <= 1e-9 && maxSolved <= 1e-9 && maxY <= 1e-6,
    'gap ' + (maxGap * 1000).toExponential(1) + ' mm · y ' + maxY.toExponential(1) + ' m'
  );
}
{
  let maxGap = 0;
  for (const roll of [0, 2, 5, 10]) {
    const sim = poseAt(0, roll);
    const ev = simEvaluate(sim);
    const model = simBuildModel(sim);
    for (let index = 0; index < 4; index += 1) {
      const contact = ev.corners[index].contact;
      const point = model.contactPoints[index];
      maxGap = Math.max(maxGap, Math.abs(contact[0] - point.x), Math.abs(contact[2] - point.z));
    }
  }
  check('roll attitudes share one contact point', maxGap <= 1e-9, (maxGap * 1000).toExponential(1) + ' mm');
}
{
  let maxY = 0;
  for (const patch of [{ slope: 8, bank: 7 }, { slope: 10, bank: 10 }, { slope: -10, bank: -10 }]) {
    const sim = simCreate(make(patch), { settle: 0.8 });
    const ev = simEvaluate(sim);
    for (const corner of ev.corners) maxY = Math.max(maxY, Math.abs(corner.contact[1]));
  }
  check('contacts stay on the tilted road plane', maxY <= 1e-6, maxY.toExponential(1) + ' m');
}
{
  const sim = poseAt(5, 0);
  const ev = simEvaluate(sim);
  const model = simBuildModel(sim);
  let error = 0;
  for (let index = 0; index < 4; index += 1) {
    const corner = sim.reference.suspension.corners[index];
    const quat = new THREE.Quaternion(model.bodyQuat[1], model.bodyQuat[2], model.bodyQuat[3], model.bodyQuat[0]);
    const solved = suspSolveCorner(
      corner,
      { x: model.bodyPos.x, y: model.bodyPos.y, z: model.bodyPos.z },
      quat,
      sim.rackShift || 0,
      sim.cornerSeed[index],
      false
    );
    error = Math.max(error,
      Math.abs(solved.contactRoad.x - ev.corners[index].contact[0]),
      Math.abs(solved.contactRoad.y - ev.corners[index].contact[1]),
      Math.abs(solved.contactRoad.z - ev.corners[index].contact[2]));
  }
  check('an independent solve reproduces the contact point', error <= 1e-9, error.toExponential(1) + ' m');
}
{
  let maxY = 0;
  for (const patch of [{ slope: 8, bank: 7 }, { slope: 10, bank: 10 }]) {
    const sim = simCreate(make(patch), { settle: 0.8 });
    sim.reference.suspension = null;
    const ev = simEvaluate(sim);
    for (const corner of ev.corners) maxY = Math.max(maxY, Math.abs(corner.contact[1]));
  }
  const attitude = poseAt(0, 10, { slope: 0, bank: 0 });
  attitude.reference.suspension = null;
  const attitudeEv = simEvaluate(attitude);
  let attitudeDelta = 0;
  for (const corner of attitudeEv.corners) {
    const yawOnly = [attitudeEv.refPos.x + corner.wheel.x, 0, attitudeEv.refPos.z + corner.wheel.z];
    attitudeDelta = Math.max(attitudeDelta, Math.hypot(
      corner.contact[0] - yawOnly[0], corner.contact[1] - yawOnly[1], corner.contact[2] - yawOnly[2]));
  }
  check(
    'fallback contact uses the full quaternion and the plane normal',
    maxY <= 1e-6 && attitudeDelta > 0.01,
    'y ' + maxY.toExponential(1) + ' m · roll-10 delta ' + (attitudeDelta * 1000).toFixed(2) + ' mm'
  );
}
{
  const sim = simCreate(make({ slope: 8, bank: 7 }), { settle: 1 });
  sim.state.vx = 0.05;
  const ev = simEvaluate(sim);
  const sum = ev.momentParts.normal.map((value, index) =>
    value + ev.momentParts.friction[index] + ev.momentParts.impulse[index]);
  const error = maxAbs(sum.map((value, index) => value - ev.moment[index]));
  check('moment parts sum to the total moment', error <= 1e-9, error.toExponential(1) + ' N m');
}
{
  const sim = simCreate(make({ slope: 8, bank: 7 }), { settle: 1 });
  sim.state.vx = 0.05;
  const ev = simEvaluate(sim);
  const cg = ev.cg;
  const normalSum = [0, 0, 0];
  const frictionSum = [0, 0, 0];
  for (const corner of ev.corners) {
    const arm = [corner.contact[0] - cg[0], corner.contact[1] - cg[1], corner.contact[2] - cg[2]];
    const normal = cross3(arm, [0, corner.force, 0]);
    const friction = cross3(arm, corner.friction);
    for (let index = 0; index < 3; index += 1) {
      normalSum[index] += normal[index];
      frictionSum[index] += friction[index];
    }
  }
  const normalError = maxAbs(normalSum.map((value, index) => value - ev.momentParts.normal[index]));
  const frictionError = maxAbs(frictionSum.map((value, index) => value - ev.momentParts.friction[index]));
  check(
    'normal and friction moments recompute from the contact arm',
    normalError <= 1e-6 && frictionError <= 1e-6,
    normalError.toExponential(1) + ' / ' + frictionError.toExponential(1) + ' N m'
  );
}
{
  const sim = simCreate(make({ slope: 0, bank: 0 }));
  sim.state.vx = 0.1;
  simStep(sim);
  const ev = simEvaluate(sim);
  check(
    'symmetric friction has no yaw moment',
    Math.abs(ev.momentParts.friction[1]) <= 1e-6,
    ev.momentParts.friction[1].toExponential(1) + ' N m'
  );
}
{
  const sim = simCreate(make({ slope: 6, bank: 5 }), { settle: 1 });
  const model = simBuildModel(sim);
  const recomputedX = model.loads.reduce((acc, value, index) => acc + value * model.contactPoints[index].x, 0);
  const recomputedZ = model.loads.reduce((acc, value, index) => acc + value * model.contactPoints[index].z, 0);
  check(
    'normal moment telemetry matches the contact points',
    Math.abs(recomputedX - model.normalMomentX) <= 1e-6 && Math.abs(recomputedZ - model.normalMomentZ) <= 1e-6,
    Math.abs(recomputedX - model.normalMomentX).toExponential(1) + ' / ' + Math.abs(recomputedZ - model.normalMomentZ).toExponential(1)
  );
}
{
  const sim = simCreate(make({}));
  let message = '';
  try {
    simApplyForceAt(sim, [0, 0, 0], [0, 0, 0], 'normal');
  } catch (error) {
    message = String(error && error.message ? error.message : error);
  }
  simEvaluate(sim);
  check(
    'force assembly requires the evaluation accumulator',
    message.indexOf('_evalAccum') >= 0 && sim._evalAccum === undefined,
    message.slice(0, 48)
  );
}
{
  const source = read('src/js/05-body-dynamics.js');
  const start = source.indexOf('function simEvaluate');
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end < 0 ? source.length : end);
  const count = (body.match(/simCross\(/g) || []).length;
  check('simEvaluate has no bare simCross call', count === 0, String(count));
}

console.log('\n[13] render fallback quaternion');
function matMul3(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) for (let k = 0; k < 3; k += 1) out[i][j] += a[i][k] * b[k][j];
  return out;
}
function matVec3(m, v) {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
}
function maxDiff3(a, b) {
  return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));
}
const yaw = 0.7, pitch = 0.3, roll = -0.4;
const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
const Rz = [[cp, -sp, 0], [sp, cp, 0], [0, 0, 1]];
const Rx = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]];
const expected = matMul3(matMul3(Ry, Rz), Rx);
const quat = simQuatFromEuler(yaw, pitch, roll);
const actual = simQuatRotate(quat, [1, 0, 0]);
check('quatFromEuler uses Ry*Rz*Rx', maxDiff3(actual, matVec3(expected, [1, 0, 0])) < 1e-12, maxDiff3(actual, matVec3(expected, [1, 0, 0])).toExponential(2));
const oldOrder = matMul3(matMul3(Ry, Rx), Rz);
const oldVec = matVec3(oldOrder, [1, 0, 0]);
check('Ry*Rx*Rz is distinguishable from the documented order', maxDiff3(actual, oldVec) > 1e-6, maxDiff3(actual, oldVec).toExponential(2));

console.log('\n[14] +18° steering with heave/roll/pitch pulses');
const steeredSource = make({ steer: 18 });
const steerCalSim = simCreate(steeredSource, { settle: 1.0 });
const steerCalPos = simReferencePoint(steerCalSim);
const steerCalState = steerCalSim.state;
const steerCalQuat = new THREE.Quaternion(steerCalState.qx, steerCalState.qy, steerCalState.qz, steerCalState.qw);
const steerRackShift = suspRackForSteer(
  steerCalSim.reference.suspension.corners,
  steerCalPos,
  steerCalQuat,
  18 * Math.PI / 180
);
check(
  '+18° rack shift lands at the design travel',
  steerRackShift > 0.030 && steerRackShift < 0.035,
  (steerRackShift * 1000).toFixed(3) + ' mm'
);
for (const kind of ['heave', 'roll', 'pitch']) {
  const sim = simCreate(steeredSource, { settle: 0.8 });
  sim.rackShift = steerRackShift;
  simRunFor(sim, 0.5);
  simApplyImpulse(sim, kind);
  let maxEval = 0;
  let minCoil = Infinity;
  let maxCoil = -Infinity;
  let minLoad = Infinity;
  let maxLoad = -Infinity;
  let maxCoilJump = 0;
  let maxWheelJump = 0;
  let maxLoadJump = 0;
  let badContact = 0;
  let badSolver = 0;
  let badSource = 0;
  let previous = null;
  for (let step = 0; step < 400; step += 1) {
    suspEvalReset();
    simStep(sim);
    maxEval = Math.max(maxEval, suspEvalCount());
    const model = simBuildModel(sim);
    for (let i = 0; i < 4; i += 1) {
      const row = model.solved[i];
      if (!row || !row.ok || row.motionRatioState !== 'ok') badSolver += 1;
      if (!row || row.coilSource !== 'mechanism' || !Number.isFinite(row.coilLength)) badSource += 1;
      if (!row || Math.abs(row.contact[1]) > 1e-6) badContact += 1;
      if (!row) continue;
      minCoil = Math.min(minCoil, row.coilLength);
      maxCoil = Math.max(maxCoil, row.coilLength);
      minLoad = Math.min(minLoad, model.loads[i]);
      maxLoad = Math.max(maxLoad, model.loads[i]);
      if (previous) {
        maxCoilJump = Math.max(maxCoilJump, Math.abs(row.coilLength - previous.coil[i]));
        maxLoadJump = Math.max(maxLoadJump, Math.abs(model.loads[i] - previous.load[i]));
        const wheel = row.wheelPos;
        const oldWheel = previous.wheel[i];
        maxWheelJump = Math.max(maxWheelJump, Math.hypot(
          wheel[0] - oldWheel[0],
          wheel[1] - oldWheel[1],
          wheel[2] - oldWheel[2]
        ));
      }
    }
    previous = {
      coil: model.solved.map((row) => (row ? row.coilLength : NaN)),
      wheel: model.solved.map((row) => (row ? row.wheelPos : [NaN, NaN, NaN])),
      load: model.loads.slice()
    };
  }
  const tail = simBuildModel(sim);
  check(
    '+18° ' + kind + ' pulse keeps coil, contact, wheel path and loads continuous',
    badSolver === 0 && badSource === 0 && badContact === 0 &&
      maxEval <= 30 &&
      Number.isFinite(minCoil) && minCoil > 0.30 && maxCoil < 0.46 &&
      maxCoil - minCoil > 0.002 &&
      maxCoilJump < 1.5e-3 && maxWheelJump < 5e-3 && maxLoadJump < 300 &&
      minLoad > 0 && maxLoad > reference.maxLoad &&
      sim.flags.finite && !sim.solverDegraded && tail.solverOk && !tail.sim.solverDegraded,
    'eval ' + maxEval +
      ' · L ' + (minCoil * 1000).toFixed(1) + '-' + (maxCoil * 1000).toFixed(1) + ' mm' +
      ' · ΔL ' + (maxCoilJump * 1000).toFixed(3) + ' mm' +
      ' · Δwheel ' + (maxWheelJump * 1000).toFixed(3) + ' mm' +
      ' · ΔN ' + maxLoadJump.toFixed(1) +
      ' · N ' + minLoad.toFixed(1) + '-' + maxLoad.toFixed(1)
  );
}

console.log('\n[15] wheelbase boundaries 3.20 / 3.55 / 3.70 / 3.90');
for (const wheelbase of [3.20, 3.55, 3.70, 3.90]) {
  const source = make({ wheelbase, steer: 18 });
  const boundary = computeStatic(source);
  const boundaryCorners = boundary.suspension.corners;
  let boundaryClosure = 0;
  let boundaryContact = 0;
  let boundaryOk = true;
  for (const mm of [-25, 0, 25]) {
    for (const corner of boundaryCorners) {
      const solved = suspSolveCorner(corner, { x: 0, y: -mm / 1000, z: 0 }, new THREE.Quaternion(), 0, null, true);
      boundaryClosure = Math.max(boundaryClosure, solved.error);
      boundaryContact = Math.max(boundaryContact, Math.abs(solved.contact.y - mm / 1000));
      if (!solved.ok) boundaryOk = false;
    }
  }
  check(
    'wheelbase ' + wheelbase.toFixed(2) + ' m: ±25 mm closure and plane contact',
    boundaryClosure < 1e-6 && boundaryContact < 1e-6 && boundaryOk,
    'closure ' + (boundaryClosure * 1000).toExponential(2) + ' mm · contact ' + boundaryContact.toExponential(2) + ' m'
  );

  const boundarySim = simCreate(source, { settle: 0.8 });
  const boundaryPos = simReferencePoint(boundarySim);
  const boundaryQuat = new THREE.Quaternion(
    boundarySim.state.qx, boundarySim.state.qy, boundarySim.state.qz, boundarySim.state.qw);
  const boundaryShift = suspRackForSteer(
    boundarySim.reference.suspension.corners, boundaryPos, boundaryQuat, 18 * Math.PI / 180);
  boundarySim.rackShift = boundaryShift;
  simRunFor(boundarySim, 0.4);
  simApplyImpulse(boundarySim, 'pitch');
  let boundaryBad = 0;
  let boundaryMaxCoilJump = 0;
  let boundaryMaxArb = 0;
  let boundaryMaxResidual = 0;
  let previousCoil = null;
  for (let step = 0; step < 240; step += 1) {
    simStep(boundarySim);
    const boundaryModel = simBuildModel(boundarySim);
    for (const row of boundaryModel.solved) {
      if (!row || !row.ok || row.coilSource !== 'mechanism') boundaryBad += 1;
    }
    boundaryMaxArb = Math.max(boundaryMaxArb, ...boundaryModel.arbForce.map((value) => Math.abs(value)));
    boundaryMaxResidual = Math.max(boundaryMaxResidual, ...boundaryModel.rockerResidualMm.map((value) => Math.abs(value)));
    if (boundarySim.solverDegraded) boundaryBad += 1;
    const coil = boundaryModel.solved.map((row) => (row ? row.coilLength : NaN));
    if (previousCoil) {
      for (let i = 0; i < coil.length; i += 1) {
        boundaryMaxCoilJump = Math.max(boundaryMaxCoilJump, Math.abs(coil[i] - previousCoil[i]));
      }
    }
    previousCoil = coil;
  }
  const boundaryTail = simBuildModel(boundarySim);
  check(
    'wheelbase ' + wheelbase.toFixed(2) + ' m: +18° pitch pulse keeps ARB, links and coil healthy',
    boundaryBad === 0 && boundaryTail.solverOk && !boundarySim.solverDegraded &&
      boundarySim.flags.finite && boundaryMaxCoilJump < 2e-3 &&
      boundaryMaxArb > 0 && Number.isFinite(boundaryMaxArb) &&
      boundaryMaxResidual < 1e-4 &&
      Number.isFinite(boundaryShift) && boundaryMaxCoilJump > 0,
    'rack ' + (boundaryShift * 1000).toFixed(2) + ' mm · ΔL ' +
      (boundaryMaxCoilJump * 1000).toFixed(3) + ' mm · ARB ' +
      boundaryMaxArb.toFixed(0) + ' N · residual ' + boundaryMaxResidual.toExponential(1) +
      ' mm · loads ' + boundaryTail.loads.map((value) => value.toFixed(0)).join('/')
  );
}

console.log('\n[16] coil telemetry fallback and degraded state');
{
  const sim = simCreate(DEFAULTS, { settle: 0.2 });
  const q = simQuatFromEuler(0, 20 * Math.PI / 180, 0);
  sim.state.qw = q[0];
  sim.state.qx = q[1];
  sim.state.qy = q[2];
  sim.state.qz = q[3];
  const model = simBuildModel(sim);
  const evaluation = simEvaluate(sim);
  const sameLength = model.solved.every((row, i) =>
    row && row.coilLength === evaluation.corners[i].coilLength &&
    row.coilSource === evaluation.corners[i].coilSource);
  const fallbackRows = model.solved.filter((row) => row && row.coilSource === 'fallback').length;
  const rejectedRows = model.solved.filter((row) => row && !row.ok).length;
  check(
    'fallback telemetry reports the force-chain coil length',
    sameLength && fallbackRows > 0 && rejectedRows > 0,
    fallbackRows + ' fallback · ' + rejectedRows + ' not ok'
  );
  check(
    'no rejected mechanism enters the force path and fallback is bounded',
    model.solved.every((row) => row && (row.ok || row.coilSource === 'fallback')) &&
      model.solved.every((row) => row && (row.coilSource !== 'fallback' || ['frame', 'rocker', 'ratio'].includes(row.fallbackReason))) &&
      evaluation.corners.every((corner) => Math.abs(corner.springForce) <= 20000 && Math.abs(corner.dampingForce) <= 20000),
    model.solved.map((row) => row.coilSource + ':' + (row.fallbackReason || '-')).join(' / ')
  );
  const projected = model.solved.map((row, i) => {
    if (!row || row.coilSource !== 'fallback') return { delta: 0, contactY: 0 };
    const corner = sim.reference.suspension.corners[i];
    const visible = corner.body.damper.distanceTo(suspRockerPoint(corner, corner.rocker.damperArm, row.rockerAngle));
    return { delta: Math.abs(visible - row.coilLength), contactY: Math.abs(row.contact[1]) };
  });
  const maxVisibleDelta = Math.max(...projected.map((row) => row.delta));
  const maxContactY = Math.max(...projected.map((row) => row.contactY));
  check(
    'fallback rendering uses the same projected coil and on-plane contact',
    maxVisibleDelta < 1e-12 && maxContactY < 1e-12,
    'ΔL ' + maxVisibleDelta.toExponential(2) + ' m · contactY ' + maxContactY.toExponential(2) + ' m'
  );
  check(
    'solved.ok=false is reflected as degraded telemetry',
    model.sim.solverDegraded === true && model.solverOk === false,
    'degraded ' + model.sim.solverDegraded + ' · solverOk ' + model.solverOk
  );
  simStep(sim);
  check(
    'integration latches the degraded state',
    sim.solverDegraded === true,
    'solverDegraded ' + sim.solverDegraded + ' · failureSteps ' + sim.solverFailureSteps
  );
}


console.log('\n[17] immutable setup snapshots and continuous retarget');
function referenceVelocity(sim) {
  const st = sim.state;
  const c = sim.reference.cgBody;
  const q = [st.qw, st.qx, st.qy, st.qz];
  const arm = simQuatRotate(q, [c.x, c.y, c.z]);
  const omega = simQuatRotate(q, [st.wx, st.wy, st.wz]);
  const spin = cross3(omega, arm);
  return [st.vx - spin[0], st.vy - spin[1], st.vz - spin[2]];
}
{
  const source = make({ cgHeight: 0.3 });
  const sim = simCreate(source, { settle: 0 });
  source.cgHeight = 0.6;
  source.frontWeightPct = 55;
  check('create owns an immutable settings snapshot', Object.isFrozen(sim.reference.source) &&
    sim.reference.source.cgHeight === 0.3 && sim.reference.source.frontWeightPct === DEFAULTS.frontWeightPct);

  const resetSource = make({ cgHeight: 0.32 });
  simReset(sim, resetSource, { settle: 0 });
  resetSource.cgHeight = 0.6;
  check('reset owns an immutable settings snapshot', Object.isFrozen(sim.reference.source) &&
    sim.reference.source.cgHeight === 0.32);

  const q = simQuatFromEuler(0.21, 0.08, -0.06);
  Object.assign(sim.state, {
    qw: q[0], qx: q[1], qy: q[2], qz: q[3],
    vx: 0.2, vy: -0.08, vz: 0.12,
    wx: 0.3, wy: 0.4, wz: -0.2
  });
  const beforePoint = simReferencePoint(sim);
  const beforeVelocity = referenceVelocity(sim);
  const beforeCgVelocity = [sim.state.vx, sim.state.vy, sim.state.vz];
  const oldCg = sim.reference.cgBody;
  const contact = sim.contact;
  sim.solverDegraded = true;
  sim.solverFailed = true;
  sim.solverFailureSteps = 10;
  const retargetSource = make({ cgHeight: 0.5, cgLateral: 0.08, frontWeightPct: 50, steer: 12 });
  simRetargetReference(sim, retargetSource);
  retargetSource.cgHeight = 0.15;
  const afterPoint = simReferencePoint(sim);
  const afterVelocity = referenceVelocity(sim);
  const pointError = Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y, afterPoint.z - beforePoint.z);
  const velocityError = maxAbs(afterVelocity.map((value, i) => value - beforeVelocity[i]));
  const newCg = sim.reference.cgBody;
  const deltaArm = simQuatRotate(q, [newCg.x - oldCg.x, newCg.y - oldCg.y, newCg.z - oldCg.z]);
  const omega = simQuatRotate(q, [sim.state.wx, sim.state.wy, sim.state.wz]);
  const expectedCgVelocity = cross3(omega, deltaArm).map((value, i) => beforeCgVelocity[i] + value);
  const cgVelocityError = maxAbs([sim.state.vx, sim.state.vy, sim.state.vz].map((value, i) => value - expectedCgVelocity[i]));
  check('CG retarget preserves reference-point pose and velocity', pointError < 1e-12 && velocityError < 1e-12 && cgVelocityError < 1e-12,
    'p ' + pointError.toExponential(2) + ' m · vp ' + velocityError.toExponential(2) + ' · vcg ' + cgVelocityError.toExponential(2) + ' m/s');
  check('retarget snapshots source and clears only solver degradation', Object.isFrozen(sim.reference.source) &&
    sim.reference.source.cgHeight === 0.5 && sim.contact === contact &&
    !sim.solverDegraded && !sim.solverFailed && sim.solverFailureSteps === 0);
  const retargetRack = suspRackForSteer(sim.reference.suspension.corners, simReferencePoint(sim),
    new THREE.Quaternion(sim.state.qx, sim.state.qy, sim.state.qz, sim.state.qw), 12 * Math.PI / 180);
  check('combined CG and steer retarget recalibrates at the preserved pose',
    Math.abs(sim.rackShift - retargetRack) < 1e-10 && Math.abs(sim.rackShift) > 0.02,
    (sim.rackShift * 1000).toFixed(6) + ' mm');
}


console.log('\n[18] steered create/reset use final rack and dynamic equilibrium');
function checkSteeredInitial(label, sim) {
  const model = simBuildModel(sim);
  const point = simReferencePoint(sim);
  const st = sim.state;
  const rack = suspRackForSteer(
    sim.reference.suspension.corners,
    point,
    new THREE.Quaternion(st.qx, st.qy, st.qz, st.qw),
    sim.reference.source.steer * Math.PI / 180
  );
  check(label + ': final rack is installed before settle', Math.abs(sim.rackShift - rack) < 1e-10 && Math.abs(sim.rackShift) > 0.03,
    (sim.rackShift * 1000).toFixed(6) + ' mm');
  check(label + ': actual-contact CG residual is below 0.01 N/Nm',
    model.forceError < 0.01 && model.momentXError < 0.01 && model.momentZError < 0.01 && model.solverOk,
    model.forceError.toExponential(2) + ' / ' + model.momentXError.toExponential(2) + ' / ' + model.momentZError.toExponential(2));
  check(label + ': static reference and dynamic loads agree',
    maxAbs(sim.reference.loads.map((value, i) => value - model.loads[i])) < 1e-9 &&
      Math.abs(sim.reference.forceError - model.forceError) < 1e-9 &&
      Math.abs(sim.reference.momentXError - model.momentXError) < 1e-9 &&
      Math.abs(sim.reference.momentZError - model.momentZError) < 1e-9);
  simStep(sim);
  const next = simBuildModel(sim);
  check(label + ': first fixed step has no initialization shock',
    maxAbs(next.loads.map((value, i) => value - model.loads[i])) < 0.01,
    maxAbs(next.loads.map((value, i) => value - model.loads[i])).toExponential(2) + ' N');
}
{
  const sim = simCreate(make({ steer: 18 }), { settle: 0 });
  checkSteeredInitial('create +18deg', sim);
  sim.state.vx = 0.4;
  sim.state.wz = 0.2;
  simReset(sim, make({ steer: 18 }), { settle: 0 });
  checkSteeredInitial('reset +18deg', sim);
}


console.log('\n[19] combined slope/bank joint planar-yaw re-parking');
{
  const sim = simCreate(make({ slope: 10, bank: 10, friction: 0.3 }), { settle: 0.5 });
  const gravity = sim.reference.frame.gravityLocal;
  const tangent = Math.hypot(gravity.x, gravity.z);
  sim.state.vx = 0.3 * gravity.x / tangent;
  sim.state.vz = 0.3 * gravity.z / tangent;
  let holdAt = null;
  for (let i = 0; i < 10000; i += 1) {
    simStep(sim);
    if (holdAt === null && contactMode(sim) === 'HOLD') holdAt = sim.time;
  }
  const q = [sim.state.qw, sim.state.qx, sim.state.qy, sim.state.qz];
  const yawRoad = simQuatRotate(q, [sim.state.wx, sim.state.wy, sim.state.wz])[1];
  const evaluation = simEvaluate(sim);
  check('10deg slope + 10deg bank, mu 0.3 re-parks within 20s',
    contactMode(sim) === 'HOLD' && holdAt !== null && sim.state.vx === 0 && sim.state.vz === 0 &&
      Math.abs(yawRoad) < 1e-12 && evaluation.demand < evaluation.capacity,
    'hold ' + (holdAt === null ? 'never' : holdAt.toFixed(3) + 's') + ' · yawRoad ' + yawRoad.toExponential(2) +
      ' · demand/capacity ' + (evaluation.demand / evaluation.capacity).toFixed(4));
  const point = simReferencePoint(sim);
  simRunFor(sim, 1);
  const held = simReferencePoint(sim);
  check('re-parked compound slope has no subsequent creep', contactMode(sim) === 'HOLD' &&
    Math.hypot(held.x - point.x, held.z - point.z) < 1e-9);
}

console.log('\n[20] joint low-speed saturation never reverses a component');
{
  const random = mulberry32(20261119);
  const sim = simCreate(make({ friction: 0.2 }), { settle: 0 });
  const base = { ...sim.state };
  const yawRoad = (st) => simQuatRotate([st.qw, st.qx, st.qy, st.qz], [st.wx, st.wy, st.wz])[1];
  let lowSpeedCases = 0;
  let jointCases = 0;
  let projectedCases = 0;
  let reversals = 0;
  let first = '';
  for (let i = 0; i < 5000; i += 1) {
    const q = simQuatFromEuler((random() * 2 - 1) * 0.25, (random() * 2 - 1) * 0.2, (random() * 2 - 1) * 0.2);
    Object.assign(sim.state, base, {
      qw: q[0], qx: q[1], qy: q[2], qz: q[3],
      vx: (random() * 2 - 1) * 0.025,
      vz: (random() * 2 - 1) * 0.025,
      wx: (random() * 2 - 1) * 0.08,
      wy: (random() * 2 - 1) * 0.08,
      wz: (random() * 2 - 1) * 0.08
    });
    sim.contact = { mode: 'SLIP', dwell: 0, since: 0, changes: 0, lastChangeStep: 0, reason: 'speed', slipSpeed: 0, usage: 0 };
    const before = { ...sim.state };
    const evaluation = simStep(sim);
    if (!evaluation.arrest.lowSpeed) continue;
    lowSpeedCases += 1;
    if (evaluation.arrest.joint) jointCases += 1;
    if (evaluation.arrest.joint && (evaluation.arrest.planar || evaluation.arrest.yaw)) projectedCases += 1;
    const after = { ...sim.state };
    const pairs = [
      ['vx', before.vx, after.vx],
      ['vz', before.vz, after.vz],
      ['yawRoad', yawRoad(before), yawRoad(after)]
    ];
    for (const [key, start, end] of pairs) {
      if (Math.abs(start) > 1e-7 && Math.abs(end) > 1e-9 && start * end < 0) {
        reversals += 1;
        if (!first) first = 'step ' + i + ' ' + key + ' ' + start + ' -> ' + end;
      }
    }
  }
  check('5000 deterministic low-speed cases never reverse velocity or road yaw',
    lowSpeedCases > 100 && jointCases > 0 && projectedCases > 0 && reversals === 0,
    'low=' + lowSpeedCases + ' joint=' + jointCases + ' projected=' + projectedCases + ' reversals=' + reversals + (first ? ' · ' + first : ''));
}

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + '  ' + (checks - failures) + '/' + checks + ' checks');
if (failures > 0) process.exitCode = 1;
