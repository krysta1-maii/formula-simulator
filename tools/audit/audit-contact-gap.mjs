#!/usr/bin/env node
import { runAudit, loadPhysics, makeSetup } from './_harness.mjs';

const api = loadPhysics();
const DEFAULTS = api.DEFAULTS;

function setAttitude(sim, pitchDeg, rollDeg) {
  const q = api.simQuatFromEuler(0, pitchDeg * Math.PI / 180, rollDeg * Math.PI / 180);
  sim.state.qw = q[0];
  sim.state.qx = q[1];
  sim.state.qy = q[2];
  sim.state.qz = q[3];
}

function gapOfModel(model) {
  let gap = 0;
  let maxY = 0;
  const perCorner = [];
  for (let index = 0; index < model.contactPoints.length; index += 1) {
    const a = model.contactPoints[index];
    const solved = model.solved && model.solved[index];
    const b = solved ? solved.contact : null;
    if (!b) {
      perCorner.push({ index, gapMm: null });
      continue;
    }
    const distance = Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]);
    gap = Math.max(gap, distance);
    maxY = Math.max(maxY, Math.abs(b[1]), Math.abs(a.y));
    perCorner.push({ index, gapMm: distance * 1000 });
  }
  return { gapMm: gap * 1000, maxY, perCorner };
}

function caseAt(label, source, pitchDeg, rollDeg) {
  const sim = api.simCreate(source, { settle: pitchDeg === 0 && rollDeg === 0 ? 0.5 : 0.8 });
  if (pitchDeg !== 0 || rollDeg !== 0) setAttitude(sim, pitchDeg, rollDeg);
  return Object.assign({ label, pitchDeg, rollDeg }, gapOfModel(api.simBuildModel(sim)));
}

function defaultSample() {
  const sim = api.simCreate(DEFAULTS, { settle: 1.5 });
  api.simApplyImpulse(sim, 'pitch');
  api.simRunFor(sim, 0.06);
  return Object.assign({ label: 'default-pitch-60ms' }, gapOfModel(api.simBuildModel(sim)));
}

function fallbackCase() {
  const rollDeg = 10;
  const withSuspension = api.simCreate(DEFAULTS, { settle: 0.8 });
  setAttitude(withSuspension, 0, rollDeg);
  const model = api.simBuildModel(withSuspension);
  const solvedContacts = model.solved.map((row) => row && row.contact);

  const fallback = api.simCreate(DEFAULTS, { settle: 0.8 });
  setAttitude(fallback, 0, rollDeg);
  fallback.reference.suspension = null;
  const evaluation = api.simEvaluate(fallback);
  const state = fallback.state;
  const cy = Math.cos(evaluation.euler.yaw);
  const sy = Math.sin(evaluation.euler.yaw);
  let maxY = 0;
  let maxVsYawOnly = 0;
  const perCorner = [];
  for (let index = 0; index < evaluation.corners.length; index += 1) {
    const corner = evaluation.corners[index];
    const wheel = corner.wheel;
    const contact = corner.contact;
    const yawOnly = [
      state.x + cy * wheel.x + sy * wheel.z,
      0,
      state.z - sy * wheel.x + cy * wheel.z
    ];
    const distance = Math.hypot(contact[0] - yawOnly[0], contact[1] - yawOnly[1], contact[2] - yawOnly[2]);
    const solved = solvedContacts[index];
    const vsSolved = solved
      ? Math.hypot(contact[0] - solved[0], contact[1] - solved[1], contact[2] - solved[2])
      : null;
    maxY = Math.max(maxY, Math.abs(contact[1]));
    maxVsYawOnly = Math.max(maxVsYawOnly, distance);
    perCorner.push({ index, y: contact[1], vsYawOnlyMm: distance * 1000, vsSolvedMm: vsSolved === null ? null : vsSolved * 1000 });
  }
  return { rollDeg, maxY, maxVsYawOnlyMm: maxVsYawOnly * 1000, perCorner };
}

await runAudit({ audit: 'contact-gap', group: 'contact', title: 'B4.5 接地点单一来源' }, (audit) => {
  const def = defaultSample();
  const cases = [];
  for (const pitch of [0, 2, 5, 10]) {
    cases.push(caseAt('pitch-' + pitch, DEFAULTS, pitch, 0));
  }
  for (const roll of [0, 2, 5, 10]) {
    cases.push(caseAt('roll-' + roll, DEFAULTS, 0, roll));
  }
  cases.push(caseAt('tilt-8-7', makeSetup(api, { slope: 8, bank: 7 }), 0, 0));
  cases.push(caseAt('tilt-10-10', makeSetup(api, { slope: 10, bank: 10 }), 0, 0));
  const maxAttitudeGap = Math.max.apply(null, cases.map((item) => item.gapMm));
  const maxY = Math.max.apply(null, cases.map((item) => item.maxY));
  const fallback = fallbackCase();

  audit.check(
    'B4.5/default-sample',
    def.gapMm <= 1e-3,
    { gapMm: def.gapMm, perCorner: def.perCorner },
    'gapMm <= 1e-3',
    'default pitch impulse, sample 60 ms after start'
  );
  audit.check(
    'B4.5/attitudes',
    maxAttitudeGap <= 1e-3,
    { maxAttitudeGapMm: maxAttitudeGap, cases },
    'max gap <= 1e-3 mm for pitch/roll 0/2/5/10 and 8/7, 10/10 tilt',
    'yaw-only contact versus solved mechanism contact'
  );
  audit.check(
    'B4.5/contact-plane',
    maxY <= 1e-6,
    { maxY },
    'abs(contact.y) <= 1e-6 m',
    'all contacts stay on the road plane'
  );
  audit.check(
    'B4.5/fallback-full-quaternion',
    fallback.maxY <= 1e-6 && fallback.maxVsYawOnlyMm > 10,
    fallback,
    'fallback y <= 1e-6 m and differs from yaw-only by > 10 mm',
    'fallback must use the full quaternion, not the yaw-only formula'
  );
});
