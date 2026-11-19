#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPhysics, loadThree } from './audit/_harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), 'utf8');
const THREE = loadThree();

const RUNTIME_EXPORTS = [
  'CAR', 'instanceMaterial', 'beginCarBuild', 'finishCarBuild', 'disposeGroupChildren',
  'disposeResourceOnce', 'updateCar', 'updateSuspension', 'buildCar', 'MAT', 'S'
];

function loadRuntime() {
  const source = [
    read('src/js/00-core.js'),
    read('src/js/03-suspension.js'),
    read('src/js/05-body-dynamics.js'),
    read('src/js/20-car.js'),
    read('src/js/22-car-dynamics.js')
  ].join('\n');
  const fields = RUNTIME_EXPORTS.map((name) => name + ': typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined');
  const factory = new Function('THREE', 'localStorage', 'MAT', 'TEX', 'S',
    source + '\nreturn {' + fields.join(',') + '};');
  const S = { bodyPivot: new THREE.Group(), scene: new THREE.Scene(), roadGroup: new THREE.Group(), carRoot: new THREE.Group() };
  const MAT = {};
  const api = factory(THREE, { getItem: () => null, setItem: () => {} }, MAT, {}, S);
  api.MAT = MAT;
  api.S = S;
  return api;
}

let failures = 0;
let checks = 0;
function check(name, ok, detail = '') {
  checks += 1;
  if (ok) {
    console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : ''));
    return;
  }
  failures += 1;
  console.error('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
}

function group(name) {
  console.log('\n[' + name + ']');
}

function frames(api, fps, seconds = 1) {
  const sim = api.simCreate(api.DEFAULTS, { settle: 0 });
  const start = sim.time;
  const count = Math.round(fps * seconds);
  let dropped = 0;
  for (let i = 0; i < count; i += 1) {
    api.simAdvance(sim, 1 / fps);
    dropped += sim.droppedTime || 0;
  }
  return { sim, advanced: sim.time - start, timeScale: sim.timeScale, dropped: dropped, backlog: sim.accumulator };
}

function runFrame() {
  group('frame');
  const physics = loadPhysics(['geometrySignature', 'geometryRevisionFor', 'setActiveGeometry', 'SIM_MAX_BACKLOG']);
  check('SIM_MAX_SUBSTEPS is 128', physics.SIM_MAX_SUBSTEPS === 128, String(physics.SIM_MAX_SUBSTEPS));
  check('SIM_MAX_FRAME_DT is 0.5', physics.SIM_MAX_FRAME_DT === 0.5, String(physics.SIM_MAX_FRAME_DT));
  check('SIM_MAX_BACKLOG is 0.5', physics.SIM_MAX_BACKLOG === 0.5, String(physics.SIM_MAX_BACKLOG));
  for (const fps of [60, 30, 12, 10, 5, 4]) {
    const result = frames(physics, fps);
    check(fps + ' Hz advances one second', Math.abs(result.advanced - 1) <= 0.003, result.advanced.toFixed(5) + ' s');
    check(fps + ' Hz has no dropped time', result.dropped === 0, String(result.dropped));
    check(fps + ' Hz backs up less than a step', result.backlog < 2 * physics.SIM_DT, result.backlog.toExponential(2));
  }
  const slow = frames(physics, 2);
  check('2 Hz advances about 0.512 s/s', Math.abs(slow.advanced - 0.512) <= 0.003, slow.advanced.toFixed(4));
  check('2 Hz has explicit dropped time', Math.abs(slow.dropped - 0.244) <= 0.003, slow.dropped.toFixed(4));
  check('2 Hz timeScale is about 0.512', Math.abs(slow.timeScale - 0.512) <= 0.004, slow.timeScale.toFixed(4));

  const stall = physics.simCreate(physics.DEFAULTS, { settle: 0 });
  const before = stall.time;
  const steps = physics.simAdvance(stall, 2.0);
  check('stall frame executes 128 steps', steps === 128, String(steps));
  check('stall frame advances 0.256 s', Math.abs((stall.time - before) - 0.256) <= 0.003, (stall.time - before).toFixed(4));
  check('stall frame drops 1.5 s', Math.abs((stall.droppedTime || 0) - 1.5) <= 1e-9, String(stall.droppedTime));
  const scales = [];
  for (let i = 0; i < 3; i += 1) {
    physics.simAdvance(stall, 1 / 60);
    scales.push(stall.timeScale);
  }
  check('catch-up sequence [15.36, 1.20, 0.96]', Math.abs(scales[0] - 15.36) < 0.1 && Math.abs(scales[1] - 1.2) < 0.1 && Math.abs(scales[2] - 0.96) < 0.1, scales.map((v) => v.toFixed(2)).join(' / '));
  check('backlog drains below one step', stall.accumulator < 2 * physics.SIM_DT, stall.accumulator.toExponential(2));

  const clampSim = physics.simCreate(physics.DEFAULTS, { settle: 0 });
  const clampStart = clampSim.time;
  const clampSteps = physics.simAdvance(clampSim, 0.2);
  check('simAdvance(0.2) is not limited to 50 ms', clampSteps >= 90 && (clampSim.time - clampStart) >= 0.19, clampSteps + ' steps');

  const ref = physics.simCreate(physics.DEFAULTS, { settle: 0 });
  physics.simRunFor(ref, 0.5);
  const refState = [ref.state.y, ref.state.qx, ref.state.qz];
  for (const fps of [60, 30, 12, 10]) {
    const sim = physics.simCreate(physics.DEFAULTS, { settle: 0 });
    while (sim.time < 0.5 - 1e-12) {
      const frameDt = Math.min(1 / fps, 0.5 - sim.time);
      physics.simAdvance(sim, frameDt);
    }
    const steps2 = Math.round(sim.time / physics.SIM_DT);
    physics.simRunFor(ref, 0);
    const refSteps = Math.round(ref.time / physics.SIM_DT);
    const delta = steps2 === refSteps
      ? Math.abs(sim.state.y - refState[0]) + Math.abs(sim.state.qx - refState[1]) + Math.abs(sim.state.qz - refState[2])
      : Infinity;
    check(fps + ' Hz state matches fixed stepping', delta <= 1e-12,
      'steps=' + steps2 + '/' + refSteps + ' delta=' + delta.toExponential(2));
  }
}

function runGeometry() {
  group('geometry');
  const physics = loadPhysics(['geometrySignature', 'geometryRevisionFor', 'setActiveGeometry', 'GEOMETRY_REVISIONS', 'simRetargetReference']);
  const base = Object.assign({}, physics.DEFAULTS);
  const active = physics.setActiveGeometry(base);
  check('active geometry has a numeric revision', Number.isFinite(active) && active > 0, String(active));
  for (let i = 0; i < 70; i += 1) {
    physics.geometryRevisionFor(Object.assign({}, base, { wheelbase: 3.2 + i * 0.001 }));
  }
  check('revision map stays bounded at 64', physics.GEOMETRY_REVISIONS.size <= 64, String(physics.GEOMETRY_REVISIONS.size));
  check('active revision survives 70 insertions', physics.geometryRevisionFor(base) === active, String(physics.geometryRevisionFor(base)));
  const same = physics.geometryRevisionFor(Object.assign({}, base));
  check('same dimensions return same revision', same === active, String(same));

  const sim = physics.simCreate(base, { settle: 0 });
  const model = physics.simBuildModel(sim);
  check('simCreate stamps geometryRevision', sim.geometryRevision === sim.reference.geometryRevision, String(sim.geometryRevision));
  check('simBuildModel carries geometryRevision', model.geometryRevision === sim.reference.geometryRevision, String(model.geometryRevision));
  check('simBuildModel carries physicsRevision', model.physicsRevision === sim.reference.geometryRevision, String(model.physicsRevision));

  const retarget = physics.simCreate(base, { settle: 0 });
  const stateBefore = [retarget.state.x, retarget.state.y, retarget.state.z, retarget.state.qx];
  const contactBefore = JSON.stringify(retarget.contact);
  physics.simRetargetReference(retarget, Object.assign({}, base, { mass: 820 }));
  check('retarget preserves body state', stateBefore.every((value, index) => value === [retarget.state.x, retarget.state.y, retarget.state.z, retarget.state.qx][index]));
  check('retarget preserves contact state', JSON.stringify(retarget.contact) === contactBefore);
  let threw = false;
  try {
    physics.simRetargetReference(retarget, Object.assign({}, base, { wheelbase: 3.90 }));
  } catch (error) {
    threw = /geometryRevision/.test(String(error && error.message));
  }
  check('retarget rejects a different geometry revision', threw);

  const runtime = loadRuntime();
  runtime.CAR.built = true;
  runtime.CAR.geometryRevision = 1;
  runtime.CAR.corners = [];
  runtime.CAR.diag.geometryMismatch = false;
  runtime.updateCar({ geometryRevision: 2 });
  check('updateCar rejects a different generation', runtime.CAR.diag.geometryMismatch === true);
  runtime.CAR.diag.geometryMismatch = false;
  runtime.updateSuspension({ geometryRevision: 2 });
  check('updateSuspension rejects a different generation', runtime.CAR.diag.geometryMismatch === true);
}

function loadUiForSetup(defaults) {
  const source = read('src/js/30-ui.js');
  const factory = new Function('THREE', 'document', 'window', 'state',
    source + '\nreturn { UI, setupSignature, noteSetupChange };');
  return factory(THREE, { querySelector: () => null, querySelectorAll: () => [] }, { innerWidth: 1280 }, Object.assign({}, defaults));
}

function runSelftest() {
  group('selftest');
  const physics = loadPhysics(['runDynamicSelfTests', 'runDynamicSelfTestsChunked']);
  const ui = loadUiForSetup(physics.DEFAULTS);
  let current = Object.assign({}, physics.DEFAULTS);
  let revision = ui.noteSetupChange(current);
  for (const key of ['mass', 'frontWeightPct', 'cgHeight', 'cgLateral', 'wheelbase', 'trackFront', 'trackRear', 'wheelRadius', 'tireWidthF', 'tireWidthR', 'wheelRateF', 'wheelRateR', 'dampingF', 'dampingR', 'arbFront', 'arbRear', 'slope', 'bank', 'friction']) {
    current = Object.assign({}, current, { [key]: physics.DEFAULTS[key] + (typeof physics.DEFAULTS[key] === 'number' ? 0.01 : 0) });
    const next = ui.noteSetupChange(current);
    check('setup revision changes for ' + key, next === revision + 1, String(next));
    revision = next;
  }
  const steerBefore = ui.noteSetupChange(Object.assign({}, current, { steer: 5 }));
  check('steer does not change setup revision', steerBefore === revision, String(steerBefore));
  const unitsBefore = ui.noteSetupChange(Object.assign({}, current, { units: 'kg' }));
  check('units do not change setup revision', unitsBefore === revision, String(unitsBefore));
  const tests = physics.runDynamicSelfTests(physics.DEFAULTS);
  check('dynamic self-tests return 10 checks', tests.length === 10, String(tests.length));
  check('all dynamic self-tests pass', tests.every((test) => test.ok), tests.filter((test) => !test.ok).map((test) => test.name).join(', '));
  check('new low-speed checks are present', tests.some((test) => test.name === '低速驻车') && tests.some((test) => test.name === '滑移不反向'));
  return new Promise((resolve) => {
    const seen = [];
    physics.runDynamicSelfTestsChunked(physics.DEFAULTS, {
      sliceMs: 20,
      onTest: (test) => seen.push(test.name),
      onDone: (chunked) => {
        check('chunked self-tests return 10 checks', chunked.length === 10, String(chunked.length));
        check('chunked self-tests preserve order', seen.length === 10 && seen.join('|') === tests.map((test) => test.name).join('|'), seen.length + ' names');
        resolve();
      }
    });
  });
}

function runAssets() {
  group('assets');
  const runtime = loadRuntime();
  const THREE = loadThree();
  runtime.MAT.steel = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const cached = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  runtime.CAR.decalCache.set('audit', cached);
  runtime.beginCarBuild();
  for (let i = 0; i < 7; i += 1) runtime.instanceMaterial(new THREE.MeshStandardMaterial({ color: 0x111111 }));
  const container = new THREE.Group();
  for (const material of runtime.CAR.assets.instanceMaterials) {
    container.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material));
  }
  const sharedMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), runtime.MAT.steel);
  sharedMesh.geometry.userData.shared = true;
  container.add(sharedMesh);
  container.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), cached));
  const stats = runtime.disposeGroupChildren(container);
  check('seven instance materials are released', stats.materialDisposed === 7, String(stats.materialDisposed));
  check('shared and cached materials are skipped', stats.skipped >= 2 && runtime.MAT.steel.userData.__disposed !== true && cached.userData.__disposed !== true, 'skipped ' + stats.skipped);
  check('non-shared geometry is released', stats.geometryDisposed === 8, String(stats.geometryDisposed));
  check('group is empty after dispose', container.children.length === 0, String(container.children.length));
  check('lastBuild material counts match', runtime.CAR.assets.lastBuild.instanceMaterialCreated === runtime.CAR.assets.lastBuild.instanceMaterialDisposed, JSON.stringify(runtime.CAR.assets.lastBuild));
  const again = runtime.disposeGroupChildren(container);
  check('second dispose is a no-op', again.materialDisposed === 0 && again.geometryDisposed === 0);
}

async function main() {
  runFrame();
  runGeometry();
  await runSelftest();
  runAssets();
  console.log('\n' + (failures ? 'FAIL  ' + failures + ' check(s) failed' : 'PASS') + '  ' + checks + '/' + checks + ' checks');
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('ERROR', error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
