#!/usr/bin/env node
import { runAudit, loadPhysics } from './_harness.mjs';

const api = loadPhysics();
const WALL_SECONDS = 1;

function droppedOf(sim) {
  const candidates = [
    sim.droppedTime,
    sim.dropped,
    sim.flags && sim.flags.droppedTime,
    sim.info && sim.info.droppedTime,
    sim.stats && sim.stats.droppedTime
  ];
  const finite = candidates.find((value) => typeof value === 'number' && Number.isFinite(value));
  return finite === undefined ? null : finite;
}

function runCase(hz, clampMs) {
  const sim = api.simCreate(api.DEFAULTS, { settle: 0.4 });
  api.simApplyImpulse(sim, 'roll');
  const start = sim.time;
  const frameDt = 1 / hz;
  const frames = Math.round(WALL_SECONDS * hz);
  let maxSubsteps = 0;
  let lastSubsteps = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const dt = clampMs ? Math.min(frameDt, clampMs / 1000) : frameDt;
    lastSubsteps = api.simAdvance(sim, dt);
    maxSubsteps = Math.max(maxSubsteps, lastSubsteps);
  }
  const advanced = sim.time - start;
  const dropped = droppedOf(sim);
  return {
    hz,
    clampMs: clampMs || null,
    frames,
    wallSeconds: frames * frameDt,
    advanced,
    dropped,
    total: advanced + (dropped || 0),
    maxSubsteps,
    lastSubsteps,
    hasDroppedField: dropped !== null,
    time: sim.time
  };
}

await runAudit({ audit: 'frame-time', group: 'runtime', title: 'B5.1 低帧率时间语义' }, (audit) => {
  const cases = [
    runCase(60),
    runCase(30),
    runCase(10),
    runCase(5),
    runCase(5, 50)
  ];
  const byLabel = {};
  for (const item of cases) byLabel[item.hz + (item.clampMs ? '-clamp' + item.clampMs : '')] = item;

  const sixty = byLabel['60'];
  audit.check(
    'B5.1/60hz',
    sixty.advanced >= 0.98,
    sixty,
    'advanced >= 0.98 s at 1 s wall',
    '60 Hz baseline must stay real time'
  );

  const thirty = byLabel['30'];
  audit.check(
    'B5.1/30hz',
    thirty.advanced >= 0.98,
    thirty,
    'advanced >= 0.98 s at 1 s wall',
    '30 Hz baseline'
  );

  for (const key of ['10', '5', '5-clamp50']) {
    const item = byLabel[key];
    const conserved = item.total >= 0.98;
    const explicitDrop = item.hasDroppedField && item.dropped > 0;
    const okay = item.advanced >= 0.98 || (conserved && explicitDrop);
    audit.check(
      'B5.1/' + key + '-time',
      okay,
      item,
      'advanced >= 0.98 or advanced+droppedTime >= 0.98 with droppedTime > 0',
      'low frame rate must not silently lose simulation time'
    );
  }

  audit.check(
    'B5.1/dropped-field',
    cases.every((item) => item.advanced >= 0.98 || item.hasDroppedField),
    {
      fields: cases.map((item) => ({
        hz: item.hz,
        clampMs: item.clampMs,
        advanced: item.advanced,
        dropped: item.dropped,
        hasDroppedField: item.hasDroppedField
      }))
    },
    'all low-rate cases expose droppedTime or stay real time',
    'backlog/dropped time must be observable'
  );
});
