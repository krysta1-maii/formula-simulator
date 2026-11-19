#!/usr/bin/env node
import { runAudit, loadPhysics, makeSetup } from './_harness.mjs';

const api = loadPhysics();
const SETUP = makeSetup(api, {});
const YAW_DEGREES = [];
for (let deg = 0; deg < 360; deg += 15) YAW_DEGREES.push(deg);

const PITCH_FORCE = [0, -6200, 0];

function expectedBodyMoment(sim) {
  const cg = sim.reference.cgBody;
  const lever = [0.95 - cg.x, 0 - cg.y, 0 - cg.z];
  return api.simCross(lever, PITCH_FORCE);
}

function evaluateAt(yawDeg) {
  const yaw = yawDeg * Math.PI / 180;
  const q = api.simQuatFromEuler(yaw, 0, 0);
  const base = api.simCreate(SETUP);
  base.state.qw = q[0];
  base.state.qx = q[1];
  base.state.qy = q[2];
  base.state.qz = q[3];
  const baseEval = api.simEvaluate(base);

  const impulse = api.simCreate(SETUP);
  impulse.state.qw = q[0];
  impulse.state.qx = q[1];
  impulse.state.qy = q[2];
  impulse.state.qz = q[3];
  api.simApplyImpulse(impulse, 'pitch');
  const impulseEval = api.simEvaluate(impulse);

  const road = impulseEval.moment.map((value, index) => value - baseEval.moment[index]);
  const body = api.simQuatRotateInverse(q, road);
  const expected = expectedBodyMoment(base);
  const bodyError = Math.max.apply(null, body.map((value, index) => Math.abs(value - expected[index])));
  const magnitudeError = Math.abs(Math.hypot(road[0], road[1], road[2]) - Math.hypot(expected[0], expected[1], expected[2]));
  return { yawDeg, road, body, expected, bodyError, magnitudeError };
}

await runAudit({ audit: 'impulse-frame', group: 'contact', title: 'B4.4 脉冲作用点坐标系' }, (audit) => {
  const samples = YAW_DEGREES.map(evaluateAt);
  const maxBodyError = Math.max.apply(null, samples.map((sample) => sample.bodyError));
  const maxMagnitudeError = Math.max.apply(null, samples.map((sample) => sample.magnitudeError));
  const yaw90 = samples.find((sample) => sample.yawDeg === 90);

  audit.check(
    'B4.4/body-moment',
    maxBodyError <= 1e-9,
    {
      maxBodyError,
      expected: yaw90 ? yaw90.expected : null,
      yaw0Body: samples[0] ? samples[0].body : null,
      yaw90Body: yaw90 ? yaw90.body : null
    },
    'maxBodyError <= 1e-9 N m over 24 yaw attitudes',
    'body-frame impulse moment after R(q)'
  );
  audit.check(
    'B4.4/road-magnitude',
    maxMagnitudeError <= 1e-9,
    { maxMagnitudeError, expectedMagnitude: Math.hypot(6880.45, 0, 0) },
    'abs(|M| - 6880.45) <= 1e-9',
    'moment magnitude is invariant under rotation'
  );
  audit.check(
    'B4.4/yaw90-axis',
    Boolean(yaw90) && Math.abs(yaw90.body[0]) <= 1e-9 && Math.abs(yaw90.body[2] + 6880.45) <= 1e-9,
    { yaw90Body: yaw90 ? yaw90.body : null },
    'yaw 90 body moment = (0, 0, -6880.45)',
    'the pitch lever must not become a roll moment'
  );
});
