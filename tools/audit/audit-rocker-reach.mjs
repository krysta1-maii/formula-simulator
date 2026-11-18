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

function okOf(solution) {
  if (typeof solution.ok === 'boolean') return solution.ok;
  return Boolean(solution.converged);
}

function run() {
  const sim = api.simCreate(SETUP, { settle: 1.5 });
  api.simApplyImpulse(sim, 'pitch');
  let peakDamping = 0;
  let peakInfo = null;
  let maxResidual = 0;
  let maxResidualInfo = null;
  let maxViolation = 0;
  let firstViolation = null;
  let unreachableOk = 0;
  let okWithResidual = 0;
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  let maxJump = 0;
  let maxJumpStep = -1;
  let maxJumpTime = 0;
  let signFlips = 0;
  let unavailableWhenOk = 0;
  const previous = [null, null, null, null];
  const previousBranch = [null, null, null, null];

  for (let step = 0; step < 1000; step += 1) {
    api.simStep(sim);
    const model = api.simBuildModel(sim);
    const state = sim.state;
    // B1-1 contract: sim.state is the CG; the linkage solver expects the
    // body reference point p = r_CG - R(q)·cgBody.
    const cgBody = [sim.reference.cgBody.x, sim.reference.cgBody.y, sim.reference.cgBody.z];
    const cgArm = api.simQuatRotate([state.qw, state.qx, state.qy, state.qz], cgBody);
    const bodyPos = { x: state.x - cgArm[0], y: state.y - cgArm[1], z: state.z - cgArm[2] };
    const bodyQuat = new api.THREE.Quaternion(state.qx, state.qy, state.qz, state.qw);
    for (let index = 0; index < 4; index += 1) {
      const corner = sim.reference.suspension.corners[index];
      const design = api.suspDesign(corner);
      const solution = api.suspSolveCorner(
        corner,
        bodyPos,
        bodyQuat,
        sim.rackShift || 0,
        sim.cornerSeed[index],
        true
      );
      const ok = okOf(solution);
      const pushPoint = solution.pushPoint;
      const pivot = corner.rocker.pivot;
      const dxy = Math.hypot(pushPoint.x - pivot.x, pushPoint.y - pivot.y);
      const dz = pushPoint.z - pivot.z;
      const radius = Math.hypot(corner.rocker.pushArm.x, corner.rocker.pushArm.y);
      const minReach = Math.hypot(Math.max(0, dxy - radius), dz);
      const violation = minReach - design.pushLen0;
      const rocker = api.suspRockerAngle(corner, pushPoint, corner.rocker.baseAngle);
      const residual = Math.abs(
        api.suspRockerPoint(corner, corner.rocker.pushArm, rocker.angle).distanceTo(pushPoint) - design.pushLen0
      );

      if (residual > maxResidual) {
        maxResidual = residual;
        maxResidualInfo = { corner: index, step, time: sim.time, ok, residualMm: residual * 1000 };
      }
      if (violation > maxViolation) maxViolation = violation;
      if (!firstViolation && violation > 0) {
        firstViolation = {
          corner: index,
          step,
          time: sim.time,
          targetMm: design.pushLen0 * 1000,
          minReachMm: minReach * 1000,
          residualMm: residual * 1000,
          ratio: solution.motionRatio,
          ok
        };
      }
      if (ok && violation > 1e-6) unreachableOk += 1;
      if (ok && residual > 1e-4) okWithResidual += 1;

      const ratio = solution.motionRatio;
      if (ok) {
        if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
          unavailableWhenOk += 1;
        } else {
          minRatio = Math.min(minRatio, ratio);
          maxRatio = Math.max(maxRatio, ratio);
          if (previous[index] !== null) {
            const jump = Math.abs(ratio - previous[index]);
            if (jump > maxJump) {
              maxJump = jump;
              maxJumpStep = step;
              maxJumpTime = sim.time;
            }
            if (Math.sign(ratio) !== Math.sign(previous[index])) signFlips += 1;
          }
          const branch = solution.rocker && solution.rocker.branch;
          if (previousBranch[index] !== null && branch !== 0 && previousBranch[index] !== 0 &&
              branch !== previousBranch[index]) {
            signFlips += 1;
          }
          previous[index] = ratio;
          previousBranch[index] = branch;
        }
      }

      const damping = Math.abs(model.dampingForce[index]);
      if (damping > peakDamping) {
        peakDamping = damping;
        peakInfo = {
          corner: index,
          step,
          time: sim.time,
          dampingN: damping,
          ratio,
          ok
        };
      }
    }
  }

  return {
    peakDampingKN: peakDamping / 1000,
    peakInfo,
    maxResidualMm: maxResidual * 1000,
    maxResidualInfo,
    maxViolationMm: maxViolation * 1000,
    firstViolation,
    unreachableOk,
    okWithResidual,
    minRatio: Number.isFinite(minRatio) ? minRatio : null,
    maxRatio: Number.isFinite(maxRatio) ? maxRatio : null,
    maxJump,
    maxJumpStep,
    maxJumpTime,
    signFlips,
    unavailableWhenOk
  };
}

await runAudit({ audit: 'rocker-reach', group: 'physics', title: 'B4.1 摇臂闭合与运动比' }, (audit) => {
  const result = run();
  audit.check(
    'B4.1/unreachable-ok',
    result.unreachableOk === 0,
    {
      unreachableOk: result.unreachableOk,
      firstViolation: result.firstViolation,
      maxViolationMm: result.maxViolationMm
    },
    'unreachableOk == 0',
    'unreachable geometry must not report ok'
  );
  audit.check(
    'B4.1/ok-residual',
    result.okWithResidual === 0,
    {
      okWithResidual: result.okWithResidual,
      maxResidualMm: result.maxResidualMm,
      maxResidualInfo: result.maxResidualInfo
    },
    'okWithResidual == 0 and residual <= 0.1 mm when ok',
    'rocker closure residual at the solved angle'
  );
  audit.check(
    'B4.1/motion-ratio-range',
    result.unavailableWhenOk === 0 &&
      result.minRatio !== null &&
      result.minRatio >= 0.2 &&
      result.maxRatio <= 2.5,
    {
      minRatio: result.minRatio,
      maxRatio: result.maxRatio,
      unavailableWhenOk: result.unavailableWhenOk
    },
    '0.2 <= ratio <= 2.5 and available when ok',
    'instantaneous motion ratio over the pitch pulse; the horizontal-spring design runs above 1'
  );
  audit.check(
    'B4.1/motion-ratio-continuity',
    result.signFlips === 0 && result.maxJump <= 0.5,
    {
      maxJump: result.maxJump,
      signFlips: result.signFlips,
      maxStep: result.maxJumpStep,
      maxStepTime: result.maxJumpTime
    },
    'signFlips == 0 and maxJump <= 0.5 per 2 ms step',
    '4.1 low-damping large travel changes about 0.32 per step with the 1.27/1.08 design; a branch jump is still rejected'
  );
  audit.check(
    'B4.1/damping-peak',
    result.peakDampingKN <= 15,
    { peakDampingKN: result.peakDampingKN, peakInfo: result.peakInfo },
    'peakDampingKN <= 15',
    'damping must stay within the physical envelope'
  );
});
