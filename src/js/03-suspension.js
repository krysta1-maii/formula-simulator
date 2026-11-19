/* =========================================================================
   03-suspension.js — shared hardpoints and the kinematic suspension solver
   ========================================================================= */

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Motion-ratio guard rails. The current front/rear linkage intentionally runs
// above 1 (about 1.27 and 1.01), so a solved corner is valid up to 2.5. The
// instantaneous ratio state in 05-body-dynamics shares the same ceiling; the
// lower bound and the design-relative check remain in force.
const SUSP_RATIO_MIN = 0.2;
const SUSP_RATIO_MAX = 2.5;
const SUSP_INSTANT_RATIO_MIN = 0.05;

/**
 * Hardpoints and design geometry for the four corners.
 *
 * This is the single source of truth shared by the dynamics and the renderer.
 * Body-frame points come from the chassis hardpoints; wheel-local points are
 * expressed in the upright/wheel frame and are rotated by the design camber.
 *
 * The layout is the current-generation pull/push-rod arrangement: the front
 * corners drive the rockers through a pushrod from the lower upright, the rear
 * corners drive them through a pullrod from the upper upright. Each rocker
 * carries a longitudinal, near-horizontal spring-damper unit; bump travel
 * rotates the rocker and shortens the unit. The steering arms sit close to the
 * upright centre height to keep bump steer small.
 */
function buildCornerData(model) {
  return model.wheels.map((wheel, index) => {
    const front = wheel.axle === 'front';
    const zSign = wheel.zSign;
    const innerZ = front ? 0.17 : 0.125;
    const body = {
      lowerFront: V(wheel.x + (front ? 0.31 : 0.23), front ? 0.145 : 0.16, zSign * innerZ),
      lowerRear: V(wheel.x - (front ? 0.30 : 0.22), front ? 0.145 : 0.16, zSign * innerZ),
      upperFront: V(wheel.x + (front ? 0.21 : 0.17), front ? 0.345 : 0.355, zSign * (innerZ - 0.025)),
      upperRear: V(wheel.x - (front ? 0.20 : 0.16), front ? 0.345 : 0.355, zSign * (innerZ - 0.025)),
      track: front
        ? V(wheel.x - 0.100, 0.256, zSign * 0.250)
        : V(wheel.x + 0.055, 0.258, zSign * 0.160),
      rocker: front
        ? V(wheel.x - 0.3335555968, 0.4763013204, zSign * 0.1703457239)
        : V(wheel.x + 0.2301430269, 0.2200000000, zSign * 0.0750000000),
      damper: front
        ? V(wheel.x - 0.8181192550, 0.4072443937, zSign * 0.1066914327)
        : V(wheel.x + 0.6536795738, 0.3632529467, zSign * 0.0200000000),
      diff: V(wheel.x + 0.08, 0.30, zSign * 0.17)
    };
    body.trackBase = body.track.clone();
    const wheelLocal = {
      lower: V(0.015, -0.215, -zSign * 0.105),
      upper: V(-0.010, 0.215, -zSign * 0.105),
      track: V(-0.100, -0.020, -zSign * 0.105),
      push: front ? V(0.040, -0.185, -zSign * 0.080) : V(0.000, 0.2129498711, -zSign * 0.080),
      drive: V(0.000, 0.000, -zSign * 0.060)
    };
    const rocker = {
      pivot: body.rocker.clone(),
      pushArm: front ? V(-0.0513243542, -0.0400570614, 0) : V(-0.0546044635, 0.0353022808, 0),
      damperArm: front ? V(-0.1004629500, -0.1372333569, 0) : V(0.0714106700, 0.1426098111, 0),
      arbArm: front ? V(-0.045, 0.020, 0) : V(0.050, 0.030, 0),
      baseAngle: 0,
      gain: front ? 7.4 : 6.8,
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

let SUSP_EVAL_COUNT = 0;

function suspEvalReset() {
  SUSP_EVAL_COUNT = 0;
}

function suspEvalCount() {
  return SUSP_EVAL_COUNT;
}

function suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin) {
  SUSP_EVAL_COUNT += 1;
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

function suspJacobianAt(corner, bodyPos, bodyQuat, rackShift, e, thL, thU, spin) {
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
  return J;
}

function suspJacobianAnalytic(corner, state, rackShift, thL, thU, spin) {
  const d = suspDesign(corner);
  const line = state.BU.clone().sub(state.BL).normalize();
  const segLen = state.BU.distanceTo(state.BL);
  if (!(segLen > 1e-12)) return null;
  const q0 = new THREE.Quaternion().setFromUnitVectors(d.line0, line);
  const qSpin = new THREE.Quaternion().setFromAxisAngle(line, spin);
  const qU = state.qU;
  if (!qU) return null;
  const project = (v) => v.clone().sub(line.clone().multiplyScalar(line.dot(v)));
  const omegaOf = (dqU) => {
    const conj = new THREE.Quaternion(-qU.x, -qU.y, -qU.z, qU.w);
    const prod = new THREE.Quaternion().multiplyQuaternions(dqU, conj);
    return new THREE.Vector3(2 * prod.x, 2 * prod.y, 2 * prod.z);
  };
  const q0Derivative = (dLine) => {
    const axd = new THREE.Vector3().crossVectors(d.line0, dLine);
    const ad = d.line0.dot(dLine);
    const nrm = (1 + d.line0.dot(line)) / q0.w;
    return new THREE.Quaternion(
      (axd.x - (ad * q0.x) / nrm) / nrm,
      (axd.y - (ad * q0.y) / nrm) / nrm,
      (axd.z - (ad * q0.z) / nrm) / nrm,
      (ad - (ad * q0.w) / nrm) / nrm
    );
  };
  const dBL = new THREE.Vector3().crossVectors(d.axisL, state.BL.clone().sub(d.axisLPoint));
  const dBU = new THREE.Vector3().crossVectors(d.axisU, state.BU.clone().sub(d.axisUPoint));
  const dLineL = project(dBL.clone().negate()).divideScalar(segLen);
  const dLineU = project(dBU).divideScalar(segLen);
  const omegaL = omegaOf(qSpin.clone().multiply(q0Derivative(dLineL)));
  const omegaU = omegaOf(qSpin.clone().multiply(q0Derivative(dLineU)));
  const omegaS = omegaOf(new THREE.Quaternion(0.5 * line.x, 0.5 * line.y, 0.5 * line.z, 0).multiply(qU));
  const inlet = d.innerTrack0.clone();
  if (corner.front) inlet.z += rackShift || 0;
  const tVec = state.T.clone().sub(inlet);
  const tLen = tVec.length();
  const f1Dir = tLen > 1e-12 ? tVec.clone().divideScalar(tLen) : new THREE.Vector3();
  const nb = state.nb;
  const down = state.downProjection;
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cols = [
    { bl: dBL, bu: null, omega: omegaL },
    { bl: null, bu: dBU, omega: omegaU },
    { bl: null, bu: null, omega: omegaS }
  ];
  for (let c = 0; c < 3; c += 1) {
    const col = cols[c];
    const bl = col.bl || new THREE.Vector3();
    const bu = col.bu || new THREE.Vector3();
    J[0][c] = line.dot(bu.clone().sub(bl));
    const dT = new THREE.Vector3().crossVectors(col.omega, state.T.clone().sub(state.BL)).add(bl);
    J[1][c] = f1Dir.dot(dT);
    const dC = new THREE.Vector3().crossVectors(col.omega, state.C.clone().sub(state.BL)).add(bl);
    const dAxle = new THREE.Vector3().crossVectors(col.omega, state.axle.clone());
    const nbDotAxle = nb.dot(state.axle);
    const dDown = down > 1e-9 ? -(nbDotAxle * nb.dot(dAxle)) / down : 0;
    J[2][c] = nb.dot(dC) - d.tireRadius * dDown;
  }
  return J;
}

function suspSolveRaw(corner, bodyPos, bodyQuat, rackShift, seed, cold) {
  const start = seed && !cold ? seed : { thL: 0, thU: 0, spin: 0 };
  let thL = start.thL || 0;
  let thU = start.thU || 0;
  let spin = start.spin || 0;
  let best = null;
  let bestNorm = Infinity;
  let lastJ = null;
  let final = null;
  for (let iter = 0; iter < 12; iter += 1) {
    const e = suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin);
    const norm = Math.max(Math.abs(e.f[0]), Math.abs(e.f[1]), Math.abs(e.f[2]));
    if (norm < bestNorm) {
      bestNorm = norm;
      best = e;
    }
    if (norm < 1e-9) {
      final = e;
      break;
    }
    const analyticJ = suspJacobianAnalytic(corner, e, rackShift, thL, thU, spin);
    const J = (analyticJ && analyticJ.every((row) => row.every(Number.isFinite)))
      ? analyticJ
      : suspJacobianAt(corner, bodyPos, bodyQuat, rackShift, e, thL, thU, spin);
    lastJ = J;
    const delta = suspSolve3(J, [-e.f[0], -e.f[1], -e.f[2]]);
    if (!delta) break;
    const scale = Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2]));
    const limiter = scale > 0.25 ? 0.25 / scale : 1;
    thL += delta[0] * limiter;
    thU += delta[1] * limiter;
    spin += delta[2] * limiter;
    if (!Number.isFinite(thL) || !Number.isFinite(thU) || !Number.isFinite(spin)) break;
  }
  const finalEval = final || suspEval(corner, bodyPos, bodyQuat, rackShift, thL, thU, spin);
  const norm = Math.max(Math.abs(finalEval.f[0]), Math.abs(finalEval.f[1]), Math.abs(finalEval.f[2]));
  const converged = norm < 1e-6;
  const analyticFinal = suspJacobianAnalytic(corner, finalEval, rackShift, thL, thU, spin);
  // Prefer the Jacobian evaluated at the converged state. lastJ belongs to the
  // previous Newton iterate and biases the analytic motion ratio when the seed
  // chain is already close: the cold and warm paths must report the same ratio.
  const jacobian =
    ((analyticFinal && analyticFinal.every((row) => row.every(Number.isFinite))) ? analyticFinal : null) ||
    lastJ ||
    suspJacobianAt(corner, bodyPos, bodyQuat, rackShift, finalEval, thL, thU, spin);
  return {
    thL,
    thU,
    spin,
    converged,
    error: norm,
    evalState: finalEval,
    jacobian
  };
}

function suspRockerResidual(corner, pushPoint, angle) {
  return Math.abs(suspRockerPoint(corner, corner.rocker.pushArm, angle).distanceTo(pushPoint) - suspDesign(corner).pushLen0);
}

/**
 * Legacy Newton solver, kept only as a numerical reference for tests.
 * Production code uses the closed-form suspRockerAngle below.
 */
function suspRockerAngleNewton(corner, pushPoint, seed) {
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

/**
 * Closed-form pushrod-rocker closure. The rocker tip travels on a circle of
 * radius rho about the pivot; the pushrod length fixes its distance to the
 * push point, so the two circle intersections give at most two branches.
 */
function suspRockerAngle(corner, pushPoint, seed) {
  const d = suspDesign(corner);
  const target = d.pushLen0;
  const pivot = corner.rocker.pivot;
  const arm = corner.rocker.pushArm;
  const rho = Math.hypot(arm.x, arm.y);
  const phi = Math.atan2(arm.y, arm.x);
  const ux = pushPoint.x - pivot.x;
  const uy = pushPoint.y - pivot.y;
  const uz = pushPoint.z - (pivot.z + arm.z);
  const a = Math.hypot(ux, uy);
  const seedAngle = Number.isFinite(seed) ? seed : corner.rocker.baseAngle;
  const residualAt = (angle) => suspRockerResidual(corner, pushPoint, angle);
  const alpha = Math.atan2(uy, ux);
  const base = alpha - phi;
  const pickNearest = (candidates) => {
    let best = seedAngle;
    let bestResidual = Infinity;
    for (const angle of candidates) {
      const residual = residualAt(angle);
      if (residual < bestResidual) {
        bestResidual = residual;
        best = angle;
      }
    }
    return { angle: best, residual: bestResidual };
  };
  const D2 = target * target - uz * uz;
  if (a < 1e-12 || D2 < 0) {
    // Unreachable: hold the seeded angle instead of jumping to a tangent
    // point, so the seed chain stays on the assembly branch and recovers
    // smoothly when the geometry becomes reachable again.
    const held = Number.isFinite(seedAngle) ? seedAngle : base;
    return { angle: held, residual: residualAt(held), feasible: false, branch: 0 };
  }
  const c = (rho * rho + a * a - D2) / (2 * rho * a);
  if (!Number.isFinite(c) || Math.abs(c) > 1 + 1e-12) {
    const held = Number.isFinite(seedAngle) ? seedAngle : base;
    return { angle: held, residual: residualAt(held), feasible: false, branch: 0 };
  }
  const psi = Math.acos(Math.max(-1, Math.min(1, c)));
  const candidates = [base + psi, base - psi];
  const useFirst = Math.abs(candidates[0] - seedAngle) <= Math.abs(candidates[1] - seedAngle);
  const angle = useFirst ? candidates[0] : candidates[1];
  const residual = residualAt(angle);
  const degenerate = psi < 1e-9 || Math.PI - psi < 1e-9;
  return {
    angle,
    residual,
    feasible: residual <= 1e-9,
    branch: degenerate ? 0 : (useFirst ? 1 : -1)
  };
}

function suspCoilLength(corner, angle) {
  return suspRockerPoint(corner, corner.rocker.damperArm, angle).distanceTo(corner.body.damper);
}

/** Close the visible rocker to a bounded equivalent coil length. */
function suspRockerAngleForCoil(corner, requestedLength, seed) {
  const pivot = corner.rocker.pivot;
  const arm = corner.rocker.damperArm;
  const targetPoint = corner.body.damper;
  const rho = Math.hypot(arm.x, arm.y);
  const phi = Math.atan2(arm.y, arm.x);
  const ux = targetPoint.x - pivot.x;
  const uy = targetPoint.y - pivot.y;
  const uz = targetPoint.z - (pivot.z + arm.z);
  const a = Math.hypot(ux, uy);
  const minLength = Math.sqrt(uz * uz + Math.max(0, a - rho) ** 2);
  const maxLength = Math.sqrt(uz * uz + (a + rho) ** 2);
  const target = clamp(Number.isFinite(requestedLength) ? requestedLength : minLength, minLength, maxLength);
  const seedAngle = Number.isFinite(seed) ? seed : corner.rocker.baseAngle;
  const D2 = target * target - uz * uz;
  const c = a > 1e-12 && rho > 1e-12 ? (rho * rho + a * a - D2) / (2 * rho * a) : 1;
  const psi = Math.acos(clamp(c, -1, 1));
  const base = Math.atan2(uy, ux) - phi;
  const candidates = [base + psi, base - psi];
  const angle = Math.abs(candidates[0] - seedAngle) <= Math.abs(candidates[1] - seedAngle)
    ? candidates[0] : candidates[1];
  return { angle, length: suspCoilLength(corner, angle), target };
}

/**
 * Analytic motion ratio. The linkage constraints depend on the reference-point
 * height y through f(q; y) = 0 with df/dy = [0, 0, 1]; the implicit derivative
 * dq/dy then propagates through the push point P and the pushrod closure.
 */
function suspMotionRatioAnalytic(corner, state, raw, rockerAngle) {
  const d = suspDesign(corner);
  if (!raw.jacobian) return null;
  const dqdy = suspSolve3(raw.jacobian, [0, 0, -1]);
  if (!dqdy || !dqdy.every(Number.isFinite)) return null;
  const dthL = dqdy[0];
  const dthU = dqdy[1];
  const dspin = dqdy[2];
  const line = state.BU.clone().sub(state.BL).normalize();
  const segLen = state.BU.distanceTo(state.BL);
  if (segLen < 1e-12) return null;
  const q0 = new THREE.Quaternion().setFromUnitVectors(d.line0, line);
  const qSpin = new THREE.Quaternion().setFromAxisAngle(line, raw.spin);
  const qU = state.qU;
  if (!qU) return null;
  const project = (v) => v.clone().sub(line.clone().multiplyScalar(line.dot(v)));
  const omegaOf = (dqU) => {
    const conj = new THREE.Quaternion(-qU.x, -qU.y, -qU.z, qU.w);
    const prod = new THREE.Quaternion().multiplyQuaternions(dqU, conj);
    return new THREE.Vector3(2 * prod.x, 2 * prod.y, 2 * prod.z);
  };
  const q0Derivative = (dLine) => {
    const axd = new THREE.Vector3().crossVectors(d.line0, dLine);
    const ad = d.line0.dot(dLine);
    const nrm = (1 + d.line0.dot(line)) / q0.w;
    return new THREE.Quaternion(
      (axd.x - (ad * q0.x) / nrm) / nrm,
      (axd.y - (ad * q0.y) / nrm) / nrm,
      (axd.z - (ad * q0.z) / nrm) / nrm,
      (ad - (ad * q0.w) / nrm) / nrm
    );
  };
  const dBL = new THREE.Vector3().crossVectors(d.axisL, state.BL.clone().sub(d.axisLPoint));
  const dLineL = project(dBL.clone().negate()).divideScalar(segLen);
  const dP_L = dBL.clone().add(new THREE.Vector3().crossVectors(
    omegaOf(qSpin.clone().multiply(q0Derivative(dLineL))),
    state.P.clone().sub(state.BL)
  ));
  const dBU = new THREE.Vector3().crossVectors(d.axisU, state.BU.clone().sub(d.axisUPoint));
  const dLineU = project(dBU).divideScalar(segLen);
  const dP_U = new THREE.Vector3().crossVectors(
    omegaOf(qSpin.clone().multiply(q0Derivative(dLineU))),
    state.P.clone().sub(state.BL)
  );
  const dP_S = new THREE.Vector3().crossVectors(line, state.P.clone().sub(state.BL));
  const dPdy = dP_L.multiplyScalar(dthL).add(dP_U.multiplyScalar(dthU)).add(dP_S.multiplyScalar(dspin));
  const cos = Math.cos(rockerAngle);
  const sin = Math.sin(rockerAngle);
  const pushArm = corner.rocker.pushArm;
  const tip = suspRockerPoint(corner, pushArm, rockerAngle);
  const dTip = new THREE.Vector3(-pushArm.x * sin - pushArm.y * cos, pushArm.x * cos - pushArm.y * sin, 0);
  const w = tip.clone().sub(state.P);
  const denom = w.dot(dTip);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return null;
  const dTheta = w.dot(dPdy) / denom;
  const damperArm = corner.rocker.damperArm;
  const damperTip = suspRockerPoint(corner, damperArm, rockerAngle);
  const dDamperTip = new THREE.Vector3(
    -damperArm.x * sin - damperArm.y * cos,
    damperArm.x * cos - damperArm.y * sin,
    0
  );
  const v = damperTip.clone().sub(corner.body.damper);
  const vLen = v.length();
  if (vLen < 1e-12) return null;
  const dLdTheta = v.dot(dDamperTip) / vLen;
  const ratio = dLdTheta * dTheta;
  return Number.isFinite(ratio) ? ratio : null;
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
  const seedAngle = seed && Number.isFinite(seed.rockerAngle) ? seed.rockerAngle : corner.rocker.baseAngle;
  let rocker = suspRockerAngle(corner, state.P, seedAngle);
  let coilLength = suspCoilLength(corner, rocker.angle);
  let motionRatio = null;
  let motionRatioState = 'unavailable';
  if (withRatio) {
    const ratio = suspMotionRatioAnalytic(corner, state, raw, rocker.angle);
    if (ratio != null && Number.isFinite(ratio)) {
      motionRatio = ratio;
      motionRatioState = (ratio > SUSP_RATIO_MIN && ratio < SUSP_RATIO_MAX) ? 'ok' : 'unavailable';
    }
  }
  const frame = { converged: raw.converged, error: raw.error };
  const ok = frame.converged && rocker.feasible && motionRatioState === 'ok';
  const d = suspDesign(corner);
  const down = state.nb.clone().multiplyScalar(-1);
  down.addScaledVector(state.axle, -down.dot(state.axle));
  if (down.lengthSq() > 1e-12) down.normalize(); else down.set(0, -1, 0);
  const contact = state.C.clone().addScaledVector(down, d.tireRadius);
  // B2-3: one road-frame contact point and one road-frame wheel centre per
  // corner; this is the single source consumed by forces, telemetry and the
  // renderer. contactBody/wheelPosBody stay available for the mechanism.
  const wheelPosBody = state.C.clone();
  const contactBody = contact.clone();
  const bodyOrigin = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
  const wheelPosRoad = wheelPosBody.clone().applyQuaternion(bodyQuat).add(bodyOrigin);
  const contactRoad = contactBody.clone().applyQuaternion(bodyQuat).add(bodyOrigin);
  let pushPoint = state.P.clone();
  if (!ok && Number.isFinite(contactRoad.y)) {
    // A failed frame solve must not leak an off-plane contact or a second,
    // unrelated coil length into forces and rendering. Translate the complete
    // upright so its contact lies on the road, then close the rocker and coil
    // again at that same projected pose. Wishbone/tie closure remains degraded
    // through frame.converged=false; there is no hidden exact-solution claim.
    const correctionRoad = new THREE.Vector3(0, -contactRoad.y, 0);
    contactRoad.add(correctionRoad);
    wheelPosRoad.add(correctionRoad);
    const correctionBody = correctionRoad.clone().applyQuaternion(bodyQuat.clone().invert());
    wheelPosBody.add(correctionBody);
    contactBody.add(correctionBody);
    pushPoint.add(correctionBody);
    rocker = suspRockerAngle(corner, pushPoint, seedAngle);
    coilLength = suspCoilLength(corner, rocker.angle);
    motionRatio = null;
    motionRatioState = 'unavailable';
  }
  return {
    thL: raw.thL,
    thU: raw.thU,
    spin: raw.spin,
    frame,
    rocker,
    coilLength,
    motionRatio,
    motionRatioState,
    ok,
    seed: { thL: raw.thL, thU: raw.thU, spin: raw.spin, rockerAngle: rocker.angle },
    converged: raw.converged,
    error: raw.error,
    wheelPos: wheelPosBody.clone(),
    wheelQuat: state.wheelQuat.clone(),
    contact: contactBody.clone(),
    contactBody,
    wheelPosBody,
    contactRoad,
    wheelPosRoad,
    pushPoint,
    rockerAngle: rocker.angle
  };
}

function suspWheelSteer(quat) {
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  return Math.atan2(-dir.z, dir.x);
}

// Rack calibration envelope. The fresh front geometry needs about 32.2 mm of
// rack travel for 18 deg of steer, so the scan covers +/-60 mm and is sampled
// before bisection. The bracket must be monotonic; every sample starts the
// corner solve cold so a previous branch or seed can never leak into this
// calibration (and no corner.rackSeed is written).
const SUSP_RACK_SCAN_RANGE = 0.060;
const SUSP_RACK_SCAN_STEPS = 24;
const SUSP_RACK_BISECT_ROUNDS = 42;
const SUSP_RACK_SHIFT_EPS = 1e-10;

/**
 * Find the rack displacement that makes the mean front wheel angle match the
 * driver input. Called only when the steering input or the design changes.
 *
 * The mean angle curve is monotonic in this geometry. The routine first scans
 * the full envelope, records every sign-changing bracket, prefers a bracket
 * whose local slope agrees with the global slope, then bisects it with cold
 * solves. Returns a number; callers keep their existing numeric contract.
 */
function suspRackForSteer(corners, bodyPos, bodyQuat, steerRad) {
  const fronts = corners.filter((corner) => corner.front);
  if (!fronts.length) return 0;
  const target = Number.isFinite(steerRad) ? steerRad : 0;
  const meanAt = (shift) => {
    let sum = 0;
    for (const corner of fronts) {
      // Cold solve: no persistent rack seed, no branch inherited from the
      // caller's physics state. The calibration is therefore repeatable and
      // independent of whatever the sim seeds currently hold.
      const solved = suspSolveRaw(corner, bodyPos, bodyQuat, shift, null, true);
      if (!solved.converged) return NaN;
      sum += suspWheelSteer(solved.evalState.wheelQuat);
    }
    return sum / fronts.length;
  };
  const samples = [];
  const step = (2 * SUSP_RACK_SCAN_RANGE) / SUSP_RACK_SCAN_STEPS;
  let direction = 0;
  let monotonic = true;
  let previous = null;
  let minSample = null;
  let maxSample = null;
  for (let i = 0; i <= SUSP_RACK_SCAN_STEPS; i += 1) {
    const shift = -SUSP_RACK_SCAN_RANGE + i * step;
    const angle = meanAt(shift);
    if (!Number.isFinite(angle)) continue;
    const sample = { shift, angle };
    samples.push(sample);
    if (!minSample || angle < minSample.angle) minSample = sample;
    if (!maxSample || angle > maxSample.angle) maxSample = sample;
    if (previous) {
      const delta = angle - previous.angle;
      if (Math.abs(delta) > 1e-12) {
        const sign = Math.sign(delta);
        if (direction === 0) direction = sign;
        else if (sign !== direction) monotonic = false;
      }
    }
    previous = sample;
  }
  if (!samples.length) return 0;
  const brackets = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const da = a.angle - target;
    const db = b.angle - target;
    if (da === 0) return a.shift;
    if (db === 0) return b.shift;
    if (da * db < 0) {
      const slope = (b.angle - a.angle) / (b.shift - a.shift);
      brackets.push({ lo: a, hi: b, slope, agrees: direction === 0 || Math.sign(slope) === direction });
    }
  }
  if (!brackets.length) {
    // The requested angle is outside the scanned envelope. Return the closest
    // reachable end of the measured curve rather than an arbitrary zero.
    if (target <= minSample.angle) return minSample.shift;
    if (target >= maxSample.angle) return maxSample.shift;
    return 0;
  }
  // A globally monotonic scan has one bracket by construction. If the cold
  // solves do not produce a monotonic curve (for example near a reachability
  // limit), fall back to the strongest local bracket whose slope agrees with
  // the overall direction.
  let bracket = brackets[0];
  if (!monotonic) {
    bracket = brackets.find((candidate) => candidate.agrees) || brackets[0];
    for (const candidate of brackets) {
      if (candidate.agrees && Math.abs(candidate.slope) > Math.abs(bracket.slope)) bracket = candidate;
    }
  }
  let lo = bracket.lo.shift;
  let hi = bracket.hi.shift;
  let loAngle = bracket.lo.angle;
  for (let i = 0; i < SUSP_RACK_BISECT_ROUNDS && hi - lo > SUSP_RACK_SHIFT_EPS; i += 1) {
    const mid = 0.5 * (lo + hi);
    const angle = meanAt(mid);
    if (!Number.isFinite(angle)) break;
    if ((angle - target) * (loAngle - target) > 0) {
      lo = mid;
      loAngle = angle;
    } else {
      hi = mid;
    }
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
