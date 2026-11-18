/* =========================================================================
   05-body-dynamics.js — six-degree-of-freedom body, spring-damper corners,
   anti-roll bar dynamics and fixed-step integration
   ========================================================================= */

/**
 * Stage-02 rigid-body model.
 *
 * The body has three translations (x forward, y normal, z right in the road
 * frame) and three rotations. The wheel centres stay on the road plane; the
 * four corner springs, dampers and anti-roll bars therefore see the body pose
 * relative to the plane. This is the "equivalent wheel-centre" model described
 * in DESIGN.md: the unsprung masses and the individual linkage constraints are
 * not integrated, but every force the suspension applies to the body is
 * reacted at the contact patch, so heave, pitch and roll are coupled correctly.
 *
 * Orientation is stored as a quaternion mapping body axes to road axes. The
 * Euler sequence used for display is R = Ry(yaw) * Rz(pitch) * Rx(roll), which
 * matches the stage-01 sign convention: positive pitch lifts the nose, positive
 * roll lowers the right side, positive yaw turns the nose to the left.
 */

const SIM_DT = 1 / 500;
const SIM_MAX_SUBSTEPS = 128;
const SIM_MAX_FRAME_DT = 0.5;
const SIM_MAX_BACKLOG = 0.5;
const SIM_REST_SPEED = 1e-4;
const SIM_ANGULAR_LIMIT = 40;
const SIM_LINEAR_LIMIT = 80;
const SIM_BOUND_X = 4.2;
const SIM_BOUND_Z = 2.6;
const SIM_IMPULSE_SECONDS = 0.12;
// B2-1: latched contact state machine.
const SIM_ARREST_SPEED = 2e-3;
const SIM_ARREST_RATE = 2e-3;
const SIM_ARREST_DWELL = 3;
const SIM_HOLD_HYSTERESIS = 0.02;

let SIM = null;

function simContactState() {
  return {
    mode: 'HOLD',
    dwell: 0,
    since: 0,
    changes: 0,
    lastChangeStep: 0,
    reason: null,
    slipSpeed: 0,
    usage: 0
  };
}

/* ------------------------------ quaternion helpers ------------------------------ */

function simQuatMul(a, b) {
  const aw = a[0], ax = a[1], ay = a[2], az = a[3];
  const bw = b[0], bx = b[1], by = b[2], bz = b[3];
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw
  ];
}

function simQuatNormalize(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length < 1e-12) return [1, 0, 0, 0];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function simQuatRotate(q, v) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

function simQuatRotateInverse(q, v) {
  return simQuatRotate([q[0], -q[1], -q[2], -q[3]], v);
}

function simQuatFromEuler(yaw, pitch, roll) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
  const qy = [cy, 0, sy, 0];
  const qp = [cp, 0, 0, sp];
  const qr = [cr, sr, 0, 0];
  return simQuatNormalize(simQuatMul(simQuatMul(qy, qp), qr));
}

function simEulerFromQuat(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const r00 = 1 - 2 * (y * y + z * z);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const pitch = Math.asin(clamp(r10, -1, 1));
  const yaw = Math.atan2(-r20, r00);
  const roll = Math.atan2(-r12, r11);
  return { yaw, pitch, roll };
}

function simQuatDerivative(q, omegaBody) {
  const dq = simQuatMul(q, [0, omegaBody[0], omegaBody[1], omegaBody[2]]);
  return [0.5 * dq[0], 0.5 * dq[1], 0.5 * dq[2], 0.5 * dq[3]];
}

function simCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/* ------------------------------ simulation state ------------------------------ */

function simBodyPointFromCg(cg, q, cgBody) {
  const arm = simQuatRotate(q, cgBody);
  return [cg[0] - arm[0], cg[1] - arm[1], cg[2] - arm[2]];
}

function simCgFromBodyPoint(bodyPoint, q, cgBody) {
  const arm = simQuatRotate(q, cgBody);
  return [bodyPoint[0] + arm[0], bodyPoint[1] + arm[1], bodyPoint[2] + arm[2]];
}

function simReferencePoint(sim) {
  const state = sim.state;
  const reference = sim.reference;
  if (!state) return { x: 0, y: 0, z: 0 };
  const cgBody = reference && reference.cgBody ? reference.cgBody : { x: 0, y: 0, z: 0 };
  const point = simBodyPointFromCg(
    [state.x, state.y, state.z],
    [state.qw, state.qx, state.qy, state.qz],
    [cgBody.x, cgBody.y, cgBody.z]
  );
  return { x: point[0], y: point[1], z: point[2] };
}

function simRatioState(sim, index, row, instantRatio) {
  const design = Math.abs(row && row.dLdDelta) > 1e-6 ? Math.abs(row.dLdDelta) : 0.5;
  const previous = sim.cornerRatio[index];
  const finite = Number.isFinite(instantRatio);
  const inRange = finite && instantRatio > 0.05 && instantRatio < 2.0;
  const nearDesign = inRange && instantRatio / design > 0.3 && instantRatio / design < 3.0;
  const continuous = previous == null ||
    (finite && Math.abs(instantRatio - previous) / Math.max(Math.abs(previous), 1e-6) < 0.2);
  if (finite && nearDesign && continuous) {
    sim.cornerRatio[index] = instantRatio;
    return { ok: true, ratio: instantRatio };
  }
  if (previous != null) return { ok: false, ratio: previous };
  return { ok: false, ratio: design };
}

function simEquilibriumState(reference) {
  const q = simQuatFromEuler(0, reference.pitch, reference.roll);
  const cgBody = [reference.cgBody.x, reference.cgBody.y, reference.cgBody.z];
  const cg = simCgFromBodyPoint([0, reference.heave, 0], q, cgBody);
  return {
    x: cg[0],
    y: cg[1],
    z: cg[2],
    vx: 0,
    vy: 0,
    vz: 0,
    qw: q[0],
    qx: q[1],
    qy: q[2],
    qz: q[3],
    wx: 0,
    wy: 0,
    wz: 0
  };
}

function simCreate(source = state, options = {}) {
  const settle = options.settle || 0;
  const sim = {
    reference: computeStatic(source),
    state: null,
    time: 0,
    impulse: null,
    contact: simContactState(),
    running: true,
    accumulator: 0,
    lastSubsteps: 0,
    cornerSeed: [null, null, null, null],
    cornerRatio: [null, null, null, null],
    solverDegraded: false,
    solverFailed: false,
    solverFailureSteps: 0,
    rackShift: 0,
    flags: {
      holding: true,
      sliding: false,
      finite: true,
      boundary: false,
      recovered: false
    },
    resetCount: 0
  };
  sim.state = simEquilibriumState(sim.reference);
  setActiveGeometry(source);
  sim.geometryRevision = sim.reference.geometryRevision;
  sim.steerApplied = source.steer;
  sim.droppedTime = 0;
  sim.lastFrameDt = 0;
  sim.lastAdvance = 0;
  sim.timeScale = 1;
  if (settle > 0) simRunFor(sim, settle);
  return sim;
}

function simReset(sim, source = state, options = {}) {
  const settle = options.settle || 0;
  sim.reference = computeStatic(source);
  sim.state = simEquilibriumState(sim.reference);
  setActiveGeometry(source);
  sim.geometryRevision = sim.reference.geometryRevision;
  sim.steerApplied = source.steer;
  sim.droppedTime = 0;
  sim.lastFrameDt = 0;
  sim.lastAdvance = 0;
  sim.timeScale = 1;
  sim.time = 0;
  sim.impulse = null;
  sim.contact = simContactState();
  sim.accumulator = 0;
  sim.lastSubsteps = 0;
  sim.cornerSeed = [null, null, null, null];
  sim.cornerRatio = [null, null, null, null];
  sim.solverDegraded = false;
  sim.solverFailed = false;
  sim.solverFailureSteps = 0;
  sim.flags = {
    holding: true,
    sliding: false,
    finite: true,
    boundary: false,
    recovered: false
  };
  sim.resetCount += 1;
  if (settle > 0) simRunFor(sim, settle);
  return sim;
}

/**
 * Swap the reference model of a running simulation without resetting the body
 * state or the contact latch (B2-1 / A-06). Seeds belong to the old geometry
 * and are cleared; the body state and sim.contact are preserved.
 */
function simRetargetReference(sim, source = state) {
  const next = computeStatic(source);
  const previousRevision = sim.reference ? sim.reference.geometryRevision : undefined;
  const nextRevision = next.geometryRevision;
  if (previousRevision !== undefined && nextRevision !== undefined && previousRevision !== nextRevision) {
    throw new Error('simRetargetReference: geometryRevision mismatch (' + previousRevision + ' -> ' + nextRevision + ')');
  }
  sim.reference = next;
  setActiveGeometry(source);
  sim.geometryRevision = next.geometryRevision;
  sim.steerApplied = source.steer;
  sim.cornerSeed = [null, null, null, null];
  sim.cornerRatio = [null, null, null, null];
  return sim;
}

function simActiveImpulse(sim) {
  return sim.impulse && sim.time < sim.impulse.until ? sim.impulse : null;
}

function simApplyImpulse(sim, kind = 'heave') {
  // B2-2: offset is a body-frame point relative to the reference point;
  // forceRoad is the road-frame impulse force, applied unchanged.
  const specs = {
    heave: { label: '垂向脉冲', forceRoad: [0, -6800, 0], offset: [0, 0, 0] },
    roll: { label: '侧倾脉冲', forceRoad: [0, -4200, 0], offset: [0, 0, 0.90] },
    pitch: { label: '俯仰脉冲', forceRoad: [0, -6200, 0], offset: [0.95, 0, 0] }
  };
  const spec = specs[kind];
  if (!spec) return false;
  sim.impulse = {
    kind,
    label: spec.label,
    forceRoad: spec.forceRoad.slice(),
    offset: spec.offset.slice(),
    until: sim.time + SIM_IMPULSE_SECONDS
  };
  sim.running = true;
  return true;
}

/* ------------------------------ force evaluation ------------------------------ */

/**
 * B2-4: single force-assembly entry. It reads and writes the transient
 * sim._evalAccum created by simEvaluate; bucket selects the moment part.
 * roadPoint and forceRoad are road-frame; the arm is measured from the CG.
 */
function simApplyForceAt(sim, roadPoint, forceRoad, bucket) {
  const accum = sim._evalAccum;
  if (!accum) {
    throw new Error('simApplyForceAt: sim._evalAccum is missing (call inside simEvaluate)');
  }
  const part = accum.momentParts[bucket];
  if (!part) {
    throw new Error('simApplyForceAt: unknown bucket ' + bucket);
  }
  const arm = [
    roadPoint[0] - accum.cg[0],
    roadPoint[1] - accum.cg[1],
    roadPoint[2] - accum.cg[2]
  ];
  const localMoment = simCross(arm, forceRoad);
  accum.force[0] += forceRoad[0];
  accum.force[1] += forceRoad[1];
  accum.force[2] += forceRoad[2];
  part[0] += localMoment[0];
  part[1] += localMoment[1];
  part[2] += localMoment[2];
}

function simEvaluate(sim, dt = SIM_DT) {
  const bodyState = sim.state;
  const reference = sim.reference;
  if (!reference || !reference.source) {
    throw new Error('simEvaluate: reference.source is required');
  }
  const source = reference.source;
  const mass = reference.mass;
  const q = [bodyState.qw, bodyState.qx, bodyState.qy, bodyState.qz];
  const euler = simEulerFromQuat(q);
  const cgBody = [reference.cgBody.x, reference.cgBody.y, reference.cgBody.z];
  const cg = [bodyState.x, bodyState.y, bodyState.z];
  const bodyPoint = simBodyPointFromCg(cg, q, cgBody);
  const refPos = { x: bodyPoint[0], y: bodyPoint[1], z: bodyPoint[2] };
  const omegaBody = [bodyState.wx, bodyState.wy, bodyState.wz];
  const omegaRoad = simQuatRotate(q, omegaBody);
  const velocity = [bodyState.vx, bodyState.vy, bodyState.vz];
  const gravity = [
    reference.frame.gravityLocal.x,
    reference.frame.gravityLocal.y,
    reference.frame.gravityLocal.z
  ];
  // Transient accumulator for simApplyForceAt; created and deleted by this
  // function, never part of the model snapshot.
  const accum = {
    cg: [cg[0], cg[1], cg[2]],
    force: [mass * gravity[0], mass * gravity[1], mass * gravity[2]],
    momentParts: {
      normal: [0, 0, 0],
      friction: [0, 0, 0],
      impulse: [0, 0, 0]
    }
  };
  sim._evalAccum = accum;
  const force = accum.force;
  const corners = [];

  const geometry = reference.suspension ? reference.suspension.corners : null;
  const design = reference.suspension ? reference.suspension.design : null;
  const bodyPos = refPos;
  const bodyQuat = new THREE.Quaternion(bodyState.qx, bodyState.qy, bodyState.qz, bodyState.qw);
  const rackShift = sim.rackShift || 0;
  let degraded = false;

  for (let i = 0; i < reference.wheels.length; i += 1) {
    const wheel = reference.wheels[i];
    const arm = [wheel.x - cgBody[0], -cgBody[1], wheel.z - cgBody[2]];
    const armRoad = simQuatRotate(q, arm);
    const cornerY = cg[1] + armRoad[1];
    const cornerVelocityY = velocity[1] + (omegaRoad[2] * armRoad[0] - omegaRoad[0] * armRoad[2]);
    let solved = null;
    let springForce = 0;
    let dampingForce = 0;
    let coilLength = NaN;
    let lengthDot = 0;
    let ratio = 1;
    if (geometry && design) {
      const row = design[i];
      solved = suspSolveCorner(geometry[i], bodyPos, bodyQuat, rackShift, sim.cornerSeed[i], true);
      sim.cornerSeed[i] = solved.seed;
      const ratioCheck = simRatioState(sim, i, row, solved.motionRatio);
      if (!ratioCheck.ok) degraded = true;
      const deltaDot = -cornerVelocityY;
      if (solved.frame.converged) {
        const dLdDelta = -ratioCheck.ratio;
        lengthDot = dLdDelta * deltaDot;
        coilLength = solved.coilLength;
        springForce = row.coilRate * (coilLength - row.refLength) * dLdDelta;
        dampingForce = row.coilDamping * lengthDot * dLdDelta;
      } else {
        // Diverged solve: fall back to the design linkage slope so the state
        // stays finite, and flag it through the corner record.
        const dLdDelta = row.dLdDelta;
        lengthDot = dLdDelta * deltaDot;
        coilLength = row.length0 + dLdDelta * (-cornerY);
        springForce = row.coilRate * (coilLength - row.refLength) * dLdDelta;
        dampingForce = row.coilDamping * dLdDelta * dLdDelta * deltaDot;
      }
      ratio = ratioCheck.ratio;
    } else {
      springForce = reference.baseLoads[i] - reference.springRates[i] * cornerY;
      dampingForce = -reference.damperRateWheel[i] * cornerVelocityY;
    }
    // B2-3: one road-frame contact point per corner. The solved mechanism
    // provides it; the fallback (no suspension model) projects the design
    // wheel centre onto the road plane with the full quaternion and the road
    // normal [0,1,0], never the gravity direction.
    let contactRoad;
    let wheelPosRoad;
    if (solved && solved.contactRoad) {
      contactRoad = [solved.contactRoad.x, solved.contactRoad.y, solved.contactRoad.z];
      wheelPosRoad = [solved.wheelPosRoad.x, solved.wheelPosRoad.y, solved.wheelPosRoad.z];
    } else {
      const rest = simQuatRotate(q, [wheel.x, 0, wheel.z]);
      const px = refPos.x + rest[0];
      const pz = refPos.z + rest[2];
      contactRoad = [px, 0, pz];
      wheelPosRoad = [px, reference.dims.R, pz];
    }
    const contactArm = [contactRoad[0] - cg[0], contactRoad[1] - cg[1], contactRoad[2] - cg[2]];
    const contactVelocity = [
      velocity[0] + (omegaRoad[1] * contactArm[2] - omegaRoad[2] * contactArm[1]),
      velocity[1] + (omegaRoad[2] * contactArm[0] - omegaRoad[0] * contactArm[2]),
      velocity[2] + (omegaRoad[0] * contactArm[1] - omegaRoad[1] * contactArm[0])
    ];
    // Parking friction only sees the planar degrees of freedom (translation +
    // yaw); roll/pitch rates are absorbed by the suspension in this model, so
    // they must not inject tangential slip at the contact patch.
    const slipVelocity = [
      velocity[0] + omegaRoad[1] * contactArm[2],
      velocity[2] - omegaRoad[1] * contactArm[0]
    ];
    corners.push({
      key: wheel.key,
      index: i,
      wheel,
      cornerY,
      cornerVelocityY,
      springForce,
      dampingForce,
      arbForce: 0,
      rawForce: springForce + dampingForce,
      force: 0,
      contact: contactRoad,
      contactVelocity,
      slipVelocity,
      wheelPos: wheelPosRoad,
      solved,
      coilLength,
      lengthDot,
      motionRatio: ratio
    });
  }

  // Anti-roll bars act on the travel difference across each axle. The force is
  // equal and opposite and produces no net heave force.
  for (const pair of [[0, 1], [2, 3]]) {
    const left = corners[pair[0]];
    const right = corners[pair[1]];
    const axle = left.wheel.axle;
    const rate = reference.arbRate[axle] || 0;
    const travelDelta = left.cornerY - right.cornerY;
    left.arbForce = -rate * travelDelta;
    right.arbForce = rate * travelDelta;
    left.rawForce += left.arbForce;
    right.rawForce += right.arbForce;
  }

  let sumNormal = 0;
  for (const corner of corners) {
    corner.force = Math.max(0, corner.rawForce);
    corner.normal = corner.force;
    sumNormal += corner.force;
    simApplyForceAt(sim, corner.contact, [0, corner.force, 0], 'normal');
  }
  const normalMomentY = accum.momentParts.normal[1];

  const impulse = simActiveImpulse(sim);
  const impulseLeverRoad = impulse
    ? simQuatRotate(q, [
      impulse.offset[0] - cgBody[0],
      impulse.offset[1] - cgBody[1],
      impulse.offset[2] - cgBody[2]
    ])
    : null;
  const externalTangent = [
    mass * gravity[0] + (impulse ? impulse.forceRoad[0] : 0),
    0,
    mass * gravity[2] + (impulse ? impulse.forceRoad[2] : 0)
  ];
  const demand = Math.hypot(externalTangent[0], externalTangent[2]);
  const frictionCoefficient = Number.isFinite(source.friction) ? source.friction : DEFAULTS.friction;
  const capacity = frictionCoefficient * sumNormal;
  const atRest = Math.abs(bodyState.vx) < SIM_REST_SPEED &&
    Math.abs(bodyState.vz) < SIM_REST_SPEED &&
    Math.abs(bodyState.wy) < SIM_REST_SPEED;

  // B2-1: latched HOLD/SLIP contact state. simEvaluate only proposes
  // contactNext; simStep commits it after the integration step.
  const previousContact = sim.contact || simContactState();
  let maxSlipSpeed = 0;
  for (const corner of corners) {
    maxSlipSpeed = Math.max(maxSlipSpeed, Math.hypot(corner.slipVelocity[0], corner.slipVelocity[1]));
  }
  const planarSpeed = Math.hypot(bodyState.vx, bodyState.vz);
  const lifted = corners.some((corner) => corner.force <= 1e-6);
  let mode = previousContact.mode === 'SLIP' ? 'SLIP' : 'HOLD';
  let reason = previousContact.reason;
  let modeChanged = false;
  if (mode === 'HOLD') {
    if (planarSpeed > SIM_ARREST_SPEED) { mode = 'SLIP'; reason = 'speed'; }
    else if (Math.abs(bodyState.wy) > SIM_ARREST_RATE) { mode = 'SLIP'; reason = 'yaw'; }
    else if (maxSlipSpeed > SIM_ARREST_SPEED) { mode = 'SLIP'; reason = 'slip'; }
    else if (sumNormal <= 1e-6 || lifted) { mode = 'SLIP'; reason = 'lift'; }
    else if (demand > capacity) { mode = 'SLIP'; reason = 'demand'; }
    modeChanged = mode === 'SLIP';
  }

  const frictionForces = [];
  let usage = 0;
  const arrest = { planar: false, yaw: false };
  const recordFriction = (corner, friction) => {
    frictionForces.push(friction);
    corner.friction = friction;
    simApplyForceAt(sim, corner.contact, friction, 'friction');
    if (frictionCoefficient > 1e-9 && corner.force > 1e-9) {
      usage = Math.max(usage, Math.hypot(friction[0], friction[2]) / (frictionCoefficient * corner.force));
    }
  };

  if (sumNormal > 1e-6) {
    if (mode === 'HOLD') {
      for (const corner of corners) {
        const share = corner.force / sumNormal;
        recordFriction(corner, [-externalTangent[0] * share, 0, -externalTangent[2] * share]);
      }
    } else {
      // Near the arrest threshold the per-corner contact velocities are
      // dominated by the yaw term and point in different directions; using
      // them would let the friction impulse accelerate the body again. Below
      // SIM_ARREST_SPEED every corner uses the body-level slip direction so
      // the stopping-impulse budget is well defined.
      let globalDirection = [0, 0, 0];
      if (planarSpeed > 1e-9) {
        globalDirection = [-bodyState.vx / planarSpeed, 0, -bodyState.vz / planarSpeed];
      } else if (demand > 1e-9) {
        globalDirection = [-externalTangent[0] / demand, 0, -externalTangent[2] / demand];
      }
      const raw = [];
      const inertiaY = reference.inertia.Iyy;
      const clampToStop = planarSpeed > 1e-9 || Math.abs(bodyState.wy) > SIM_ARREST_RATE;
      for (const corner of corners) {
        const slipVelocity = corner.slipVelocity;
        const contactSpeed = Math.hypot(slipVelocity[0], slipVelocity[1]);
        const direction = contactSpeed > SIM_ARREST_SPEED
          ? [-slipVelocity[0] / contactSpeed, 0, -slipVelocity[1] / contactSpeed]
          : globalDirection;
        let magnitude = frictionCoefficient * corner.force;
        if (clampToStop && contactSpeed > 1e-12) {
          // Impulse needed to stop this contact patch; the effective mass
          // includes the yaw coupling (r x t)_y^2 / Iyy.
          const rxT = (corner.contact[2] - cg[2]) * direction[0] - (corner.contact[0] - cg[0]) * direction[2];
          const effectiveMass = 1 / (1 / mass + (rxT * rxT) / inertiaY);
          magnitude = Math.min(magnitude, contactSpeed * effectiveMass / dt);
        }
        raw.push([magnitude * direction[0], 0, magnitude * direction[2]]);
      }
      // Stopping-impulse budget: the friction impulse may not exceed the
      // momentum it has to remove, otherwise one 2 ms step reverses the
      // velocity. L_ext only contains non-friction moments (normal + impulse).
      let jX = 0;
      let jZ = 0;
      let jY = 0;
      for (let index = 0; index < corners.length; index += 1) {
        const corner = corners[index];
        const armX = corner.contact[0] - cg[0];
        const armZ = corner.contact[2] - cg[2];
        jX += raw[index][0] * dt;
        jZ += raw[index][2] * dt;
        jY += (armZ * raw[index][0] - armX * raw[index][2]) * dt;
      }
      const pNowX = mass * bodyState.vx + externalTangent[0] * dt;
      const pNowZ = mass * bodyState.vz + externalTangent[2] * dt;
      const needPlanar = Math.hypot(pNowX, pNowZ);
      const havePlanar = Math.hypot(jX, jZ);
      const extYawMoment = normalMomentY + (impulseLeverRoad
        ? impulseLeverRoad[2] * impulse.forceRoad[0] - impulseLeverRoad[0] * impulse.forceRoad[2]
        : 0);
      const yawNow = reference.inertia.Iyy * bodyState.wy + extYawMoment * dt;
      // Only clamp when the friction impulse opposes the momentum it would
      // remove; otherwise it would scale a pure spin or a pure translation to
      // zero and stop the contact entirely.
      let kPlanar = 1;
      if (jX * pNowX + jZ * pNowZ < -1e-12 && havePlanar > 1e-12 && needPlanar < havePlanar) {
        kPlanar = needPlanar / havePlanar;
      }
      let kYaw = 1;
      // Only a real spin can reverse its sign within one step; a yaw impulse
      // acting on a body that is not spinning must not scale the friction to
      // zero (that would cancel the linear slide arrest).
      if (Math.abs(bodyState.wy) > SIM_ARREST_RATE && jY * yawNow < -1e-12 &&
          Math.abs(jY) > 1e-12 && Math.abs(yawNow) < Math.abs(jY)) {
        kYaw = Math.abs(yawNow) / Math.abs(jY);
      }
      const k = Math.min(kPlanar, kYaw);
      arrest.planar = kPlanar < 1;
      arrest.yaw = kYaw < 1;
      arrest.kPlanar = kPlanar;
      arrest.kYaw = kYaw;
      arrest.k = k;
      arrest.planarMoment = [pNowX, pNowZ];
      arrest.planarImpulse = [jX, jZ];
      arrest.yawMoment = yawNow;
      arrest.yawImpulse = jY;
      for (let index = 0; index < corners.length; index += 1) {
        recordFriction(corners[index], [raw[index][0] * k, 0, raw[index][2] * k]);
      }
    }
  }

  if (impulse) {
    const impulsePoint = [cg[0] + impulseLeverRoad[0], cg[1] + impulseLeverRoad[1], cg[2] + impulseLeverRoad[2]];
    simApplyForceAt(sim, impulsePoint, impulse.forceRoad, 'impulse');
  }
  const moment = [
    accum.momentParts.normal[0] + accum.momentParts.friction[0] + accum.momentParts.impulse[0],
    accum.momentParts.normal[1] + accum.momentParts.friction[1] + accum.momentParts.impulse[1],
    accum.momentParts.normal[2] + accum.momentParts.friction[2] + accum.momentParts.impulse[2]
  ];
  const momentParts = accum.momentParts;
  delete sim._evalAccum;

  const stepIndex = Math.round(sim.time / dt);
  const contactNext = {
    mode,
    dwell: modeChanged ? 0 : previousContact.dwell,
    since: modeChanged ? sim.time : previousContact.since,
    changes: modeChanged ? previousContact.changes + 1 : previousContact.changes,
    lastChangeStep: modeChanged ? stepIndex : previousContact.lastChangeStep,
    reason: mode === 'SLIP' ? reason : null,
    slipSpeed: maxSlipSpeed,
    usage
  };

  return {
    force,
    moment,
    momentParts,
    corners,
    frictionForces,
    cg,
    bodyPoint: bodyPoint.slice(),
    refPos,
    euler,
    omegaRoad,
    velocity,
    sumNormal,
    normalMomentY,
    externalTangent,
    demand,
    capacity,
    holding: mode === 'HOLD',
    sliding: mode === 'SLIP',
    contactNext,
    arrest,
    impulse,
    atRest,
    degraded,
    solverOk: corners.every((corner) => !corner.solved || corner.solved.ok)
  };
}

/* ------------------------------ integration ------------------------------ */

function simIntegrate(sim, dt) {
  const bodyState = sim.state;
  const reference = sim.reference;
  const evaluation = simEvaluate(sim, dt);
  const mass = reference.mass;
  const inertia = reference.inertia;
  const q = [bodyState.qw, bodyState.qx, bodyState.qy, bodyState.qz];

  // B1-1: bodyState.x/y/z is the centre of mass, so F/m is already the CG
  // acceleration and the moment about the CG drives the rotation directly.
  const accel = [evaluation.force[0] / mass, evaluation.force[1] / mass, evaluation.force[2] / mass];
  const momentBody = simQuatRotateInverse(q, evaluation.moment);
  const omega = [bodyState.wx, bodyState.wy, bodyState.wz];
  const inertiaMoment = [inertia.Ixx * omega[0], inertia.Iyy * omega[1], inertia.Izz * omega[2]];
  const gyroscopic = simCross(omega, inertiaMoment);
  const alpha = [
    (momentBody[0] - gyroscopic[0]) / inertia.Ixx,
    (momentBody[1] - gyroscopic[1]) / inertia.Iyy,
    (momentBody[2] - gyroscopic[2]) / inertia.Izz
  ];

  if (evaluation.holding) {
    accel[0] = 0;
    accel[2] = 0;
    alpha[1] = 0;
  }

  bodyState.vx += accel[0] * dt;
  bodyState.vy += accel[1] * dt;
  bodyState.vz += accel[2] * dt;
  bodyState.wx += alpha[0] * dt;
  bodyState.wy += alpha[1] * dt;
  bodyState.wz += alpha[2] * dt;

  if (evaluation.holding) {
    bodyState.vx = 0;
    bodyState.vz = 0;
    bodyState.wy = 0;
  } else if (evaluation.arrest) {
    // B2-1: the clamped friction impulse is enough to stop the planar or yaw
    // motion this step; project the component to zero instead of overshooting.
    if (evaluation.arrest.planar) {
      bodyState.vx = 0;
      bodyState.vz = 0;
    }
    if (evaluation.arrest.yaw) bodyState.wy = 0;
  }

  const linearSpeed = Math.hypot(bodyState.vx, bodyState.vy, bodyState.vz);
  if (linearSpeed > SIM_LINEAR_LIMIT) {
    const scale = SIM_LINEAR_LIMIT / linearSpeed;
    bodyState.vx *= scale;
    bodyState.vy *= scale;
    bodyState.vz *= scale;
  }
  const angularSpeed = Math.hypot(bodyState.wx, bodyState.wy, bodyState.wz);
  if (angularSpeed > SIM_ANGULAR_LIMIT) {
    const scale = SIM_ANGULAR_LIMIT / angularSpeed;
    bodyState.wx *= scale;
    bodyState.wy *= scale;
    bodyState.wz *= scale;
  }

  bodyState.x += bodyState.vx * dt;
  bodyState.y += bodyState.vy * dt;
  bodyState.z += bodyState.vz * dt;

  const derivative = simQuatDerivative(q, [bodyState.wx, bodyState.wy, bodyState.wz]);
  let nextQ = simQuatNormalize([
    q[0] + derivative[0] * dt,
    q[1] + derivative[1] * dt,
    q[2] + derivative[2] * dt,
    q[3] + derivative[3] * dt
  ]);
  if (evaluation.holding) {
    const nextEuler = simEulerFromQuat(nextQ);
    nextQ = simQuatFromEuler(evaluation.euler.yaw, nextEuler.pitch, nextEuler.roll);
  }
  bodyState.qw = nextQ[0];
  bodyState.qx = nextQ[1];
  bodyState.qy = nextQ[2];
  bodyState.qz = nextQ[3];

  // Centre-of-mass bounds of the test rig.
  if (Math.abs(bodyState.x) > SIM_BOUND_X) {
    bodyState.x = Math.sign(bodyState.x) * SIM_BOUND_X;
    bodyState.vx = 0;
    bodyState.vz = 0;
    sim.flags.boundary = true;
  }
  if (Math.abs(bodyState.z) > SIM_BOUND_Z) {
    bodyState.z = Math.sign(bodyState.z) * SIM_BOUND_Z;
    bodyState.vx = 0;
    bodyState.vz = 0;
    sim.flags.boundary = true;
  }

  const finite = [
    bodyState.x, bodyState.y, bodyState.z,
    bodyState.vx, bodyState.vy, bodyState.vz,
    bodyState.qw, bodyState.qx, bodyState.qy, bodyState.qz,
    bodyState.wx, bodyState.wy, bodyState.wz
  ].every(Number.isFinite);
  if (!finite) {
    sim.flags.finite = false;
    sim.flags.recovered = true;
    sim.state = simEquilibriumState(reference);
    sim.cornerSeed = [null, null, null, null];
    sim.cornerRatio = [null, null, null, null];
    sim.contact = simContactState();
    sim.solverDegraded = false;
    sim.solverFailed = false;
    sim.solverFailureSteps = 0;
    sim.impulse = null;
    sim.accumulator = 0;
  }

  if (evaluation.degraded) {
    sim.solverDegraded = true;
    sim.solverFailureSteps += 1;
    if (sim.solverFailureSteps >= 10) sim.solverFailed = true;
  } else {
    sim.solverDegraded = false;
    sim.solverFailureSteps = 0;
  }

  // B2-1: SLIP -> HOLD after SIM_ARREST_DWELL consecutive arrested substeps.
  const contactNext = evaluation.contactNext;
  if (contactNext.mode === 'SLIP') {
    const speed = Math.hypot(bodyState.vx, bodyState.vz);
    const qPost = [bodyState.qw, bodyState.qx, bodyState.qy, bodyState.qz];
    const omegaPost = simQuatRotate(qPost, [bodyState.wx, bodyState.wy, bodyState.wz]);
    let slip = 0;
    for (const corner of evaluation.corners) {
      const arm = [corner.contact[0] - bodyState.x, corner.contact[1] - bodyState.y, corner.contact[2] - bodyState.z];
      const vx = bodyState.vx + omegaPost[1] * arm[2];
      const vz = bodyState.vz - omegaPost[1] * arm[0];
      slip = Math.max(slip, Math.hypot(vx, vz));
    }
    contactNext.slipSpeed = slip;
    const canPark = evaluation.demand <= evaluation.capacity * (1 - SIM_HOLD_HYSTERESIS);
    if (speed <= SIM_ARREST_SPEED && Math.abs(bodyState.wy) <= SIM_ARREST_RATE &&
        slip <= SIM_ARREST_SPEED && canPark) {
      contactNext.dwell += 1;
    } else {
      contactNext.dwell = 0;
    }
    if (contactNext.dwell >= SIM_ARREST_DWELL) {
      contactNext.mode = 'HOLD';
      contactNext.since = sim.time + dt;
      contactNext.changes += 1;
      contactNext.lastChangeStep = Math.round((sim.time + dt) / dt);
      contactNext.reason = null;
      bodyState.vx = 0;
      bodyState.vz = 0;
      bodyState.wy = 0;
    }
  }
  sim.flags.holding = contactNext.mode === 'HOLD';
  sim.flags.sliding = contactNext.mode === 'SLIP';
  sim.time += dt;
  if (sim.impulse && sim.time >= sim.impulse.until) sim.impulse = null;
  return evaluation;
}

function simStep(sim, dt = SIM_DT) {
  if (!sim || !sim.state) return null;
  const evaluation = simIntegrate(sim, dt);
  if (evaluation && evaluation.contactNext) sim.contact = evaluation.contactNext;
  return evaluation;
}

function simRunFor(sim, seconds, dt = SIM_DT) {
  const steps = Math.max(0, Math.round(seconds / dt));
  for (let i = 0; i < steps; i += 1) simStep(sim, dt);
  return sim;
}

function simAdvance(sim, frameDt) {
  if (!sim || !sim.running || !sim.state) return 0;
  const wallDt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0;
  const accepted = Math.min(wallDt, SIM_MAX_FRAME_DT);
  sim.accumulator += accepted;
  let dropped = wallDt - accepted;
  if (sim.accumulator > SIM_MAX_BACKLOG) {
    dropped += sim.accumulator - SIM_MAX_BACKLOG;
    sim.accumulator = SIM_MAX_BACKLOG;
  }
  let steps = 0;
  while (sim.accumulator >= SIM_DT && steps < SIM_MAX_SUBSTEPS) {
    simStep(sim, SIM_DT);
    sim.accumulator -= SIM_DT;
    steps += 1;
  }
  sim.lastSubsteps = steps;
  sim.lastFrameDt = wallDt;
  sim.lastAdvance = steps * SIM_DT;
  sim.droppedTime = (sim.droppedTime || 0) + dropped;
  sim.timeScale = wallDt > 0 ? sim.lastAdvance / wallDt : 1;
  return steps;
}

/* ------------------------------ live model ------------------------------ */

function simBuildModel(sim, source = state) {
  const reference = sim.reference || computeStatic(source);
  // Telemetry/model reads must not perturb the solver seed bus (O1).
  const seedBefore = Array.isArray(sim.cornerSeed) ? sim.cornerSeed.slice() : null;
  const ratioBefore = Array.isArray(sim.cornerRatio) ? sim.cornerRatio.slice() : null;
  const evaluation = simEvaluate(sim);
  if (seedBefore) sim.cornerSeed = seedBefore;
  if (ratioBefore) sim.cornerRatio = ratioBefore;
  const state = sim.state;
  const euler = evaluation.euler;
  const q = [state.qw, state.qx, state.qy, state.qz];
  const corners = evaluation.corners;
  const loads = corners.map((corner) => corner.force);
  const rawLoads = corners.map((corner) => corner.rawForce);
  const sumLoads = loads.reduce((acc, value) => acc + value, 0);
  const frontLoad = loads[0] + loads[1];
  const rearLoad = loads[2] + loads[3];
  const leftLoad = loads[0] + loads[2];
  const rightLoad = loads[1] + loads[3];
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const denom = sumLoads > 1e-9 ? sumLoads : 1;
  const frontShare = frontLoad / denom;
  const leftShare = leftLoad / denom;
  const liftedCount = rawLoads.filter((value) => value < -1e-6).length;
  const contactPoints = corners.map((corner) => ({
    x: corner.contact[0],
    y: 0,
    z: corner.contact[2]
  }));
  const wheelCenters = corners.map((corner) => ({
    x: corner.wheelPos[0],
    y: corner.wheelPos[1],
    z: corner.wheelPos[2]
  }));
  const normalMomentX = loads.reduce((acc, value, i) => acc + value * contactPoints[i].x, 0);
  const normalMomentZ = loads.reduce((acc, value, i) => acc + value * contactPoints[i].z, 0);
  const vertical = [
    reference.frame.gravityLocal.x,
    reference.frame.gravityLocal.y,
    reference.frame.gravityLocal.z
  ];
  const verticalLength = Math.hypot(vertical[0], vertical[1], vertical[2]) || 1;
  const down = [vertical[0] / verticalLength, vertical[1] / verticalLength, vertical[2] / verticalLength];
  const cg = evaluation.cg;
  const projectionT = Math.abs(down[1]) > 1e-9 ? -cg[1] / down[1] : 0;
  const px = cg[0] + projectionT * down[0];
  const pz = cg[2] + projectionT * down[2];
  const motionRatio = reference.motionRatio;
  const designRow = reference.suspension ? reference.suspension.design : null;
  const refPos = evaluation.refPos;
  const bodyQuat = new THREE.Quaternion(state.qx, state.qy, state.qz, state.qw);
  const solved = corners.map((corner) => {
    if (!corner.solved) return null;
    const solvedCorner = corner.solved;
    const quaternion = bodyQuat.clone().multiply(solvedCorner.wheelQuat);
    return {
      key: corner.key,
      wheelPos: [corner.wheelPos[0], corner.wheelPos[1], corner.wheelPos[2]],
      wheelQuat: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      contact: [corner.contact[0], corner.contact[1], corner.contact[2]],
      rockerAngle: solvedCorner.rockerAngle,
      rocker: {
        angle: solvedCorner.rocker.angle,
        residual: solvedCorner.rocker.residual,
        feasible: solvedCorner.rocker.feasible,
        branch: solvedCorner.rocker.branch
      },
      coilLength: solvedCorner.coilLength,
      motionRatio: solvedCorner.motionRatio,
      motionRatioState: solvedCorner.motionRatioState,
      converged: solvedCorner.frame.converged,
      ok: solvedCorner.ok
    };
  });
  const springCompressionMm = corners.map((corner, index) => {
    if (designRow && Number.isFinite(corner.coilLength)) return (designRow[index].length0 - corner.coilLength) * 1000;
    const ratio = corner.wheel.axle === 'front' ? motionRatio.front : motionRatio.rear;
    return -corner.cornerY * ratio * 1000;
  });
  const damperCompressionRate = corners.map((corner, index) => {
    if (Number.isFinite(corner.lengthDot)) return -corner.lengthDot;
    const ratio = corner.wheel.axle === 'front' ? motionRatio.front : motionRatio.rear;
    return -corner.cornerVelocityY * ratio;
  });
  const forceError = Math.abs(sumLoads + reference.mass * vertical[1]);
  const momentXError = Math.abs(evaluation.moment[0]);
  const momentZError = Math.abs(evaluation.moment[2]);
  const simInfo = {
    time: sim.time,
    running: sim.running,
    holding: evaluation.holding,
    sliding: evaluation.sliding,
    atRest: evaluation.atRest,
    finite: sim.flags.finite,
    boundary: sim.flags.boundary,
    recovered: sim.flags.recovered,
    substeps: sim.lastSubsteps,
    accumulator: sim.accumulator,
    backlog: sim.accumulator,
    droppedTime: sim.droppedTime || 0,
    timeScale: sim.timeScale == null ? 1 : sim.timeScale,
    lastFrameDt: sim.lastFrameDt || 0,
    lastAdvance: sim.lastAdvance || 0,
    maxFrameDt: SIM_MAX_FRAME_DT,
    maxSubsteps: SIM_MAX_SUBSTEPS,
    stepHz: Math.round(1 / SIM_DT),
    demand: evaluation.demand,
    capacity: evaluation.capacity,
    impulse: evaluation.impulse ? evaluation.impulse.label : null,
    resetCount: sim.resetCount,
    solverDegraded: Boolean(sim.solverDegraded),
    solverFailed: Boolean(sim.solverFailed),
    mode: sim.contact ? sim.contact.mode : 'HOLD',
    dwell: sim.contact ? sim.contact.dwell : 0,
    since: sim.contact ? sim.contact.since : 0,
    changes: sim.contact ? sim.contact.changes : 0,
    lastChangeStep: sim.contact ? sim.contact.lastChangeStep : 0,
    reason: sim.contact ? sim.contact.reason : null,
    slipSpeed: sim.contact ? sim.contact.slipSpeed : 0,
    usage: sim.contact ? sim.contact.usage : 0
  };

  return Object.assign({}, reference, {
    dynamic: true,
    geometryRevision: reference.geometryRevision,
    physicsRevision: reference.geometryRevision,
    sim: simInfo,
    bodyPos: { x: refPos.x, y: refPos.y, z: refPos.z },
    bodyQuat: q,
    bodyYaw: euler.yaw,
    bodyPitch: euler.pitch,
    bodyRoll: euler.roll,
    heave: refPos.y,
    pitch: euler.pitch,
    roll: euler.roll,
    yaw: euler.yaw,
    poseDeg: {
      pitch: euler.pitch * RAD,
      roll: euler.roll * RAD,
      yaw: euler.yaw * RAD
    },
    bodyRatesDeg: {
      roll: state.wx * RAD,
      yaw: state.wy * RAD,
      pitch: state.wz * RAD
    },
    bodyVelocity: { x: state.vx, y: state.vy, z: state.vz },
    cornerY: corners.map((corner) => corner.cornerY),
    cornerVelocityY: corners.map((corner) => corner.cornerVelocityY),
    travelMm: corners.map((corner) => -corner.cornerY * 1000),
    solved,
    rackShift: sim.rackShift || 0,
    motionRatioInstant: corners.map((corner) => corner.motionRatio),
    motionRatioState: solved.map((row) => (row ? row.motionRatioState : 'unavailable')),
    rockerResidualMm: solved.map((row) => (row ? row.rocker.residual * 1000 : NaN)),
    rockerFeasible: solved.map((row) => (row ? row.rocker.feasible : false)),
    solverOk: corners.every((corner) => !corner.solved || corner.solved.ok),
    springCompressionMm,
    damperCompressionRate,
    springForce: corners.map((corner) => corner.springForce),
    dampingForce: corners.map((corner) => corner.dampingForce),
    arbForce: corners.map((corner) => corner.arbForce),
    frictionForce: evaluation.frictionForces.map((friction) => ({ x: friction[0], z: friction[2] })),
    momentParts: {
      normal: evaluation.momentParts.normal.slice(),
      friction: evaluation.momentParts.friction.slice(),
      impulse: evaluation.momentParts.impulse.slice()
    },
    loads,
    rawLoads,
    liftedCount,
    minLoad,
    maxLoad,
    sumLoads,
    totalNormal: sumLoads,
    frontLoad,
    rearLoad,
    leftLoad,
    rightLoad,
    frontShare,
    rearShare: 1 - frontShare,
    leftShare,
    rightShare: 1 - leftShare,
    normalMomentX,
    normalMomentZ,
    forceError,
    momentXError,
    momentZError,
    equilibriumOk: forceError < 0.5 && momentXError < 0.5 && momentZError < 0.5,
    contactOk: liftedCount === 0 && minLoad > 0.01 && sim.flags.finite,
    cgWorld: { x: cg[0], y: cg[1], z: cg[2] },
    projection: { x: px, z: pz, dx: px - reference.xCG, dz: pz - reference.zCG },
    px,
    pz,
    contactPoints,
    wheelCenters
  });
}

/* ------------------------------ stage-02 self-tests ------------------------------ */

function simLoadError(sim) {
  const model = simBuildModel(sim);
  const target = sim.reference.loads;
  return Math.max(...model.loads.map((value, index) => Math.abs(value - target[index])));
}

function* simDynamicSelfTestSteps(source = state) {
  const tests = [];
  const record = (name, ok, detail) => {
    const test = { name, ok, detail };
    tests.push(test);
    return test;
  };

  const levelSim = simCreate(Object.assign({}, source, { slope: 0, bank: 0 }), { settle: 2.5 });
  const levelModel = simBuildModel(levelSim);
  const levelError = simLoadError(levelSim);
  const levelPose = Math.abs(levelModel.poseDeg.pitch) + Math.abs(levelModel.poseDeg.roll);
  yield record(
    '动态水平稳态',
    levelError < 1 && levelPose < 0.02 && levelModel.sim.finite,
    'ΔN ' + levelError.toFixed(3) + ' · 姿态 ' + levelPose.toFixed(3) + '°'
  );

  const tiltedSource = Object.assign({}, source, { slope: 8, bank: 7 });
  const tiltedSim = simCreate(tiltedSource, { settle: 4 });
  const tiltedTarget = computeStatic(tiltedSource);
  const tiltedModel = simBuildModel(tiltedSim);
  const tiltedError = Math.max(...tiltedModel.loads.map((value, index) => Math.abs(value - tiltedTarget.loads[index])));
  yield record(
    '倾斜路面动态收敛',
    tiltedError < 3 && tiltedModel.sim.finite,
    'ΔN ' + tiltedError.toFixed(3)
  );

  const heaveSim = simCreate(source, { settle: 1.5 });
  simApplyImpulse(heaveSim, 'heave');
  let heavePeak = 0;
  for (let i = 0; i < 600; i += 1) {
    simStep(heaveSim);
    heavePeak = Math.max(heavePeak, Math.abs(simReferencePoint(heaveSim).y - heaveSim.reference.heave));
  }
  simRunFor(heaveSim, 2.0);
  const heaveTail = Math.abs(simBuildModel(heaveSim).heave - heaveSim.reference.heave);
  yield record(
    '垂向脉冲衰减',
    heavePeak > 0.005 && heaveTail < heavePeak * 0.2 && heaveSim.flags.finite,
    (heavePeak * 1000).toFixed(2) + ' → ' + (heaveTail * 1000).toFixed(2) + ' mm'
  );

  const rollSoft = simCreate(Object.assign({}, source, { arbFront: 0, arbRear: 0 }), { settle: 1.2 });
  const rollHard = simCreate(Object.assign({}, source, { arbFront: 100, arbRear: 100 }), { settle: 1.2 });
  simApplyImpulse(rollSoft, 'roll');
  simApplyImpulse(rollHard, 'roll');
  let softRoll = 0;
  let hardRoll = 0;
  for (let i = 0; i < 450; i += 1) {
    simStep(rollSoft);
    simStep(rollHard);
    const softQ = [rollSoft.state.qw, rollSoft.state.qx, rollSoft.state.qy, rollSoft.state.qz];
    const hardQ = [rollHard.state.qw, rollHard.state.qx, rollHard.state.qy, rollHard.state.qz];
    softRoll = Math.max(softRoll, Math.abs(simEulerFromQuat(softQ).roll));
    hardRoll = Math.max(hardRoll, Math.abs(simEulerFromQuat(hardQ).roll));
  }
  yield record(
    '防倾杆抑制侧倾',
    hardRoll < softRoll && softRoll > 1e-5,
    (softRoll * RAD).toFixed(3) + '° → ' + (hardRoll * RAD).toFixed(3) + '°'
  );

  const detA = simCreate(source, { settle: 0.4 });
  const detB = simCreate(source, { settle: 0.4 });
  simApplyImpulse(detA, 'pitch');
  simApplyImpulse(detB, 'pitch');
  simRunFor(detA, 0.5);
  simRunFor(detB, 0.5);
  const detAReference = simReferencePoint(detA);
  const detBReference = simReferencePoint(detB);
  const detDelta = Math.abs(detAReference.y - detBReference.y) +
    Math.abs(detA.state.qx - detB.state.qx) +
    Math.abs(detA.state.qz - detB.state.qz);
  yield record('固定步长可重复', detDelta < 1e-12, 'Δ ' + detDelta.toExponential(1));

  const frameSim = simCreate(source, { settle: 0.4 });
  simApplyImpulse(frameSim, 'roll');
  let frameSteps = 0;
  for (let i = 0; i < 90; i += 1) frameSteps += simAdvance(frameSim, 1 / 60);
  const fixedSim = simCreate(source, { settle: 0.4 });
  simApplyImpulse(fixedSim, 'roll');
  simRunFor(fixedSim, frameSteps * SIM_DT);
  const frameReference = simReferencePoint(frameSim);
  const fixedReference = simReferencePoint(fixedSim);
  const frameDelta = Math.abs(frameReference.y - fixedReference.y) +
    Math.abs(frameSim.state.qx - fixedSim.state.qx) +
    Math.abs(frameSim.state.wx - fixedSim.state.wx);
  yield record(
    '渲染帧率不影响物理',
    frameDelta < 1e-9 && frameSim.lastSubsteps > 0,
    frameSteps + ' 步 · Δ ' + frameDelta.toExponential(1)
  );

  const slideSource = Object.assign({}, source, { slope: 10, bank: 10, friction: 0.2 });
  const slideSim = simCreate(slideSource, { settle: 2.0 });
  const slideDistance = Math.hypot(slideSim.state.x, slideSim.state.z);
  yield record(
    '低附着六自由度滑移',
    slideDistance > 0.05 && slideSim.flags.finite,
    slideDistance.toFixed(2) + ' m · ' + (slideSim.flags.sliding ? '滑移' : '静止')
  );

  const contactModel = simBuildModel(levelSim);
  yield record(
    '动态法向载荷非负',
    contactModel.loads.every((value) => value >= 0) && contactModel.loads.every(Number.isFinite),
    'min ' + contactModel.minLoad.toFixed(1) + ' N'
  );

  const holdSim = simCreate(Object.assign({}, source, { slope: 0, bank: 0 }), { settle: 0.5 });
  holdSim.state.vx = 0.0005;
  for (let i = 0; i < 4; i += 1) simStep(holdSim);
  yield record(
    '低速驻车',
    Math.abs(holdSim.state.vx) < 1e-12 && holdSim.contact.mode === 'HOLD',
    'vx ' + holdSim.state.vx.toExponential(1) + ' · ' + holdSim.contact.mode
  );

  const stopSim = simCreate(Object.assign({}, source, { slope: 0, bank: 0 }), { settle: 0.5 });
  const stopX = stopSim.state.x;
  stopSim.state.vx = 0.01;
  simStep(stopSim);
  const stopDx = stopSim.state.x - stopX;
  yield record(
    '滑移不反向',
    stopSim.state.vx >= 0 && stopSim.state.vx < 1e-6 && stopDx >= 0 && stopDx < 1e-4,
    'vx ' + stopSim.state.vx.toExponential(2) + ' · dx ' + (stopDx * 1000).toFixed(3) + ' mm'
  );

  return tests;
}

function runDynamicSelfTests(source = state) {
  const iterator = simDynamicSelfTestSteps(source);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

function runDynamicSelfTestsChunked(source = state, options = {}) {
  const onTest = typeof options.onTest === 'function' ? options.onTest : null;
  const onDone = typeof options.onDone === 'function' ? options.onDone : null;
  const sliceMs = Number.isFinite(options.sliceMs) ? options.sliceMs : 50;
  const clock = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();
  const tests = [];
  const iterator = simDynamicSelfTestSteps(source);
  const pump = () => {
    const start = clock();
    while (true) {
      const step = iterator.next();
      if (step.done) {
        if (onDone) onDone(step.value || tests);
        return;
      }
      tests.push(step.value);
      if (onTest) onTest(step.value, tests.length);
      if (clock() - start >= sliceMs) {
        setTimeout(pump, 0);
        return;
      }
    }
  };
  pump();
  return tests;
}
