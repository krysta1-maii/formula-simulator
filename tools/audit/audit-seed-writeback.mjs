#!/usr/bin/env node
import { runAudit, loadPhysics, makeSetup } from './_harness.mjs';

const api = loadPhysics();
const SETUP = makeSetup(api, {
  mass: 600,
  wheelRateF: 50,
  wheelRateR: 50,
  dampingF: 0.05,
  dampingR: 0.05,
  arbFront: 0,
  arbRear: 0
});

function snapshot(sim) {
  const s = sim.state;
  return {
    x: s.x, y: s.y, z: s.z,
    vx: s.vx, vy: s.vy, vz: s.vz,
    qw: s.qw, qx: s.qx, qy: s.qy, qz: s.qz,
    wx: s.wx, wy: s.wy, wz: s.wz,
    time: sim.time
  };
}

function diff(a, b) {
  let max = 0;
  for (const key of Object.keys(a)) max = Math.max(max, Math.abs(a[key] - b[key]));
  return max;
}

function run(mode) {
  const sim = api.simCreate(SETUP, { settle: 1.5 });
  if (mode === 'poison') {
    for (const corner of sim.reference.suspension.corners) {
      corner.angle = corner.rocker.baseAngle + 1.2;
    }
  }
  api.simApplyImpulse(sim, 'pitch');
  let peak = 0;
  let peakInfo = null;
  for (let frame = 0; frame < 90; frame += 1) {
    for (let sub = 0; sub < 8; sub += 1) {
      const evaluation = api.simStep(sim);
      for (let index = 0; index < 4; index += 1) {
        const damping = Math.abs(evaluation.corners[index].dampingForce);
        if (damping > peak) {
          peak = damping;
          peakInfo = {
            frame,
            sub,
            index,
            time: sim.time,
            ratio: evaluation.corners[index].motionRatio
          };
        }
      }
    }
    const model = api.simBuildModel(sim);
    if (mode === 'write') {
      for (let index = 0; index < 4; index += 1) {
        const solved = model.solved && model.solved[index];
        if (solved && Number.isFinite(solved.rockerAngle)) {
          sim.reference.suspension.corners[index].angle = solved.rockerAngle;
        }
      }
    }
  }
  return { peakN: peak, peakKN: peak / 1000, peakInfo, state: snapshot(sim) };
}

await runAudit({ audit: 'seed-writeback', group: 'physics', title: 'O1 渲染回写摇臂角种子' }, (audit) => {
  const plain = run('plain');
  const writeback = run('write');
  const poison = run('poison');
  const peakDelta = Math.abs(writeback.peakN - plain.peakN) / plain.peakN;
  const stateDelta = diff(plain.state, writeback.state);
  const poisonDelta = diff(plain.state, poison.state);

  audit.check(
    'O1/writeback-peak',
    peakDelta <= 0.01,
    {
      plainPeakKN: plain.peakKN,
      writebackPeakKN: writeback.peakKN,
      relativeDelta: peakDelta,
      writebackPeakInfo: writeback.peakInfo
    },
    'abs(writebackPeak - plainPeak) / plainPeak <= 0.01',
    'render-layer corner.angle writeback must not change the physical peak'
  );
  audit.check(
    'O1/writeback-state',
    stateDelta <= 1e-12,
    { stateDelta, plainTime: plain.state.time, writebackTime: writeback.state.time },
    'state delta <= 1e-12',
    'complete state, time and flags must be identical'
  );
  audit.check(
    'O1/seed-poison',
    poisonDelta <= 1e-12,
    { poisonDelta, poisonPeakKN: poison.peakKN },
    'state delta <= 1e-12 after poisoning corner.angle',
    'physics must not read corner.angle as a seed'
  );
  audit.check(
    'O1/peak-bound',
    plain.peakKN <= 15,
    { plainPeakKN: plain.peakKN },
    'plainPeakKN <= 15',
    'same physical envelope as B4.1'
  );
});
