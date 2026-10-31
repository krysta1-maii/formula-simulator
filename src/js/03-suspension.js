/* =========================================================================
   03-suspension.js — shared hardpoints and the kinematic suspension solver
   ========================================================================= */

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Hardpoints and design geometry for the four corners.
 *
 * This is the single source of truth shared by the dynamics and the renderer.
 * Body-frame points come from the chassis hardpoints; wheel-local points are
 * expressed in the upright/wheel frame and are rotated by the design camber.
 *
 * The spring-damper unit sits above the rocker: the damper eye is on the same
 * side of the pivot as the push arm, so bump travel shortens the unit and the
 * coil is always in compression.
 */
function buildCornerData(model) {
  return model.wheels.map((wheel, index) => {
    const front = wheel.axle === 'front';
    const zSign = wheel.zSign;
    const innerZ = front ? 0.17 : 0.125;
    const rockerZ = front ? 0.225 : 0.15;
    const body = {
      lowerFront: V(wheel.x + (front ? 0.31 : 0.23), front ? 0.145 : 0.16, zSign * innerZ),
      lowerRear: V(wheel.x - (front ? 0.30 : 0.22), front ? 0.145 : 0.16, zSign * innerZ),
      upperFront: V(wheel.x + (front ? 0.21 : 0.17), front ? 0.345 : 0.355, zSign * (innerZ - 0.025)),
      upperRear: V(wheel.x - (front ? 0.20 : 0.16), front ? 0.345 : 0.355, zSign * (innerZ - 0.025)),
      track: front
        ? V(wheel.x - 0.44, 0.315, zSign * 0.295)
        : V(wheel.x + 0.34, 0.315, zSign * 0.115),
      rocker: V(wheel.x + (front ? -0.42 : 0.30), front ? 0.56 : 0.45, zSign * rockerZ),
      damper: front
        ? V(wheel.x - 0.36, 0.79, zSign * 0.10)
        : V(wheel.x + 0.34, 0.66, zSign * 0.09),
      diff: V(wheel.x + 0.08, 0.30, zSign * 0.17)
    };
    body.trackBase = body.track.clone();
    const wheelLocal = {
      lower: V(0.015, -0.215, -zSign * 0.105),
      upper: V(-0.010, 0.215, -zSign * 0.105),
      track: V(0.100, -0.020, -zSign * 0.105),
      push: front ? V(0.040, -0.185, -zSign * 0.080) : V(0.000, -0.185, -zSign * 0.080),
      drive: V(0.000, 0.000, -zSign * 0.060)
    };
    const rocker = {
      pivot: body.rocker.clone(),
      pushArm: front ? V(0.130, -0.010, 0) : V(-0.130, -0.010, 0),
      damperArm: front ? V(0.070, -0.050, 0) : V(-0.070, -0.050, 0),
      arbArm: front ? V(-0.060, 0.050, 0) : V(0.060, 0.050, 0),
      baseAngle: front ? -0.10 : 0.10,
      gain: 14,
      mesh: null,
      axle: null
    };
    const camber = -zSign * (front ? 1.15 : 0.8) * DEG;
    const restCenter = V(wheel.x, model.dims.R, wheel.z);
    const restQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camber);
    return {
      key: wheel.key,
      index,
      front,
      zSign,
      wheel,
      body,
      wheelLocal,
      rocker,
      restCenter,
      restQuat,
      wheelRoot: null,
      wheelLocalPoints: null,
      pushTip: new THREE.Vector3(),
      damperTip: new THREE.Vector3(),
      arbTip: new THREE.Vector3(),
      angle: rocker.baseAngle,
      tieRodLength0: 0,
      pushRodLength0: 0,
      rackShift: 0,
      rockerSolveFailed: false
    };
  });
}

/* ------------------------------ design geometry ------------------------------ */

function suspRockerPoint(corner, arm, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    corner.rocker.pivot.x + arm.x * cos - arm.y * sin,
    corner.rocker.pivot.y + arm.x * sin + arm.y * cos,
    corner.rocker.pivot.z + arm.z
  );
}

function suspDesign(corner) {
  if (corner.designData) return corner.designData;
  const quat = corner.restQuat;
  const center = corner.restCenter;
  const toBody = (local) => local.clone().applyQuaternion(quat).add(center);
  const anchor = corner.body;
  const BL0 = toBody(corner.wheelLocal.lower);
  const BU0 = toBody(corner.wheelLocal.upper);
  const T0 = toBody(corner.wheelLocal.track);
  const P0 = toBody(corner.wheelLocal.push);
  const D0 = toBody(corner.wheelLocal.drive);
  const line0 = BU0.clone().sub(BL0).normalize();
  const axisL = anchor.lowerFront.clone().sub(anchor.lowerRear).normalize();
  const axisU = anchor.upperFront.clone().sub(anchor.upperRear).normalize();
  const pushTip0 = suspRockerPoint(corner, corner.rocker.pushArm, corner.rocker.baseAngle);
  const damperTip0 = suspRockerPoint(corner, corner.rocker.damperArm, corner.rocker.baseAngle);
  const design = {
    BL0,
    BU0,
    T0,
    P0,
    D0,
    C0: center.clone(),
    line0,
    axisL,
    axisU,
    axisLPoint: anchor.lowerFront.clone(),
    axisUPoint: anchor.upperFront.clone(),
    d0: BU0.distanceTo(BL0),
    tie0: T0.distanceTo(anchor.track),
    pushLen0: pushTip0.distanceTo(P0),
    pushTip0,
    damperTip0,
    damperLength0: damperTip0.distanceTo(anchor.damper),
    innerTrack0: anchor.track.clone(),
    tireRadius: center.y,
    restQuat: quat.clone()
  };
  corner.designData = design;
  return design;
}

/* ------------------------------ mechanism solve ------------------------------ */

function suspSolve3(J, b) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(J);
  if (!Number.isFinite(D) || Math.abs(D) < 1e-14) return null;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    const M = [[J[0][0], J[0][1], J[0][2]], [J[1][0], J[1][1], J[1][2]], [J[2][0], J[2][1], J[2][2]]];
    for (let i = 0; i < 3; i += 1) M[i][k] = b[i];
    out[k] = det(M) / D;
  }
  return out.every(Number.isFinite) ? out : null;
}

function suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin) {
  const d = suspDesign(corner);
  const inlet = d.innerTrack0.clone();
  if (corner.front) inlet.z += rackShift;
  const BL = d.BL0.clone().sub(d.axisLPoint).applyAxisAngle(d.axisL, thL).add(d.axisLPoint);
  const BU = d.BU0.clone().sub(d.axisUPoint).applyAxisAngle(d.axisU, thU).add(d.axisUPoint);
  const line = BU.clone().sub(BL).normalize();
  const q0 = new THREE.Quaternion().setFromUnitVectors(d.line0, line);
  const qSpin = new THREE.Quaternion().setFromAxisAngle(line, spin);
  const qU = qSpin.multiply(q0);
  const place = (p) => p.clone().sub(d.BL0).applyQuaternion(qU).add(BL);
  const C = place(d.C0);
  const T = place(d.T0);
  const P = place(d.P0);
  const axle = new THREE.Vector3(0, 0, 1).applyQuaternion(d.restQuat).applyQuaternion(qU);
  const inv = bodyQuat ? bodyQuat.clone().invert() : new THREE.Quaternion();
  const nb = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
  const cb = -bodyPos.y;
  const downProjection = Math.sqrt(Math.max(0, 1 - Math.pow(nb.dot(axle), 2)));
  const f = [
    BU.distanceTo(BL) - d.d0,
    T.distanceTo(inlet) - d.tie0,
    nb.dot(C) - d.tireRadius * downProjection - cb
  ];
  return { f, BL, BU, C, T, P, qU, axle, nb, cb, downProjection, wheelQuat: qU.clone().multiply(d.restQuat) };
}

function suspSolveRaw(corner, bodyPos, bodyQuat, rackShift, seed, cold) {
  const start = seed && !cold ? seed : { thL: 0, thU: 0, spin: 0 };
  let thL = start.thL || 0;
  let thU = start.thU || 0;
  let spin = start.spin || 0;
  let best = null;
  let bestNorm = Infinity;
  for (let iter = 0; iter < 12; iter += 1) {
    const e = suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin);
    const norm = Math.max(Math.abs(e.f[0]), Math.abs(e.f[1]), Math.abs(e.f[2]));
    if (norm < bestNorm) {
      bestNorm = norm;
      best = e;
    }
    if (norm < 1e-10) break;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const eps = 1e-6;
    const eL = suspEval(corner, bodyPos, bodyQuat, rackShift, thL + eps, thU, spin);
    const eU = suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU + eps, spin);
    const eS = suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin + eps);
    for (let i = 0; i < 3; i += 1) {
      J[i][0] = (eL.f[i] - e.f[i]) / eps;
      J[i][1] = (eU.f[i] - e.f[i]) / eps;
      J[i][2] = (eS.f[i] - e.f[i]) / eps;
    }
    const delta = suspSolve3(J, [-e.f[0], -e.f[1], -e.f[2]]);
    if (!delta) break;
    const scale = Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2]));
    const limiter = scale > 0.25 ? 0.25 / scale : 1;
    thL += delta[0] * limiter;
    thU += delta[1] * limiter;
    spin += delta[2] * limiter;
    if (!Number.isFinite(thL) || !Number.isFinite(thU) || !Number.isFinite(spin)) break;
  }
  const final = suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin);
  const norm = Math.max(Math.abs(final.f[0]), Math.abs(final.f[1]), Math.abs(final.f[2]));
  const converged = norm < 1e-6;
  return {
    thL,
    thU,
    spin,
    converged,
    error: norm,
    evalState: final
  };
}

function suspRockerAngle(corner, pushPoint, seed) {
  const d = suspDesign(corner);
  const target = d.pushLen0;
  let angle = Number.isFinite(seed) ? seed : corner.rocker.baseAngle;
  const distance = (a) => suspRockerPoint(corner, corner.rocker.pushArm, a).distanceTo(pushPoint);
  for (let i = 0; i < 24; i += 1) {
    const error = distance(angle) - target;
    if (Math.abs(error) < 1e-11) break;
    const h = 1e-5;
    const derivative = (distance(angle + h) - distance(angle - h)) / (2 * h);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-9) break;
    angle -= Math.max(-0.25, Math.min(0.25, error / derivative));
    if (!Number.isFinite(angle)) {
      angle = seed;
      break;
    }
  }
  return angle;
}

function suspCoilLength(corner, angle) {
  return suspRockerPoint(corner, corner.rocker.damperArm, angle).distanceTo(corner.body.damper);
}

/**
 * Solve one corner at a body pose. The returned pose is in the body frame.
 * motionRatio is the conventional value (compression per unit bump travel).
 */
function suspSolveCorner(corner, bodyPos, bodyQuat, rackShift, seed, withRatio) {
  let raw = suspSolveRaw(corner, bodyPos, bodyQuat, rackShift, seed, false);
  if (!raw.converged) {
    const cold = suspSolveRaw(corner, bodyPos, bodyQuat, rackShift, null, true);
    if (cold.error < raw.error) raw = cold;
  }
  const state = raw.evalState;
  const angle = suspRockerAngle(corner, state.P, corner.angle);
  const coilLength = suspCoilLength(corner, angle);
  let motionRatio = null;
  const epsilon = 1e-3;
  if (withRatio) {
    const high = suspSolveRaw(corner, { x: bodyPos.x, y: bodyPos.y + epsilon, z: bodyPos.z }, bodyQuat, rackShift, raw, false);
    const low = suspSolveRaw(corner, { x: bodyPos.x, y: bodyPos.y - epsilon, z: bodyPos.z }, bodyQuat, rackShift, raw, false);
    if (high.converged && low.converged) {
      const lHigh = suspCoilLength(corner, suspRockerAngle(corner, high.evalState.P, angle));
      const lLow = suspCoilLength(corner, suspRockerAngle(corner, low.evalState.P, angle));
      motionRatio = (lHigh - lLow) / (2 * epsilon);
    }
  }
  const d = suspDesign(corner);
  const down = state.nb.clone().multiplyScalar(-1);
  down.addScaledVector(state.axle, -down.dot(state.axle));
  if (down.lengthSq() > 1e-12) down.normalize(); else down.set(0, -1, 0);
  const contact = state.C.clone().addScaledVector(down, d.tireRadius);
  return {
    thL: raw.thL,
    thU: raw.thU,
    spin: raw.spin,
    converged: raw.converged,
    error: raw.error,
    wheelPos: state.C.clone(),
    wheelQuat: state.wheelQuat.clone(),
    contact,
    pushPoint: state.P.clone(),
    rockerAngle: angle,
    coilLength,
    motionRatio,
    seed: { thL: raw.thL, thU: raw.thU, spin: raw.spin }
  };
}

function suspWheelSteer(quat) {
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  return Math.atan2(-dir.z, dir.x);
}

/**
 * Find the rack displacement that makes the mean front wheel angle match the
 * driver input. Called only when the steering input or the design changes.
 */
function suspRackForSteer(corners, bodyPos, bodyQuat, steerRad) {
  const fronts = corners.filter((corner) => corner.front);
  if (!fronts.length) return 0;
  const meanAt = (shift) => {
    let sum = 0;
    for (const corner of fronts) {
      const solved = suspSolveRaw(corner, bodyPos, bodyQuat, shift, corner.rackSeed, false);
      corner.rackSeed = { thL: solved.thL, thU: solved.thU, spin: solved.spin };
      sum += suspWheelSteer(solved.evalState.wheelQuat);
    }
    return sum / fronts.length;
  };
  let lo = -0.12;
  let hi = 0.12;
  let loAngle = meanAt(lo);
  let hiAngle = meanAt(hi);
  if (loAngle > hiAngle) {
    const tmp = lo; lo = hi; hi = tmp;
    const tmpA = loAngle; loAngle = hiAngle; hiAngle = tmpA;
  }
  if (steerRad <= loAngle) return lo;
  if (steerRad >= hiAngle) return hi;
  for (let i = 0; i < 42; i += 1) {
    const mid = 0.5 * (lo + hi);
    const value = meanAt(mid);
    if (value < steerRad) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/* ------------------------------ design-row helpers ------------------------------ */

function suspensionBuild(model) {
  const corners = buildCornerData(model);
  return {
    corners,
    byKey: corners.reduce((acc, corner) => { acc[corner.key] = corner; return acc; }, {})
  };
}
