/* =========================================================================
   22-car-dynamics.js — wheels, wishbones, rockers, springs, ARBs and updates
   ========================================================================= */

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _vecD = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qCamber = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

function initCarSceneGroups() {
  initCarAssets();
  if (!CAR.dynamicGroup) {
    CAR.dynamicGroup = new THREE.Group();
    CAR.dynamicGroup.name = 'dynamicSuspension';
    S.carRoot.add(CAR.dynamicGroup);
  }
  if (!S.bodyPivot) throw new Error('bodyPivot not created by initScene');
}

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
      rocker: V(wheel.x + (front ? -0.42 : 0.30), front ? 0.43 : 0.40, zSign * rockerZ),
      damper: V(wheel.x + (front ? -0.80 : 0.68), front ? 0.49 : 0.46, zSign * (front ? 0.10 : 0.09)),
      diff: V(wheel.x + 0.08, 0.30, zSign * 0.17)
    };
    const wheelLocal = {
      lower: V(0.015, -0.215, -zSign * 0.105),
      upper: V(-0.010, 0.215, -zSign * 0.105),
      track: V(0.100, -0.020, -zSign * 0.105),
      push: front ? V(0.040, -0.185, -zSign * 0.080) : V(0.000, 0.195, -zSign * 0.080),
      drive: V(0.000, 0.000, -zSign * 0.060)
    };
    const rocker = {
      pivot: body.rocker.clone(),
      pushArm: front ? V(0.130, -0.010, 0) : V(-0.130, -0.010, 0),
      damperArm: front ? V(-0.090, -0.050, 0) : V(0.090, -0.050, 0),
      // Dedicated eye for the anti-roll-bar drop link. It is a short bracket
      // above the rocker plate, not a second pushrod or damper pickup.
      arbArm: front ? V(-0.060, 0.050, 0) : V(0.060, 0.050, 0),
      baseAngle: front ? -0.10 : 0.10,
      gain: 14,
      mesh: null,
      axle: null
    };
    return {
      key: wheel.key,
      index,
      front,
      zSign,
      wheel,
      body,
      wheelLocal,
      rocker,
      wheelRoot: null,
      wheelLocalPoints: null,
      pushTip: new THREE.Vector3(),
      damperTip: new THREE.Vector3(),
      arbTip: new THREE.Vector3(),
      angle: rocker.baseAngle
    };
  });
}

/* ------------------------------ wheel geometry ------------------------------ */

function buildWheelAssembly(corner, model) {
  const dims = model.dims;
  const wheel = corner.wheel;
  const zSign = corner.zSign;
  const width = corner.front ? dims.wF : dims.wR;
  const R = dims.R;
  const rimR = R * 0.635;

  const root = new THREE.Group();
  root.position.set(wheel.x, R, wheel.z);
  root.name = 'wheel-' + wheel.key;
  CAR.dynamicGroup.add(root);

  const spinner = new THREE.Group();
  root.add(spinner);

  const addWheelMesh = (mesh, parent = spinner, cast = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Tyre: a lathe shell around the Z axle.
  const profile = [
    [rimR + 0.004, -width / 2 + 0.002],
    [R * 0.82, -width / 2],
    [R * 0.955, -width / 2 + 0.012],
    [R * 0.995, -width / 2 + 0.045],
    [R, -width / 2 + 0.075],
    [R, width / 2 - 0.075],
    [R * 0.995, width / 2 - 0.045],
    [R * 0.955, width / 2 - 0.012],
    [R * 0.82, width / 2],
    [rimR + 0.004, width / 2 - 0.002]
  ].map(([radius, axial]) => new THREE.Vector2(radius, axial));
  const tyreGeo = new THREE.LatheGeometry(profile, 72);
  tyreGeo.rotateX(Math.PI / 2);
  tyreGeo.computeVertexNormals();
  addWheelMesh(new THREE.Mesh(tyreGeo, MAT.rubber));

  // Tyre sidewall compound band, on both faces.
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.RingGeometry(R * 0.735, R * 0.785, 64), MAT.tyreBand);
    band.position.z = side * (width / 2 + 0.0025);
    if (side < 0) band.rotation.y = Math.PI;
    band.castShadow = false;
    addWheelMesh(band, spinner, false);
    const bandInner = new THREE.Mesh(new THREE.RingGeometry(R * 0.70, R * 0.715, 64), MAT.tyreBandLight);
    bandInner.position.z = side * (width / 2 + 0.0027);
    if (side < 0) bandInner.rotation.y = Math.PI;
    bandInner.castShadow = false;
    addWheelMesh(bandInner, spinner, false);
  }

  // Rim barrel.
  const barrelGeo = new THREE.CylinderGeometry(rimR * 0.985, rimR * 0.985, width * 0.75, 48, 1, true);
  barrelGeo.rotateX(Math.PI / 2);
  addWheelMesh(new THREE.Mesh(barrelGeo, MAT.rim));
  const innerBarrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.88, rimR * 0.88, width * 0.72, 36, 1, true), MAT.carbonMatte);
  innerBarrel.geometry.rotateX(Math.PI / 2);
  addWheelMesh(innerBarrel);

  // Rim lips.
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.965, 0.012, 7, 48), MAT.rim);
    lip.position.z = side * width * 0.375;
    addWheelMesh(lip);
    const faceRing = new THREE.Mesh(new THREE.RingGeometry(rimR * 0.70, rimR * 0.955, 48), MAT.rim);
    faceRing.position.z = side * width * 0.382;
    if (side < 0) faceRing.rotation.y = Math.PI;
    addWheelMesh(faceRing);
  }

  // Spokes, both faces.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * TAU + 0.18;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(rimR * 0.74, 0.032, 0.018), MAT.rim);
      spoke.position.set(Math.cos(angle) * rimR * 0.48, Math.sin(angle) * rimR * 0.48, side * width * 0.355);
      spoke.rotation.z = angle;
      addWheelMesh(spoke);
    }
  }

  // Hub and centre nut.
  const hubGeo = new THREE.CylinderGeometry(rimR * 0.25, rimR * 0.28, width * 0.82, 24);
  hubGeo.rotateX(Math.PI / 2);
  addWheelMesh(new THREE.Mesh(hubGeo, MAT.darkMetal));
  for (const side of [-1, 1]) {
    const nutGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.045, 6);
    nutGeo.rotateX(Math.PI / 2);
    const nut = new THREE.Mesh(nutGeo, MAT.rim);
    nut.position.z = side * width * 0.405;
    addWheelMesh(nut);
  }

  // Brake disc and hat.
  const discZ = -zSign * width * 0.20;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.46, R * 0.46, 0.022, 44), MAT.brakeDisc);
  disc.geometry.rotateX(Math.PI / 2);
  disc.position.z = discZ;
  addWheelMesh(disc);
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * TAU;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.025, 6), MAT.carbonMatte);
    hole.geometry.rotateX(Math.PI / 2);
    hole.position.set(Math.cos(angle) * R * 0.34, Math.sin(angle) * R * 0.34, discZ);
    addWheelMesh(hole, spinner, false);
  }
  const discHat = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.17, R * 0.20, 0.075, 24), MAT.darkMetal);
  discHat.geometry.rotateX(Math.PI / 2);
  discHat.position.z = discZ;
  addWheelMesh(discHat);

  // Non-rotating upright and caliper.
  const upright = new THREE.Group();
  root.add(upright);
  const plate = makeRoundedBox(0.095, 0.40, 0.052, 0.025, MAT.darkMetal);
  plate.position.set(-0.005, 0, -zSign * width * 0.10);
  upright.add(plate);
  for (const y of [-0.215, 0.215]) {
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.06, 14), MAT.titanium);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(0, y, -zSign * width * 0.15);
    upright.add(boss);
  }
  const caliper = makeRoundedBox(0.12, 0.17, 0.055, 0.025, MAT.brakeCaliper);
  caliper.position.set(0.09, -0.145, -zSign * width * 0.34);
  caliper.rotation.x = zSign * 0.18;
  upright.add(caliper);
  const caliperBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), MAT.titanium);
  caliperBolt.rotation.x = Math.PI / 2;
  caliperBolt.position.set(0.13, -0.10, -zSign * width * 0.34);
  upright.add(caliperBolt);
  const brakeDuct = makeRoundedBox(0.16, 0.20, 0.10, 0.04, MAT.carbonMatte);
  brakeDuct.position.set(-0.02, -0.07, -zSign * (width * 0.48));
  upright.add(brakeDuct);

  // Steering arm / rear toe arm: the visible lever that the tie rod connects to.
  const trackArm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.030, 0.018), MAT.titanium);
  trackArm.position.set(corner.wheelLocal.track.x * 0.5, corner.wheelLocal.track.y * 0.5, corner.wheelLocal.track.z);
  trackArm.rotation.z = corner.front ? -0.08 : 0.08;
  trackArm.castShadow = true;
  upright.add(trackArm);

  if (!corner.front) {
    const driveFlange = new THREE.Mesh(CAR.shared.cylinder, MAT.steel);
    driveFlange.scale.set(0.058, 0.036, 0.058);
    driveFlange.rotation.x = Math.PI / 2;
    driveFlange.position.set(0, 0, -zSign * 0.045);
    driveFlange.castShadow = true;
    spinner.add(driveFlange);
    const flangeRing = new THREE.Mesh(CAR.shared.torus, MAT.titanium);
    flangeRing.scale.setScalar(0.062);
    flangeRing.rotation.x = Math.PI / 2;
    flangeRing.position.set(0, 0, -zSign * 0.06);
    flangeRing.castShadow = true;
    spinner.add(flangeRing);
  }

  upright.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  corner.wheelRoot = root;
  corner.spinner = spinner;
  corner.wheelLocalPoints = corner.wheelLocal;
  return root;
}

/* ------------------------------ internal rockers and ARBs ------------------------------ */

function makeRockerPlateShape(pushArm, damperArm) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(pushArm.x, pushArm.y);
  shape.lineTo(pushArm.x * 0.78, pushArm.y + 0.035);
  shape.lineTo(0.0, 0.035);
  shape.lineTo(damperArm.x, damperArm.y);
  shape.closePath();
  return shape;
}

function buildInternalSuspension(corners) {
  const group = new THREE.Group();
  group.name = 'internalSuspension';
  S.bodyPivot.add(group);
  CAR.internalGroup = group;

  for (const corner of corners) {
    const shape = makeRockerPlateShape(corner.rocker.pushArm, corner.rocker.damperArm);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 4 });
    geometry.translate(0, 0, -0.007);
    const mesh = new THREE.Mesh(geometry, MAT.carbon);
    mesh.position.copy(corner.rocker.pivot);
    mesh.rotation.z = corner.rocker.baseAngle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    corner.rocker.mesh = mesh;

    // Short bracket and eye for the ARB drop link. It belongs to the rocker and
    // therefore rotates with it; the link is solved in the same body frame.
    const arbArm = corner.rocker.arbArm;
    const arbBracketLength = Math.hypot(arbArm.x, arbArm.y);
    const arbBracket = new THREE.Mesh(new THREE.BoxGeometry(arbBracketLength, 0.016, 0.014), MAT.carbon);
    arbBracket.position.set(arbArm.x / 2, arbArm.y / 2, 0);
    arbBracket.rotation.z = Math.atan2(arbArm.y, arbArm.x);
    arbBracket.castShadow = true;
    mesh.add(arbBracket);
    const arbEye = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0055, 5, 12), MAT.titanium);
    arbEye.position.set(arbArm.x, arbArm.y, 0);
    mesh.add(arbEye);

    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.055, 12), MAT.titanium);
    axle.rotation.x = Math.PI / 2;
    axle.position.copy(corner.rocker.pivot);
    axle.castShadow = true;
    group.add(axle);
    corner.rocker.axle = axle;
  }

  buildAntiRollBars(corners, group);
  buildSteeringMechanics(corners, group);
  buildDifferentialMechanics(corners, group);
}

/* ------------------------------ anti-roll bars ------------------------------ */

const ARB_ARM_LENGTH = 0.16;
const ARB_BLADE_WIDTH = 0.052;
const ARB_BLADE_THICKNESS = 0.009;

function rockerBodyPoint(corner, local, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    corner.rocker.pivot.x + local.x * cos - local.y * sin,
    corner.rocker.pivot.y + local.x * sin + local.y * cos,
    corner.rocker.pivot.z + local.z
  );
}

function shortestAngleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/**
 * Formula-car anti-roll bar, built as a transverse torsion bar with one lever
 * arm at each end. Both arms point to the same side of the bar (a shallow U in
 * plan view), so heave rotates the bar in its bearings without twisting it,
 * while single-wheel bump or roll rotates the two arms in opposite directions
 * and twists the bar. One arm (the right-hand arm in this model) is a flat
 * spring-steel blade; rotating it about its own longitudinal axis changes the
 * bending stiffness, which is the adjustment used on adjustable F1
 * installations. Drop links connect the arm tips to dedicated eyes on the
 * rockers.
 */
function buildAntiRollBars(corners, group) {
  for (const axleName of ['front', 'rear']) {
    const pair = corners.filter((corner) => (axleName === 'front' ? corner.front : !corner.front));
    if (pair.length < 2) continue;
    const left = pair.find((corner) => corner.zSign < 0);
    const right = pair.find((corner) => corner.zSign > 0);
    if (!left || !right) continue;
    const rocker = left.rocker;
    const zEnd = Math.abs(rocker.pivot.z);
    const armInset = axleName === 'front' ? 0.085 : 0.055;
    const armZ = Math.max(0.075, zEnd - armInset);
    const linkZSpan = zEnd - armZ;
    const armDir = axleName === 'front' ? -1 : 1;
    const barX = rocker.pivot.x - armDir * 0.105;
    const barY = rocker.pivot.y + 0.155;
    const restAngle = armDir < 0 ? Math.PI + 0.15 : -0.15;

    const anchorRest = rockerBodyPoint(left, rocker.arbArm, rocker.baseAngle);
    const tipRestX = barX + ARB_ARM_LENGTH * Math.cos(restAngle);
    const tipRestY = barY + ARB_ARM_LENGTH * Math.sin(restAngle);
    const linkLength = Math.hypot(tipRestX - anchorRest.x, tipRestY - anchorRest.y, linkZSpan);
    const planarLinkLength = Math.sqrt(Math.max(1e-8, linkLength * linkLength - linkZSpan * linkZSpan));

    const barRoot = new THREE.Group();
    barRoot.name = 'antiRollBar-' + axleName;
    barRoot.position.set(barX, barY, 0);
    group.add(barRoot);

    // Centre clamp and outboard bearings. The bar rotates inside these; the
    // bearings and their feet stay fixed to the chassis.
    const sleeve = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
    sleeve.scale.set(0.027, 0.078, 0.027);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.castShadow = true;
    barRoot.add(sleeve);

    for (const sign of [-1, 1]) {
      const bearing = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
      bearing.scale.set(0.031, 0.044, 0.031);
      bearing.rotation.x = Math.PI / 2;
      bearing.position.z = sign * armZ * 0.58;
      bearing.castShadow = true;
      barRoot.add(bearing);

      const bracket = makeRoundedBox(0.075, 0.075, 0.045, 0.012, MAT.carbonMatte);
      bracket.position.set(0, -0.056, sign * armZ * 0.58);
      bracket.castShadow = true;
      barRoot.add(bracket);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.07), MAT.darkMetal);
      foot.position.set(0, -0.096, sign * armZ * 0.58);
      foot.castShadow = true;
      barRoot.add(foot);
    }

    // Two half-shafts meet at the centre clamp. A bright stripe records the
    // local bar rotation, so the torsion between left and right ends is visible.
    const halves = {};
    for (const sign of [-1, 1]) {
      const half = new THREE.Group();
      half.position.z = sign * armZ / 2;
      const tube = new THREE.Mesh(CAR.shared.cylinder, MAT.arbBar);
      tube.scale.set(0.0145, armZ / 2, 0.0145);
      tube.rotation.x = Math.PI / 2;
      tube.castShadow = true;
      half.add(tube);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0035, armZ / 2 - 0.012), MAT.arbBlade);
      stripe.position.set(0.0145, 0, 0);
      half.add(stripe);
      barRoot.add(half);
      halves[sign] = half;
    }

    const sides = {};
    for (const corner of pair) {
      const sign = corner.zSign;
      const armGroup = new THREE.Group();
      armGroup.position.z = sign * armZ;
      armGroup.rotation.z = restAngle;
      barRoot.add(armGroup);

      const collar = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
      collar.scale.set(0.024, 0.048, 0.024);
      collar.rotation.z = -Math.PI / 2;
      collar.position.x = 0.024;
      collar.castShadow = true;
      armGroup.add(collar);

      let bladeRoll = null;
      if (sign > 0) {
        bladeRoll = new THREE.Group();
        armGroup.add(bladeRoll);
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(ARB_ARM_LENGTH - 0.04, ARB_BLADE_WIDTH, ARB_BLADE_THICKNESS),
          MAT.arbBlade
        );
        blade.position.x = 0.02 + (ARB_ARM_LENGTH - 0.04) / 2;
        blade.castShadow = true;
        blade.receiveShadow = true;
        bladeRoll.add(blade);
        const tipBlock = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, ARB_BLADE_WIDTH * 0.82, ARB_BLADE_THICKNESS * 1.25),
          MAT.darkMetal
        );
        tipBlock.position.x = ARB_ARM_LENGTH - 0.012;
        tipBlock.castShadow = true;
        bladeRoll.add(tipBlock);

        // A small orange adjuster knob marks the blade's own rotation axis.
        const adjuster = new THREE.Mesh(CAR.shared.cylinder, MAT.arbAdjuster);
        adjuster.scale.set(0.018, 0.026, 0.018);
        adjuster.rotation.z = -Math.PI / 2;
        adjuster.position.x = 0.020;
        armGroup.add(adjuster);
      } else {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.015, ARB_ARM_LENGTH, 10), MAT.arbBar);
        arm.rotation.z = -Math.PI / 2;
        arm.position.x = ARB_ARM_LENGTH / 2;
        arm.castShadow = true;
        armGroup.add(arm);
      }

      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0055, 5, 12), MAT.titanium);
      eye.position.x = ARB_ARM_LENGTH;
      armGroup.add(eye);
      const tipJoint = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
      tipJoint.scale.setScalar(0.012);
      tipJoint.position.x = ARB_ARM_LENGTH;
      armGroup.add(tipJoint);

      const link = new THREE.Mesh(CAR.shared.rod, MAT.titanium);
      link.castShadow = true;
      group.add(link);
      const linkA = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
      linkA.scale.setScalar(0.013);
      group.add(linkA);
      const linkB = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
      linkB.scale.setScalar(0.013);
      group.add(linkB);

      sides[sign] = {
        corner,
        sign,
        armGroup,
        bladeRoll,
        armLength: ARB_ARM_LENGTH,
        restAngle,
        angle: restAngle,
        link,
        linkA,
        linkB,
        linkLength,
        planarLinkLength,
        armZ,
        stretchMm: 0,
        tip: new THREE.Vector3(),
        anchor: new THREE.Vector3(),
        barHalf: halves[sign]
      };
    }

    CAR.arbs.push({
      axle: axleName,
      barRoot,
      barX,
      barY,
      zEnd,
      armZ,
      armDir,
      restAngle,
      sides,
      bladeAngle: 0,
      twistDeg: 0,
      stretchMm: 0,
      point: V(barX, barY + 0.055, 0)
    });
    CAR.mechanics.arbPoints[axleName] = V(barX, barY + 0.055, 0);
  }
  CAR.mechanics.arbFront = CAR.arbs.some((arb) => arb.axle === 'front');
  CAR.mechanics.arbRear = CAR.arbs.some((arb) => arb.axle === 'rear');
}

function solveArbAngle(arb, side, anchor) {
  const dx = anchor.x - arb.barX;
  const dy = anchor.y - arb.barY;
  const d = Math.hypot(dx, dy);
  const L = side.armLength;
  const r = side.planarLinkLength;
  if (d > 1e-6 && d <= L + r - 1e-6 && d >= Math.abs(L - r) + 1e-6) {
    const a = (L * L - r * r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L * L - a * a));
    const ux = dx / d;
    const uy = dy / d;
    const c1 = Math.atan2(a * uy + h * ux, a * ux - h * uy);
    const c2 = Math.atan2(a * uy - h * ux, a * ux + h * uy);
    const d1 = Math.abs(shortestAngleDelta(c1, side.angle));
    const d2 = Math.abs(shortestAngleDelta(c2, side.angle));
    return d1 <= d2 ? c1 : c2;
  }
  // The four-bar is outside its closure range; keep the link connected and
  // point the arm at the rocker eye. This only occurs at extreme travel.
  return Math.atan2(dy, dx);
}

function updateAntiRollBars(model) {
  let maxStretchAll = 0;
  let maxTwist = 0;
  for (const arb of CAR.arbs) {
    arb.bladeAngle = (model.arbBladeAngleDeg[arb.axle] || 0) * DEG;
    let axleStretch = 0;
    const angles = {};
    for (const sign of [-1, 1]) {
      const side = arb.sides[sign];
      if (!side) continue;
      const anchor = rockerBodyPoint(side.corner, side.corner.rocker.arbArm, side.corner.angle);
      const angle = solveArbAngle(arb, side, anchor);
      side.angle = angle;
      side.armGroup.rotation.z = angle;
      const tip = _vecA.set(
        arb.barX + side.armLength * Math.cos(angle),
        arb.barY + side.armLength * Math.sin(angle),
        sign * side.armZ
      );
      side.tip.copy(tip);
      side.anchor.copy(anchor);
      setRodTransform(side.link, tip, anchor, 0.009);
      side.linkA.position.copy(tip);
      side.linkB.position.copy(anchor);
      const actual = tip.distanceTo(anchor);
      side.stretchMm = Math.abs(actual - side.linkLength) * 1000;
      axleStretch = Math.max(axleStretch, side.stretchMm);
      maxStretchAll = Math.max(maxStretchAll, side.stretchMm);
      if (side.bladeRoll) side.bladeRoll.rotation.x = arb.bladeAngle;
      if (side.barHalf) side.barHalf.rotation.z = shortestAngleDelta(angle, side.restAngle);
      angles[sign] = angle;
    }
    if (angles[-1] != null && angles[1] != null) {
      arb.twistDeg = Math.abs(
        shortestAngleDelta(angles[-1], arb.sides[-1].restAngle) -
        shortestAngleDelta(angles[1], arb.sides[1].restAngle)
      ) * RAD;
      maxTwist = Math.max(maxTwist, arb.twistDeg);
    }
    arb.stretchMm = axleStretch;
  }
  CAR.diag.arbCount = CAR.arbs.length;
  CAR.diag.arbTwistDeg = maxTwist;
  CAR.diag.arbStretchMm = maxStretchAll;
  CAR.diag.arbBladeFrontDeg = CAR.arbs.find((arb) => arb.axle === 'front')?.bladeAngle * RAD || 0;
  CAR.diag.arbBladeRearDeg = CAR.arbs.find((arb) => arb.axle === 'rear')?.bladeAngle * RAD || 0;
}

/* ------------------------------ mechanical detail helpers ------------------------------ */

function addStaticRod(parent, a, b, radius, material) {
  const mesh = new THREE.Mesh(CAR.shared.cylinder, material);
  setRodTransform(mesh, a, b, radius);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addStaticJoint(parent, position, radius, material = MAT.titanium) {
  const mesh = new THREE.Mesh(CAR.shared.joint, material);
  mesh.scale.setScalar(radius);
  mesh.position.copy(position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Rubber CV / rack boot: a short ribbed bellows with metallic end collars. */
function createBellows(length, radius, material = MAT.rubber) {
  const group = new THREE.Group();
  const tube = new THREE.Mesh(CAR.shared.cylinder, material);
  tube.scale.set(radius * 0.78, length, radius * 0.78);
  tube.castShadow = true;
  group.add(tube);
  for (let i = -1; i <= 1; i += 1) {
    const rib = new THREE.Mesh(CAR.shared.torus, material);
    rib.scale.setScalar(radius);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = i * length * 0.28;
    rib.castShadow = true;
    group.add(rib);
  }
  for (const sign of [-1, 1]) {
    const collar = new THREE.Mesh(CAR.shared.torus, MAT.steel);
    collar.scale.setScalar(radius * 0.82);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = sign * length * 0.5;
    group.add(collar);
  }
  return group;
}

/**
 * Front steering: rack-and-pinion housing, pinion, steering column, rack boots and
 * tie-rod boots. The tie rods themselves remain four-bar-grade dynamic links so
 * they follow the uprights when the wheels are steered.
 */
function buildSteeringMechanics(corners, group) {
  const front = corners.find((corner) => corner.front);
  if (!front) return;
  const xF = front.wheel.x;
  const rackX = xF - 0.44;
  const rackY = 0.315;
  const rackHalf = 0.26;

  addStaticRod(group, V(rackX, rackY, -rackHalf), V(rackX, rackY, rackHalf), 0.022, MAT.steel);

  // Centre pinion housing and column.
  const pinion = makeRoundedBox(0.11, 0.10, 0.11, 0.025, MAT.darkMetal);
  pinion.position.set(rackX, rackY + 0.055, 0);
  pinion.castShadow = true;
  group.add(pinion);
  addStaticRod(group, V(rackX, rackY + 0.105, 0), V(rackX, rackY + 0.20, 0), 0.013, MAT.titanium);

  const steeringX = xF - 1.88 + 0.42;
  const steeringY = 0.658 - 0.07;
  const columnA = V(steeringX, steeringY, 0);
  const columnB = V(rackX, rackY + 0.135, 0);
  CAR.mechanics.columnPoint = columnA.clone().lerp(columnB, 0.38);
  addStaticRod(group, columnA, columnB, 0.014, MAT.darkMetal);
  addStaticJoint(group, columnA, 0.022, MAT.steel);
  addStaticJoint(group, columnB, 0.022, MAT.steel);
  // A visible collar in the middle of the column, like a quick-release / U-joint.
  const columnCollar = new THREE.Mesh(CAR.shared.torus, MAT.titanium);
  columnCollar.scale.setScalar(0.024);
  columnCollar.rotation.x = Math.PI / 2;
  columnCollar.position.copy(columnA).lerp(columnB, 0.56);
  group.add(columnCollar);

  // Rack boots / bellows and inner tie-rod sockets at both ends.
  for (const sign of [-1, 1]) {
    const boot = createBellows(0.13, 0.034);
    boot.position.set(rackX, rackY, sign * 0.315);
    boot.quaternion.setFromUnitVectors(_axisY, _axisZ);
    group.add(boot);
    addStaticJoint(group, V(rackX, rackY, sign * 0.315), 0.018, MAT.steel);
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.05), MAT.darkMetal);
    mount.position.set(rackX, rackY - 0.045, sign * 0.16);
    mount.castShadow = true;
    group.add(mount);
  }

  CAR.mechanics.steeringRack = true;
  CAR.mechanics.steeringColumn = true;
  CAR.mechanics.steeringPoint = V(rackX, rackY + 0.06, 0);
}

/**
 * Rear drivetrain: differential casing, output tube/flanges. The halfshafts are
 * dynamic assemblies built per rear corner so they follow wheel travel.
 */
function buildDifferentialMechanics(corners, group) {
  const rear = corners.find((corner) => !corner.front);
  if (!rear) return;
  const xR = rear.wheel.x;
  const diffX = xR + 0.08;
  const diffY = 0.30;

  const casing = makeRoundedBox(0.30, 0.24, 0.27, 0.055, MAT.darkMetal);
  casing.position.set(diffX, 0.31, 0);
  casing.castShadow = true;
  casing.receiveShadow = true;
  group.add(casing);
  const cover = makeRoundedBox(0.15, 0.17, 0.22, 0.035, MAT.steel);
  cover.position.set(diffX + 0.13, 0.31, 0);
  cover.castShadow = true;
  group.add(cover);
  addStaticRod(group, V(diffX, diffY, -0.21), V(diffX, diffY, 0.21), 0.036, MAT.steel);

  for (const sign of [-1, 1]) {
    const flange = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
    flange.scale.set(0.060, 0.035, 0.060);
    flange.rotation.x = Math.PI / 2;
    flange.position.set(diffX, diffY, sign * 0.21);
    flange.castShadow = true;
    group.add(flange);
    const ring = new THREE.Mesh(CAR.shared.torus, MAT.darkMetal);
    ring.scale.setScalar(0.062);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(diffX, diffY, sign * 0.225);
    group.add(ring);
  }

  // Casing ribs / bolts.
  for (let i = -1; i <= 1; i += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.19, 0.235), MAT.steel);
    rib.position.set(diffX + i * 0.055, 0.31, 0);
    group.add(rib);
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU;
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), MAT.titanium);
    bolt.position.set(diffX + 0.13, 0.31 + Math.cos(angle) * 0.085, Math.sin(angle) * 0.09);
    group.add(bolt);
  }

  CAR.mechanics.differential = true;
  CAR.mechanics.diffPoint = V(diffX, diffY + 0.12, 0);
}

/* ------------------------------ links, springs, assembly ------------------------------ */

function setRodTransform(mesh, a, b, radius) {
  _dir.subVectors(b, a);
  const length = _dir.length();
  if (length < 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  _mid.addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(_mid);
  _dir.normalize();
  mesh.quaternion.setFromUnitVectors(_axisY, _dir);
  mesh.scale.set(radius, length, radius);
}

function resolveAnchor(anchor, corner, bodyMatrix, wheelMatrix) {
  if (anchor.type === 'body') {
    return _vecA.copy(anchor.local).applyMatrix4(bodyMatrix).clone();
  }
  if (anchor.type === 'wheel') {
    return _vecA.copy(anchor.local).applyMatrix4(wheelMatrix).clone();
  }
  if (anchor.type === 'pushTip') return corner.pushTip.clone();
  if (anchor.type === 'damperTip') return corner.damperTip.clone();
  return new THREE.Vector3();
}

function addLink(corner, aSpec, bSpec, { radius = 0.019, material = MAT.carbon, jointRadius = 0.016, kind = 'rod' } = {}) {
  const mesh = new THREE.Mesh(CAR.shared.rod, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  CAR.dynamicGroup.add(mesh);
  const jointA = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
  jointA.scale.setScalar(jointRadius);
  jointA.castShadow = true;
  CAR.dynamicGroup.add(jointA);
  const jointB = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
  jointB.scale.setScalar(jointRadius);
  jointB.castShadow = true;
  CAR.dynamicGroup.add(jointB);
  const link = { corner, aSpec, bSpec, mesh, jointA, jointB, radius, kind, lastA: new THREE.Vector3(), lastB: new THREE.Vector3() };
  CAR.links.push(link);
  CAR.joints.push(
    { mesh: jointA, corner, anchor: aSpec },
    { mesh: jointB, corner, anchor: bSpec }
  );
  return link;
}

function addDriveshaft(corner) {
  const assembly = new THREE.Group();
  assembly.name = 'halfshaft-' + corner.key;
  const shaft = new THREE.Mesh(CAR.shared.rod, MAT.titanium);
  shaft.castShadow = true;
  const bootA = createBellows(0.13, 0.041);
  const bootB = createBellows(0.13, 0.041);
  const cvA = new THREE.Mesh(CAR.shared.joint, MAT.steel);
  const cvB = new THREE.Mesh(CAR.shared.joint, MAT.steel);
  cvA.scale.setScalar(0.030);
  cvB.scale.setScalar(0.030);
  cvA.castShadow = true;
  cvB.castShadow = true;
  assembly.add(shaft, bootA, bootB, cvA, cvB);
  CAR.dynamicGroup.add(assembly);
  CAR.driveshafts.push({
    corner,
    assembly,
    shaft,
    bootA,
    bootB,
    cvA,
    cvB,
    aSpec: { type: 'body', local: corner.body.diff },
    bSpec: { type: 'wheel', local: corner.wheelLocal.drive }
  });
}

function buildSuspensionLinks(corners) {
  for (const corner of corners) {
    const isFront = corner.front;
    const wishboneRadius = isFront ? 0.0185 : 0.021;
    const lower = { type: 'wheel', local: corner.wheelLocal.lower };
    const upper = { type: 'wheel', local: corner.wheelLocal.upper };
    const track = { type: 'wheel', local: corner.wheelLocal.track };
    const push = { type: 'wheel', local: corner.wheelLocal.push };
    const drive = { type: 'wheel', local: corner.wheelLocal.drive };
    const bLowerFront = { type: 'body', local: corner.body.lowerFront };
    const bLowerRear = { type: 'body', local: corner.body.lowerRear };
    const bUpperFront = { type: 'body', local: corner.body.upperFront };
    const bUpperRear = { type: 'body', local: corner.body.upperRear };
    const bTrack = { type: 'body', local: corner.body.track };
    const bRockerPush = { type: 'pushTip' };
    const bRockerDamper = { type: 'damperTip' };
    const bDamper = { type: 'body', local: corner.body.damper };

    addLink(corner, bLowerFront, lower, { radius: wishboneRadius, material: MAT.carbon, kind: 'lower-front' });
    addLink(corner, bLowerRear, lower, { radius: wishboneRadius, material: MAT.carbon, kind: 'lower-rear' });
    addLink(corner, bUpperFront, upper, { radius: wishboneRadius * 0.84, material: MAT.carbon, kind: 'upper-front' });
    addLink(corner, bUpperRear, upper, { radius: wishboneRadius * 0.84, material: MAT.carbon, kind: 'upper-rear' });
    addLink(corner, bTrack, track, {
      radius: isFront ? 0.015 : 0.013,
      material: MAT.titanium,
      jointRadius: isFront ? 0.018 : 0.016,
      kind: isFront ? 'steer' : 'toe'
    });
    addLink(corner, push, bRockerPush, { radius: isFront ? 0.014 : 0.016, material: MAT.titanium, kind: isFront ? 'pushrod' : 'pullrod' });
    if (!isFront) addDriveshaft(corner);

    // Spring / damper assembly (inside bodywork, visible in x-ray).
    const assembly = new THREE.Group();
    assembly.name = 'spring-damper-' + corner.key;
    const coil = new THREE.Mesh(CAR.shared.spring, MAT.springCoil);
    coil.castShadow = true;
    const damper = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
    damper.castShadow = true;
    const capA = new THREE.Mesh(CAR.shared.joint, MAT.darkMetal);
    const capB = new THREE.Mesh(CAR.shared.joint, MAT.darkMetal);
    capA.castShadow = true;
    capB.castShadow = true;
    assembly.add(coil, damper, capA, capB);
    CAR.dynamicGroup.add(assembly);
    const jointDamper = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
    jointDamper.scale.setScalar(0.014);
    CAR.dynamicGroup.add(jointDamper);
    const jointMount = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
    jointMount.scale.setScalar(0.014);
    CAR.dynamicGroup.add(jointMount);

    const spring = {
      corner,
      assembly,
      coil,
      damper,
      capA,
      capB,
      jointDamper,
      jointMount,
      aSpec: bDamper,
      bSpec: bRockerDamper,
      lastA: new THREE.Vector3(),
      lastB: new THREE.Vector3()
    };
    CAR.springs.push(spring);
    CAR.joints.push(
      { mesh: jointMount, corner, anchor: bDamper },
      { mesh: jointDamper, corner, anchor: bRockerDamper }
    );
  }
}

function updateSuspension(model) {
  const bodyMatrix = S.bodyPivot.matrix;
  let maxGapSq = 0;

  for (let i = 0; i < CAR.corners.length; i += 1) {
    const corner = CAR.corners[i];
    corner.wheelRoot.updateMatrix();
    const wheelMatrix = corner.wheelRoot.matrix;
    const travel = -model.cornerY[i];
    corner.angle = corner.rocker.baseAngle + travel * corner.rocker.gain;
    corner.rocker.mesh.rotation.z = corner.angle;
    // Rocker arm tips in body-local coordinates.
    const cos = Math.cos(corner.angle);
    const sin = Math.sin(corner.angle);
    corner.pushTip.copy(corner.rocker.pivot).add(
      _vecB.set(
        corner.rocker.pushArm.x * cos - corner.rocker.pushArm.y * sin,
        corner.rocker.pushArm.x * sin + corner.rocker.pushArm.y * cos,
        corner.rocker.pushArm.z
      )
    ).applyMatrix4(bodyMatrix);
    corner.damperTip.copy(corner.rocker.pivot).add(
      _vecB.set(
        corner.rocker.damperArm.x * cos - corner.rocker.damperArm.y * sin,
        corner.rocker.damperArm.x * sin + corner.rocker.damperArm.y * cos,
        corner.rocker.damperArm.z
      )
    ).applyMatrix4(bodyMatrix);
    corner.arbTip.copy(corner.rocker.pivot).add(
      _vecB.set(
        corner.rocker.arbArm.x * cos - corner.rocker.arbArm.y * sin,
        corner.rocker.arbArm.x * sin + corner.rocker.arbArm.y * cos,
        corner.rocker.arbArm.z
      )
    ).applyMatrix4(bodyMatrix);

    for (const link of CAR.links) {
      if (link.corner !== corner) continue;
      const a = resolveAnchor(link.aSpec, corner, bodyMatrix, wheelMatrix);
      const b = resolveAnchor(link.bSpec, corner, bodyMatrix, wheelMatrix);
      link.lastA.copy(a);
      link.lastB.copy(b);
      setRodTransform(link.mesh, a, b, link.radius);
      link.jointA.position.copy(a);
      link.jointB.position.copy(b);
      const gapA = link.jointA.position.distanceToSquared(a);
      const gapB = link.jointB.position.distanceToSquared(b);
      maxGapSq = Math.max(maxGapSq, gapA, gapB);
    }

    for (const spring of CAR.springs) {
      if (spring.corner !== corner) continue;
      const a = resolveAnchor(spring.aSpec, corner, bodyMatrix, wheelMatrix);
      const b = resolveAnchor(spring.bSpec, corner, bodyMatrix, wheelMatrix);
      spring.lastA.copy(a);
      spring.lastB.copy(b);
      _dir.subVectors(b, a);
      const length = _dir.length();
      if (length > 1e-5) {
        _mid.addVectors(a, b).multiplyScalar(0.5);
        spring.assembly.position.copy(_mid);
        _dir.normalize();
        spring.assembly.quaternion.setFromUnitVectors(_axisY, _dir);
        spring.coil.scale.set(1, length, 1);
        spring.damper.scale.set(0.016, length * 0.94, 0.016);
        spring.capA.position.y = -length / 2;
        spring.capB.position.y = length / 2;
        spring.capA.scale.setScalar(0.033);
        spring.capB.scale.setScalar(0.033);
      }
      spring.jointDamper.position.copy(b);
      spring.jointMount.position.copy(a);
      maxGapSq = Math.max(
        maxGapSq,
        spring.jointDamper.position.distanceToSquared(b),
        spring.jointMount.position.distanceToSquared(a)
      );
    }

    for (const shaft of CAR.driveshafts) {
      if (shaft.corner !== corner) continue;
      const a = resolveAnchor(shaft.aSpec, corner, bodyMatrix, wheelMatrix);
      const b = resolveAnchor(shaft.bSpec, corner, bodyMatrix, wheelMatrix);
      _dir.subVectors(b, a);
      const length = _dir.length();
      if (length < 1e-5) {
        shaft.assembly.visible = false;
        continue;
      }
      shaft.assembly.visible = true;
      _mid.addVectors(a, b).multiplyScalar(0.5);
      shaft.assembly.position.copy(_mid);
      _dir.normalize();
      shaft.assembly.quaternion.setFromUnitVectors(_axisY, _dir);
      const innerLength = Math.max(0.04, length - 0.24);
      shaft.shaft.scale.set(0.018, innerLength, 0.018);
      const bootOffset = Math.max(0.035, length / 2 - 0.085);
      shaft.bootA.position.y = -bootOffset;
      shaft.bootB.position.y = bootOffset;
      shaft.cvA.position.y = -length / 2;
      shaft.cvB.position.y = length / 2;
    }
  }

  updateAntiRollBars(model);

  CAR.diag.linkCount = CAR.links.length + CAR.driveshafts.length + CAR.arbs.length * 2;
  CAR.diag.jointCount = CAR.joints.length + CAR.driveshafts.length * 2 + CAR.arbs.length * 4;
  CAR.diag.steeringLinks = CAR.links.filter((link) => link.kind === 'steer').length;
  CAR.diag.toeLinks = CAR.links.filter((link) => link.kind === 'toe').length;
  CAR.diag.driveshafts = CAR.driveshafts.length;
  CAR.diag.steeringRack = CAR.mechanics.steeringRack;
  CAR.diag.steeringColumn = CAR.mechanics.steeringColumn;
  CAR.diag.differential = CAR.mechanics.differential;
  CAR.diag.arbFront = CAR.mechanics.arbFront;
  CAR.diag.arbRear = CAR.mechanics.arbRear;
  CAR.diag.mechanicalOk = Boolean(
    CAR.mechanics.steeringRack &&
    CAR.mechanics.steeringColumn &&
    CAR.mechanics.differential &&
    CAR.mechanics.arbFront &&
    CAR.mechanics.arbRear &&
    CAR.links.filter((link) => link.kind === 'steer').length === 2 &&
    CAR.links.filter((link) => link.kind === 'toe').length === 2 &&
    CAR.driveshafts.length === 2 &&
    CAR.arbs.length === 2
  );
  CAR.diag.maxGapMm = Math.sqrt(maxGapSq) * 1000;
  CAR.diag.wheelCount = 4;
  CAR.diag.contactCount = 4;
  CAR.diag.contactGapMm = 0;
}

/* ------------------------------ car lifecycle ------------------------------ */

function updateCar(model) {
  if (!CAR.built) return;
  S.bodyPivot.position.set(0, model.heave, 0);
  _qPitch.setFromAxisAngle(_axisZ, model.pitch);
  _qRoll.setFromAxisAngle(_axisX, model.roll);
  S.bodyPivot.quaternion.copy(_qRoll).multiply(_qPitch);
  S.bodyPivot.updateMatrix();

  for (const corner of CAR.corners) {
    const root = corner.wheelRoot;
    if (!root) continue;
    corner.wheelRoot.position.set(corner.wheel.x, model.dims.R, corner.wheel.z);
    const yaw = corner.front ? state.steer * DEG : 0;
    const camber = -corner.zSign * (corner.front ? 1.15 : 0.8) * DEG;
    _qYaw.setFromAxisAngle(_axisY, yaw);
    _qCamber.setFromAxisAngle(_axisX, camber);
    root.quaternion.copy(_qYaw).multiply(_qCamber);
    root.updateMatrix();
    root.updateMatrixWorld(true);
  }

  if (CAR.steeringWheel) {
    CAR.steeringWheel.rotation.x = -state.steer * DEG * 2.1;
  }

  updateSuspension(model);
  CAR.built = true;
}

function buildCar(model) {
  initCarSceneGroups();
  disposeGroupChildren(S.bodyPivot);
  if (CAR.dynamicGroup) disposeGroupChildren(CAR.dynamicGroup);

  CAR.shellMeshes = [];
  CAR.wheels = [];
  CAR.corners = buildCornerData(model);
  CAR.links = [];
  CAR.joints = [];
  CAR.driveshafts = [];
  CAR.springs = [];
  CAR.rockers = [];
  CAR.arbs = [];
  CAR.mechanics = {
    steeringRack: false,
    steeringColumn: false,
    differential: false,
    arbFront: false,
    arbRear: false,
    steeringPoint: null,
    columnPoint: null,
    diffPoint: null,
    arbPoints: {}
  };
  CAR.steeringWheel = null;
  CAR.bodyworkGroup = null;
  CAR.internalGroup = null;
  CAR.dims = model.dims;
  CAR.built = false;

  S.bodyPivot.position.set(0, model.heave, 0);
  S.bodyPivot.quaternion.identity();

  buildBodywork(model);

  for (const corner of CAR.corners) {
    buildWheelAssembly(corner, model);
    CAR.wheels.push(corner.wheelRoot);
    CAR.rockers.push(corner.rocker);
  }

  buildInternalSuspension(CAR.corners);
  buildSuspensionLinks(CAR.corners);

  CAR.built = true;
  applyXray();
  updateCar(model);
  S.scene.updateMatrixWorld(true);
}

function getCarDiagnostics() {
  return Object.assign({}, CAR.diag);
}
