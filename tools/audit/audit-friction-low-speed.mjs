#!/usr/bin/env node
import { runAudit, loadPhysics, makeSetup } from './_harness.mjs';

const api = loadPhysics(['simRetargetReference']);
const STEP = api.SIM_DT;

function modeOf(sim) {
  if (sim.contact && typeof sim.contact.mode === 'string') return sim.contact.mode;
  if (sim.flags.holding) return 'HOLD';
  if (sim.flags.sliding) return 'SLIP';
  return 'NONE';
}

function planarSpeed(sim) {
  return Math.hypot(sim.state.vx, sim.state.vz);
}

function retarget(sim, source) {
  if (typeof api.simRetargetReference === 'function') {
    api.simRetargetReference(sim, source);
    return 'simRetargetReference';
  }
  sim.reference = api.computeStatic(source);
  return 'direct-reference';
}

function lowSpeedCase() {
  const sim = api.simCreate(makeSetup(api, {}));
  sim.state.vx = 0.0005;
  api.simStep(sim);
  const afterOne = {
    vx: sim.state.vx,
    x: sim.state.x,
    mode: modeOf(sim),
    hasContactState: Boolean(sim.contact && typeof sim.contact.mode === 'string')
  };
  for (let i = 0; i < 3; i += 1) api.simStep(sim);
  return {
    afterOne,
    afterFour: {
      vx: sim.state.vx,
      x: sim.state.x,
      mode: modeOf(sim),
      displacement: Math.hypot(sim.state.x, sim.state.z)
    }
  };
}

function stepCase() {
  const sim = api.simCreate(makeSetup(api, {}));
  sim.state.vx = 0.01;
  api.simStep(sim);
  return {
    vx: sim.state.vx,
    x: sim.state.x,
    mode: modeOf(sim)
  };
}

function slopeCase() {
  const sim = api.simCreate(makeSetup(api, { slope: 8, friction: 1.4 }));
  sim.state.vx = 0.0005;
  for (let i = 0; i < 4; i += 1) api.simStep(sim);
  return {
    vx: sim.state.vx,
    displacement: Math.hypot(sim.state.x, sim.state.z),
    mode: modeOf(sim)
  };
}

function reparkCase() {
  const sim = api.simCreate(makeSetup(api, { slope: 10, bank: 10, friction: 0.2 }));
  sim.state.vx = 0.4;
  api.simRunFor(sim, 1.0);
  const before = {
    time: sim.time,
    vx: sim.state.vx,
    vz: sim.state.vz,
    mode: modeOf(sim),
    displacement: Math.hypot(sim.state.x, sim.state.z)
  };
  const target = makeSetup(api, { slope: 0, bank: 0, friction: 0.9 });
  const retargetMethod = retarget(sim, target);
  const x0 = sim.state.x;
  const z0 = sim.state.z;
  for (let i = 0; i < 50; i += 1) api.simStep(sim);
  const after100ms = {
    vx: sim.state.vx,
    vz: sim.state.vz,
    wy: sim.state.wy,
    mode: modeOf(sim),
    speed: planarSpeed(sim)
  };
  for (let i = 0; i < 500; i += 1) api.simStep(sim);
  return {
    before,
    retargetMethod,
    after100ms,
    after11s: {
      vx: sim.state.vx,
      vz: sim.state.vz,
      wy: sim.state.wy,
      mode: modeOf(sim),
      displacement: Math.hypot(sim.state.x - x0, sim.state.z - z0)
    }
  };
}

await runAudit({ audit: 'friction-low-speed', group: 'contact', title: 'B4.3 低速摩擦与重新驻车' }, (audit) => {
  const low = lowSpeedCase();
  audit.check(
    'B4.3/low-speed-hold',
    Math.abs(low.afterOne.vx) <= 1e-12 &&
      low.afterFour.mode === 'HOLD' &&
      low.afterFour.displacement <= 2e-6,
    low,
    'vx <= 1e-12 after one step; HOLD after four; displacement <= 2e-6 m',
    'level road, vx=0.0005 m/s'
  );
  audit.check(
    'B4.3/contact-state-field',
    low.afterOne.hasContactState,
    { hasContactState: low.afterOne.hasContactState, mode: low.afterOne.mode },
    'sim.contact.mode in HOLD/SLIP',
    'state machine must be observable'
  );

  const step = stepCase();
  audit.check(
    'B4.3/step-no-reversal',
    step.vx >= 0 && step.vx < 1e-6 && step.x >= 0 && step.x < 1e-4,
    step,
    '0 <= vx < 1e-6 and 0 <= x < 1e-4 after one 2 ms step',
    'level road, vx=0.01 m/s'
  );

  const slope = slopeCase();
  audit.check(
    'B4.3/slope-perturbation',
    slope.mode === 'HOLD' && Math.abs(slope.vx) <= 1e-12 && slope.displacement < 1e-4,
    slope,
    'HOLD, vx <= 1e-12, displacement < 1e-4 m',
    '8 degree slope, mu=1.4, vx=0.0005 m/s'
  );

  const repark = reparkCase();
  audit.check(
    'B4.3/repark',
    repark.after100ms.mode === 'HOLD' &&
      Math.abs(repark.after100ms.vx) <= 1e-12 &&
      Math.abs(repark.after100ms.vz) <= 1e-12 &&
      Math.abs(repark.after100ms.wy) <= 1e-12 &&
      repark.after11s.displacement < 1e-9,
    repark,
    'HOLD within 0.1 s, velocities zero, drift < 1e-9 m',
    '10/10 degree low grip to level mu=0.9'
  );
});
