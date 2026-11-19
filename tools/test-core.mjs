import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), 'utf8');

const threeModule = { exports: {} };
new Function('module', 'exports', 'globalThis', read('vendor/three.min.js') + '\n;')
  .call(threeModule.exports, threeModule, threeModule.exports, globalThis);
const THREE = threeModule.exports;

const factory = new Function('THREE', 'localStorage', read('src/js/00-core.js') + '\n' + read('src/js/03-suspension.js') + '\nreturn { APP_VERSION, computeStatic, computeRoadFrame, runSelfTests, DEFAULTS, NUM_LIMITS };');
const core = factory(THREE, { getItem: () => null, setItem: () => {} });
const { computeStatic, runSelfTests, DEFAULTS, NUM_LIMITS } = core;
const GRAVITY = 9.80665;

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

console.log('FS-01 core verification');
check('application version is 0.4.1', core.APP_VERSION === '0.4.1', core.APP_VERSION);

console.log('\n[1] built-in self-tests');
const selfTests = runSelfTests(DEFAULTS);
check('self-test count is 14', selfTests.length === 14, String(selfTests.length));
check('all self-tests pass', selfTests.every((test) => test.ok), selfTests.filter((test) => !test.ok).map((test) => test.name).join(', '));

console.log('\n[2] level-road reference');
const level = computeStatic(make({}));
const levelSum = level.loads.reduce((sum, value) => sum + value, 0);
check('total normal = mg', Math.abs(levelSum - level.mass * GRAVITY) < 0.05, levelSum.toFixed(6));
check('front share = 45.5 %', Math.abs(level.frontShare * 100 - DEFAULTS.frontWeightPct) < 1e-4, (level.frontShare * 100).toFixed(6));
check('level pose is exactly zero', Math.abs(level.heave) < 1e-12 && Math.abs(level.pitch) < 1e-12 && Math.abs(level.roll) < 1e-12);
check('level lateral moment = mg z_CG', Math.abs(level.normalMomentZ - level.totalWeight * DEFAULTS.cgLateral) < 0.05);
check('level ARB force is zero', level.arbForce.every((value) => Math.abs(value) < 1e-12));
check('level residual is below 0.05 N / N m', level.forceError < 0.05 && level.momentXError < 0.05 && level.momentZError < 0.05);

console.log('\n[3] slope/bank/mixed equilibrium');
for (const patch of [{ slope: 8 }, { bank: 7 }, { slope: 6, bank: 5 }, { slope: -10, bank: -10 }]) {
  const model = computeStatic(make(patch));
  const label = 'slope ' + (patch.slope || 0) + ' bank ' + (patch.bank || 0);
  check(label + ': total normal = mg cos(beta)', Math.abs(model.sumLoads - model.totalNormal) < 0.05);
  check(label + ': raw force/moment residual', model.forceError < 0.05 && model.momentXError < 0.05 && model.momentZError < 0.05);
  check(label + ': no negative displayed load', model.loads.every((value) => value >= 0));
  check(label + ': finite pose', finite(model.heave) && finite(model.pitch) && finite(model.roll));
  check(label + ': ARB forces cancel', Math.abs(model.arbForce.reduce((sum, value) => sum + value, 0)) < 1e-9);
}

console.log('\n[4] direction of load transfer');
const uphill = computeStatic(make({ slope: 8 }));
const rightBank = computeStatic(make({ bank: 7 }));
const levelForTransfer = computeStatic(make({}));
check('uphill transfers load to the rear', uphill.rearLoad > levelForTransfer.rearLoad + 1, (uphill.rearLoad - levelForTransfer.rearLoad).toFixed(2) + ' N');
check('right bank transfers load to the right', rightBank.rightLoad > levelForTransfer.rightLoad + 1, (rightBank.rightLoad - levelForTransfer.rightLoad).toFixed(2) + ' N');

console.log('\n[5] mass scaling');
const doubled = computeStatic(make({ mass: DEFAULTS.mass * 2 }));
check('double mass doubles every corner load', doubled.loads.every((value, index) => Math.abs(value - level.loads[index] * 2) < 0.1));
check('double mass keeps the front share', Math.abs(doubled.frontShare - level.frontShare) < 1e-4);

console.log('\n[6] ARB front/rear redistribution');
const frontBar = computeStatic(make({ slope: 0, bank: 7, arbFront: 100, arbRear: 0 }));
const rearBar = computeStatic(make({ slope: 0, bank: 7, arbFront: 0, arbRear: 100 }));
const frontBarFront = frontBar.loads[1] - frontBar.loads[0];
const rearBarFront = rearBar.loads[1] - rearBar.loads[0];
const frontBarRear = frontBar.loads[3] - frontBar.loads[2];
const rearBarRear = rearBar.loads[3] - rearBar.loads[2];
check('front ARB increases front lateral transfer', frontBarFront > rearBarFront + 5, frontBarFront.toFixed(2) + ' vs ' + rearBarFront.toFixed(2) + ' N');
check('front ARB decreases rear lateral transfer', frontBarRear < rearBarRear - 5, frontBarRear.toFixed(2) + ' vs ' + rearBarRear.toFixed(2) + ' N');
check('total lateral moment stays fixed', Math.abs(frontBar.normalMomentZ - rearBar.normalMomentZ) < 1e-6);
check('ARB roll stiffness matches formula', Math.abs(frontBar.arbRollStiffness - (frontBar.arbRate.front * frontBar.dims.tf ** 2 + frontBar.arbRate.rear * frontBar.dims.tr ** 2)) < 1e-6);

console.log('\n[7] warning reachability');
const lowGrip = computeStatic(make({ slope: 10, bank: 10, friction: 0.2 }));
const normalGrip = computeStatic(make({ slope: 10, bank: 10, friction: 1.4 }));
check('low grip at 10/10 triggers friction warning', lowGrip.frictionOk === false, lowGrip.frictionDemand.toFixed(4));
check('normal grip at 10/10 does not trigger friction warning', normalGrip.frictionOk === true);
const lifted = computeStatic(make({ slope: 35, bank: 35, cgHeight: 0.9, cgLateral: 0.3, trackFront: 1.2, trackRear: 1.2 }));
check('out-of-envelope state produces a negative raw load', lifted.rawLoads.some((value) => value < 0), 'min raw ' + lifted.minRawLoad.toFixed(2) + ' N');
check('displayed loads are clamped at zero', lifted.loads.every((value) => value >= 0));
check('contact status reports the lift', lifted.contactOk === false && lifted.liftedCount > 0);
check('raw equilibrium still holds when the guard trips', lifted.forceError < 0.5 && lifted.momentXError < 0.5 && lifted.momentZError < 0.5);

console.log('\n[8] randomized envelope');
const random = mulberry32(20261031);
let worstResidual = 0;
let minLoad = Infinity;
let randomFailures = 0;
for (let i = 0; i < 3000; i += 1) {
  const model = computeStatic(make({
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
    arbFront: randomBetween(random, NUM_LIMITS.arbFront[0], NUM_LIMITS.arbFront[1]),
    arbRear: randomBetween(random, NUM_LIMITS.arbRear[0], NUM_LIMITS.arbRear[1])
  }));
  worstResidual = Math.max(worstResidual, model.forceError, model.momentXError, model.momentZError);
  minLoad = Math.min(minLoad, model.minLoad);
  if (!model.loads.every((value) => value >= 0) || !model.loads.every(finite) || !finite(model.heave) || !finite(model.pitch) || !finite(model.roll)) {
    randomFailures += 1;
  }
  if (Math.abs(model.sumLoads - model.totalNormal) > 0.05 && model.liftedCount === 0) {
    randomFailures += 1;
  }
}
check('3000 random envelope states stay finite', randomFailures === 0, randomFailures + ' failures');
check('3000 random envelope states respect force/moment equilibrium', worstResidual < 0.5, worstResidual.toExponential(2));
check('3000 random envelope states stay grounded', minLoad > 0, minLoad.toFixed(2) + ' N');

console.log('\n[9] determinism');
const a = computeStatic(make({ slope: 6, bank: 5, mass: 812 }));
const b = computeStatic(make({ slope: 6, bank: 5, mass: 812 }));
check('identical inputs give identical loads', JSON.stringify(a.loads) === JSON.stringify(b.loads));
check('identical inputs give identical pose', a.heave === b.heave && a.pitch === b.pitch && a.roll === b.roll);

console.log('\n[10] cleanup guards');
check('dead material set is removed', !read('src/js/20-car.js').includes('createDefaultBodyMaterialSet'));
check('screenshot name is state-aware', !read('src/js/40-app.js').includes('FS-01_static_'));
check('capture-docs dead helper is removed', !read('tools/capture-docs.mjs').includes('latestDownload'));

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + '  ' + (checks - failures) + '/' + checks + ' checks');
if (failures > 0) process.exitCode = 1;
