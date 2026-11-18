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
  ' simEvaluate, runDynamicSelfTests, SIM_DT, simQuatFromEuler, simEulerFromQuat,' +
  ' suspSolveCorner, suspensionBuild, suspRackForSteer, suspWheelSteer, simReferencePoint' +
  '};');
const api = factory(THREE, { getItem: () => null, setItem: () => {} });
const {
  computeStatic,
  runSelfTests,
  DEFAULTS,
  NUM_LIMITS,
  GRAVITY,
  simCreate,
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
  simReferencePoint
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
check('motion ratios are in range', reference.motionRatio.front >= 0.3 && reference.motionRatio.front <= 0.9 && reference.motionRatio.rear >= 0.3 && reference.motionRatio.rear <= 0.9);
check('coil rate follows wheel rate / i^2', reference.springRateCoil.every((value, index) => Math.abs(value - reference.springRates[index] / Math.pow(reference.suspension.design[index].motionRatio, 2)) < 1e-6));

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
  'measured motion ratios stay positive',
  solvedRows.every((row) => row.every((corner) => corner.motionRatio != null && corner.motionRatio > 0.15 && corner.motionRatio < 1.5)),
  reference.motionRatio.front.toFixed(3) + ' / ' + reference.motionRatio.rear.toFixed(3)
);
const rackSteer = 12 * Math.PI / 180;
const rackShift = suspRackForSteer(mechanism, { x: 0, y: 0, z: 0 }, new THREE.Quaternion(), rackSteer);
const rackSolved = mechanism.filter((corner) => corner.front).map((corner) =>
  suspSolveCorner(corner, { x: 0, y: 0, z: 0 }, new THREE.Quaternion(), rackShift, null, false));
const meanSteer = rackSolved.reduce((acc, row) => acc + suspWheelSteer(row.wheelQuat), 0) / rackSolved.length;
check(
  'rack calibration reaches the steering input',
  Math.abs(meanSteer - rackSteer) < 0.01,
  (meanSteer * 180 / Math.PI).toFixed(2) + '° at ' + (rackShift * 1000).toFixed(1) + ' mm'
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
check('static self-tests still pass', runSelfTests(DEFAULTS).every((test) => test.ok));

console.log('\n[2] level dynamic equilibrium');
const levelSim = simCreate(DEFAULTS, { settle: 2.5 });
const levelModel = simBuildModel(levelSim);
const levelError = loadError(levelModel, reference);
check('level loads match the static reference', levelError < 0.01, levelError.toExponential(2) + ' N');
check('level attitude is exactly level', Math.abs(levelModel.poseDeg.pitch) < 1e-6 && Math.abs(levelModel.poseDeg.roll) < 1e-6);
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
check('dynamic self-test count is at least 8', dynamicTests.length >= 8, String(dynamicTests.length));
check('all dynamic self-tests pass', dynamicTests.every((test) => test.ok), dynamicTests.filter((test) => !test.ok).map((test) => test.name).join(', '));

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + '  ' + (checks - failures) + '/' + checks + ' checks');
if (failures > 0) process.exitCode = 1;
