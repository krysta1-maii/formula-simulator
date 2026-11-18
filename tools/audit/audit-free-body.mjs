#!/usr/bin/env node
import { runAudit, loadPhysics } from './_harness.mjs';

const api = loadPhysics();
const DEFAULTS = api.DEFAULTS;

const AXES = [
  { name: 'x', omega: 'wx' },
  { name: 'y', omega: 'wy' },
  { name: 'z', omega: 'wz' }
];

function neutralise(reference) {
  reference.frame.gravityLocal.x = 0;
  reference.frame.gravityLocal.y = 0;
  reference.frame.gravityLocal.z = 0;
  reference.baseLoads = [0, 0, 0, 0];
  reference.springRates = [0, 0, 0, 0];
  reference.damperRateWheel = [0, 0, 0, 0];
  reference.arbRate = { front: 0, rear: 0 };
  reference.suspension = null;
}

function cgAt(sim, cgBody) {
  const state = sim.state;
  const arm = api.simQuatRotate([state.qw, state.qx, state.qy, state.qz], cgBody);
  return [state.x + arm[0], state.y + arm[1], state.z + arm[2]];
}

function refAt(sim) {
  return [sim.state.x, sim.state.y, sim.state.z];
}

function run(axis) {
  const sim = api.simCreate(DEFAULTS);
  neutralise(sim.reference);
  const state = sim.state;
  state.x = 0;
  state.y = 0;
  state.z = 0;
  state.vx = 0;
  state.vy = 0;
  state.vz = 0;
  state.qw = 1;
  state.qx = 0;
  state.qy = 0;
  state.qz = 0;
  state.wx = 0;
  state.wy = 0;
  state.wz = 0;
  state[axis.omega] = 1;

  const cgBody = [sim.reference.cgBody.x, sim.reference.cgBody.y, sim.reference.cgBody.z];
  const cg0 = cgAt(sim, cgBody);
  const ref0 = refAt(sim);
  let cgDrift = 0;
  for (let i = 0; i < 500; i += 1) {
    api.simStep(sim);
    const cg = cgAt(sim, cgBody);
    cgDrift = Math.max(cgDrift, Math.hypot(cg[0] - cg0[0], cg[1] - cg0[1], cg[2] - cg0[2]));
  }
  const ref = refAt(sim);
  const refDisp = Math.hypot(ref[0] - ref0[0], ref[1] - ref0[1], ref[2] - ref0[2]);
  const perpendicular = axis.name === 'x'
    ? Math.hypot(cgBody[1], cgBody[2])
    : axis.name === 'y'
      ? Math.hypot(cgBody[0], cgBody[2])
      : Math.hypot(cgBody[0], cgBody[1]);
  const expectedRef = 2 * perpendicular * Math.sin(0.5);
  const q = [sim.state.qw, sim.state.qx, sim.state.qy, sim.state.qz];
  const qnormError = Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1);
  return {
    axis: axis.name,
    cgDriftMm: cgDrift * 1000,
    refDispMm: refDisp * 1000,
    expectedRefMm: expectedRef * 1000,
    omegaError: Math.abs(sim.state[axis.omega] - 1),
    qnormError,
    time: sim.time
  };
}

await runAudit({ audit: 'free-body', group: 'physics', title: 'B4.2 自由刚体质心漂移' }, (audit) => {
  for (const axis of AXES) {
    const result = run(axis);
    audit.check(
      'B4.2/cg-drift-' + axis.name,
      result.cgDriftMm <= 0.01,
      { cgDriftMm: result.cgDriftMm, time: result.time },
      'cgDriftMm <= 0.01',
      'free rotation about ' + axis.name + ' for 1 s'
    );
    audit.check(
      'B4.2/ref-path-' + axis.name,
      Math.abs(result.refDispMm - result.expectedRefMm) <= 0.5,
      { refDispMm: result.refDispMm, expectedRefMm: result.expectedRefMm },
      'abs(refDispMm - expectedRefMm) <= 0.5',
      'reference point must follow R(q)c'
    );
    audit.check(
      'B4.2/omega-' + axis.name,
      result.omegaError <= 1e-9,
      { omegaError: result.omegaError },
      'omegaError <= 1e-9',
      'no external torque'
    );
    audit.check(
      'B4.2/quat-norm-' + axis.name,
      result.qnormError <= 1e-12,
      { qnormError: result.qnormError },
      'qnormError <= 1e-12',
      'quaternion normalisation'
    );
  }
});
