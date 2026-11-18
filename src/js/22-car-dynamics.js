/* =========================================================================
   22-car-dynamics.js — wheels, wishbones, rockers, springs, ARBs and updates
   ========================================================================= */

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _vecD = new THREE.Vector3();
const _vecE = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _qSteer = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
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

/** A torus whose hole faces along local Z, used for every visible joint eye. */
function addEyeRing(parent, position, radius, tube = 0.005, material = MAT.titanium) {
  const eye = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 18), material);
  eye.position.copy(position);
  eye.castShadow = true;
  parent.add(eye);
  return eye;
}

/** A cylindrical boss between two Z stations at fixed X/Y (wheel carrier). */
function addBossAlongZ(parent, x, y, zFrom, zTo, radius, material = MAT.titanium) {
  const length = Math.abs(zTo - zFrom);
  if (!(length > 1e-4)) return null;
  const boss = new THREE.Mesh(CAR.shared.cylinder, material);
  boss.scale.set(radius, length, radius);
  boss.quaternion.setFromUnitVectors(_axisY, _axisZ);
  boss.position.set(x, y, (zFrom + zTo) * 0.5);
  boss.castShadow = true;
  parent.add(boss);
  return boss;
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

  // Non-rotating upright, built from the wheel-local joints that the links and
  // the push/pull rod actually use. Every boss reaches the real ball-joint
  // plane so the visible arms are attached instead of floating near the wheel.
  const upright = new THREE.Group();
  root.add(upright);
  const joints = [
    { point: corner.wheelLocal.lower, boss: 0.030, eye: 0.020 },
    { point: corner.wheelLocal.upper, boss: 0.030, eye: 0.020 },
    { point: corner.wheelLocal.push, boss: 0.026, eye: 0.016, rod: true },
    { point: corner.wheelLocal.track, boss: 0.024, eye: 0.014, track: true }
  ];
  const plateZ = -zSign * width * 0.10;
  const plateDepth = 0.052;
  const plateHalfHeight = Math.min(0.214, Math.max(...joints.map((joint) => Math.abs(joint.point.y))) + 0.012);
  const plate = makeRoundedBox(0.095, plateHalfHeight * 2, plateDepth, 0.025, MAT.darkMetal);
  plate.position.set(-0.005, 0, plateZ);
  upright.add(plate);
  const plateOuterZ = plateZ - zSign * plateDepth * 0.5;
  for (const joint of joints) {
    const point = joint.point;
    if (joint.track) {
      // The steering arm runs behind the brake disc: a boss leaves the carrier
      // below the disc radius, then an arm carries the ball joint outboard.
      const armRootY = -0.180;
      addBossAlongZ(upright, 0, armRootY, plateOuterZ, point.z, joint.boss, MAT.titanium);
      addStaticRod(upright, V(0, armRootY, point.z), point.clone(), 0.014, MAT.titanium);
    } else {
      addBossAlongZ(upright, point.x, point.y, plateOuterZ, point.z, joint.boss, MAT.titanium);
    }
    addEyeRing(upright, point, joint.eye, 0.0055, MAT.titanium);
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

  if (!corner.front) {
    const drive = corner.wheelLocal.drive;
    const driveFlange = new THREE.Mesh(CAR.shared.cylinder, MAT.steel);
    driveFlange.scale.set(0.058, 0.036, 0.058);
    driveFlange.rotation.x = Math.PI / 2;
    driveFlange.position.set(drive.x, drive.y, drive.z);
    driveFlange.castShadow = true;
    spinner.add(driveFlange);
    const flangeRing = new THREE.Mesh(CAR.shared.torus, MAT.titanium);
    flangeRing.scale.setScalar(0.062);
    flangeRing.rotation.x = Math.PI / 2;
    flangeRing.position.set(drive.x, drive.y, drive.z - zSign * 0.015);
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

/* ------------------------------ bodywork probes ------------------------------ */

/**
 * Ray probes against the real bodywork meshes. The shell is a closed loft, so a
 * normal front-face ray cannot be cast from inside. For internal brackets the
 * probe temporarily makes the shell double-sided and casts outward from the
 * hardpoint (first hit = nearest interior wall); for skin penetrations it casts
 * inward from the outside (first hit = outer skin). This avoids duplicating the
 * body envelope in this file and follows any later bodywork change.
 */
function bodyworkRayMaterials() {
  const materials = new Set();
  if (!CAR.bodyworkGroup) return materials;
  CAR.bodyworkGroup.traverse((object) => {
    if (!object.isMesh) return;
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => { if (item) materials.add(item); });
    else if (material) materials.add(material);
  });
  return materials;
}

function probeBodySurface(origin, direction, maxDistance, inside) {
  if (!CAR.bodyworkGroup || !S.bodyPivot) return null;
  const dir = direction.clone().normalize();
  S.bodyPivot.updateMatrixWorld(true);
  const originWorld = origin.clone().applyMatrix4(S.bodyPivot.matrixWorld);
  const dirWorld = dir.clone().transformDirection(S.bodyPivot.matrixWorld);
  const materials = bodyworkRayMaterials();
  const savedSides = new Map();
  materials.forEach((material) => {
    savedSides.set(material, material.side);
    material.side = THREE.DoubleSide;
  });
  let hit = null;
  try {
    const raycaster = new THREE.Raycaster(originWorld, dirWorld, 1e-4, maxDistance);
    const hits = raycaster.intersectObject(CAR.bodyworkGroup, true);
    for (const candidate of hits) {
      if (!candidate.object.isMesh) continue;
      if (candidate.object.userData.isDecal) continue;
      hit = candidate;
      break;
    }
  } finally {
    savedSides.forEach((side, material) => { material.side = side; });
  }
  if (!hit) return null;
  const point = S.bodyPivot.worldToLocal(hit.point.clone());
  const normal = hit.face
    ? hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld)
      .applyQuaternion(S.bodyPivot.quaternion.clone().invert())
      .normalize()
    : dir.clone().negate();
  const outwardHint = inside ? dir : dir.clone().negate();
  if (normal.dot(outwardHint) < 0) normal.negate();
  return { point, normal, distance: hit.distance, object: hit.object };
}

function addSkinPad(parent, hit, width = 0.065, height = 0.065, material = MAT.carbonMatte) {
  // A shallow disc parallel to the local surface; the flat face is placed just
  // inside the skin so no vertex of the internal group pokes through.
  const radius = Math.max(0.018, Math.min(width, height) * 0.5);
  const pad = new THREE.Mesh(CAR.shared.cylinder, material);
  pad.scale.set(radius, 0.010, radius);
  pad.quaternion.setFromUnitVectors(_axisY, hit.normal);
  pad.position.copy(hit.point).addScaledVector(hit.normal, -0.009);
  pad.castShadow = true;
  parent.add(pad);
  return pad;
}

/* ------------------------------ internal rockers ------------------------------ */

const ROCKER_THICKNESS = 0.014;
const ROCKER_BOSS_RADIUS = 0.031;

function rockerArmSpecs(corner) {
  return [
    { arm: corner.rocker.pushArm, hole: 0.0085, rim: 0.0065, tube: 0.0040 },
    { arm: corner.rocker.damperArm, hole: 0.0100, rim: 0.0070, tube: 0.0046 },
    { arm: corner.rocker.arbArm, hole: 0.0068, rim: 0.0058, tube: 0.0036 }
  ];
}

function convexHull2D(points) {
  const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The rocker plate is the convex envelope of the three real arm eyes plus the
 * bearing boss. Its arm lengths therefore come from the shared hardpoints, and
 * the pivot and all three eyes are cut as bearing holes instead of painted on.
 */
function buildRockerPlateGeometry(corner) {
  const specs = rockerArmSpecs(corner);
  const points = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * TAU;
    points.push([Math.cos(angle) * ROCKER_BOSS_RADIUS, Math.sin(angle) * ROCKER_BOSS_RADIUS]);
  }
  for (const spec of specs) {
    const outer = spec.hole + spec.rim;
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * TAU;
      points.push([spec.arm.x + Math.cos(angle) * outer, spec.arm.y + Math.sin(angle) * outer]);
    }
  }
  const hull = convexHull2D(points);
  const shape = new THREE.Shape(hull.map(([x, y]) => new THREE.Vector2(x, y)));
  const pivotHole = new THREE.Path();
  pivotHole.absarc(0, 0, 0.013, 0, TAU, true);
  shape.holes.push(pivotHole);
  for (const spec of specs) {
    if (Math.hypot(spec.arm.x, spec.arm.y) < 0.02) continue;
    const eyeHole = new THREE.Path();
    eyeHole.absarc(spec.arm.x, spec.arm.y, spec.hole, 0, TAU, true);
    shape.holes.push(eyeHole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: ROCKER_THICKNESS,
    bevelEnabled: true,
    bevelSize: 0.0015,
    bevelThickness: 0.0015,
    bevelSegments: 1,
    curveSegments: 10
  });
  geometry.translate(0, 0, -ROCKER_THICKNESS * 0.5);
  return geometry;
}

function buildRockerAssembly(corner, group) {
  const rockerGroup = new THREE.Group();
  rockerGroup.name = 'rocker-' + corner.key;
  rockerGroup.position.copy(corner.rocker.pivot);
  rockerGroup.rotation.z = corner.rocker.baseAngle;
  group.add(rockerGroup);

  const plate = new THREE.Mesh(buildRockerPlateGeometry(corner), MAT.carbon);
  plate.castShadow = true;
  plate.receiveShadow = true;
  rockerGroup.add(plate);

  for (const spec of rockerArmSpecs(corner)) {
    addEyeRing(rockerGroup, V(spec.arm.x, spec.arm.y, 0), spec.hole + 0.002, spec.tube, MAT.titanium);
  }
  for (const side of [-1, 1]) {
    const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0048, 5, 20), MAT.titanium);
    bearing.position.set(0, 0, side * (ROCKER_THICKNESS * 0.5 + 0.0035));
    bearing.castShadow = true;
    rockerGroup.add(bearing);
  }
  corner.rocker.mesh = rockerGroup;
  corner.rocker.plate = plate;
}

/**
 * Bearing pedestal for the rocker axle. The front rockers hang from the
 * monocoque roof on a two-plate clevis; the rear rockers are cantilevered from
 * the casing side wall. Both anchors are found by probing the built bodywork.
 */
function buildRockerBearing(corner, group) {
  const pivot = corner.rocker.pivot;
  const zSign = corner.zSign;
  const axle = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
  axle.scale.set(0.011, ROCKER_THICKNESS + 0.060, 0.011);
  axle.quaternion.setFromUnitVectors(_axisY, _axisZ);
  axle.position.copy(pivot);
  axle.castShadow = true;
  group.add(axle);
  corner.rocker.axle = axle;

  for (const side of [-1, 1]) {
    const collar = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
    collar.scale.set(0.019, 0.008, 0.019);
    collar.quaternion.setFromUnitVectors(_axisY, _axisZ);
    collar.position.set(pivot.x, pivot.y, pivot.z + side * (ROCKER_THICKNESS * 0.5 + 0.004));
    collar.castShadow = true;
    group.add(collar);
  }

  let anchored = false;
  if (corner.front) {
    const zOffset = ROCKER_THICKNESS * 0.5 + 0.010;
    for (const side of [-1, 1]) {
      const z = pivot.z + side * zOffset;
      const base = V(pivot.x, pivot.y, z);
      const hit = probeBodySurface(base, V(0, 1, 0), 0.25, true);
      if (!hit) continue;
      const foot = V(pivot.x, hit.point.y - 0.004, z);
      addStaticRod(group, base, foot, 0.0075, MAT.carbonMatte);
      addSkinPad(group, hit, 0.055, 0.040);
      anchored = true;
    }
  } else {
    const axis = V(0, 0, zSign);
    const hit = probeBodySurface(pivot, axis, 0.22, true);
    if (hit) {
      const foot = hit.point.clone().addScaledVector(hit.normal, -0.004);
      addStaticRod(group, pivot, foot, 0.011, MAT.titanium);
      addSkinPad(group, hit, 0.050, 0.050);
      anchored = true;
    }
  }
  if (anchored) CAR.diag.rockerBearingHits += 1;
  else {
    CAR.diag.rockerBearingMisses += 1;
    CAR.diag.rockerBearingMissing.push(corner.key);
  }
}

/**
 * Body-side damper mount. The eye is represented by a transverse pin and a
 * bush at the shared body.damper point; a probe-placed pedestal ties it to the
 * nearest interior surface (front: monocoque roof; rear: engine-cover floor).
 */
function buildDamperMount(corner, group) {
  const mount = corner.body.damper;
  addBossAlongZ(group, mount.x, mount.y, mount.z - 0.026, mount.z + 0.026, 0.019, MAT.darkMetal);
  addEyeRing(group, mount, 0.017, 0.005, MAT.titanium);
  const pin = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
  pin.scale.set(0.008, 0.064, 0.008);
  pin.quaternion.setFromUnitVectors(_axisY, _axisZ);
  pin.position.copy(mount);
  pin.castShadow = true;
  group.add(pin);

  let best = null;
  for (const up of [1, -1]) {
    const hit = probeBodySurface(mount, V(0, up, 0), 0.30, true);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
  }
  if (!best) {
    CAR.diag.damperMountMisses += 1;
    CAR.diag.damperMountMissing.push(corner.key);
    return;
  }
  const foot = best.point.clone().addScaledVector(best.normal, -0.004);
  addStaticRod(group, mount, foot, 0.012, MAT.carbon);
  addSkinPad(group, best, 0.060, 0.050);
  if (best.distance > 0.12) {
    const offsetX = Math.sign(mount.x) * 0.065;
    const braceBase = V(mount.x + offsetX, mount.y, mount.z);
    const braceHit = probeBodySurface(braceBase, V(0, Math.sign(best.point.y - mount.y), 0), 0.30, true);
    if (braceHit) {
      const braceFoot = braceHit.point.clone().addScaledVector(braceHit.normal, -0.004);
      addStaticRod(group, mount, braceFoot, 0.008, MAT.carbonMatte);
      addSkinPad(group, braceHit, 0.045, 0.035);
    }
  }
  CAR.diag.damperMountHits += 1;
}

function buildInternalSuspension(corners) {
  const skinMounts = new THREE.Group();
  skinMounts.name = 'suspensionSkinMounts';
  S.bodyPivot.add(skinMounts);
  CAR.skinMountGroup = skinMounts;
  const group = new THREE.Group();
  group.name = 'internalSuspension';
  S.bodyPivot.add(group);
  CAR.internalGroup = group;

  CAR.diag.rockerBearingHits = 0;
  CAR.diag.rockerBearingMisses = 0;
  CAR.diag.rockerBearingMissing = [];
  CAR.diag.damperMountHits = 0;
  CAR.diag.damperMountMisses = 0;
  CAR.diag.damperMountMissing = [];
  CAR.diag.rodBushingHits = 0;
  CAR.diag.rodBushingMisses = 0;
  CAR.diag.rodBushingMissing = [];
  CAR.diag.arbBracketHits = 0;
  CAR.diag.arbBracketMisses = 0;
  CAR.diag.rockerArmMm = corners.map((corner) => [
    corner.rocker.pushArm.length() * 1000,
    corner.rocker.damperArm.length() * 1000,
    corner.rocker.arbArm.length() * 1000
  ]);
  CAR.diag.arbArmMm = corners.map((corner) => corner.rocker.arbArm.length() * 1000);

  S.bodyPivot.updateMatrixWorld(true);
  for (const corner of corners) {
    buildRockerAssembly(corner, group);
    buildRockerBearing(corner, group);
    buildDamperMount(corner, group);
  }

  buildAntiRollBars(corners, group);
  buildSteeringMechanics(corners, group);
  buildDifferentialMechanics(corners, group);
}

/* ------------------------------ anti-roll bars ------------------------------ */

const ARB_ARM_LENGTH = 0.16;
const ARB_REAR_ARM_LENGTH = 0.20;
const ARB_BLADE_WIDTH = 0.052;
const ARB_BLADE_THICKNESS = 0.009;
const ARB_REST_ANGLE = Math.PI + 0.15;

/**
 * ARB centre positions relative to the shared rocker pivot. Both levers point
 * to -X, so heave moves them together (no torsion) and roll twists the bar.
 * The rear bar is lowered from the nominal +0.140 m to +0.080 m: at +0.140 m
 * the transverse bar passes through the rear horizontal spring-damper, which
 * runs from the rocker eye to the engine-cover mount at y≈0.363 m. The lower
 * position clears that unit by 63 mm and still closes over the full rocker
 * travel with a 0.20 m lever.
 */
const ARB_LAYOUT = {
  front: { xOffset: 0.105, yOffset: -0.045, armLength: ARB_ARM_LENGTH, armInset: 0.045 },
  rear: { xOffset: 0.250, yOffset: 0.080, armLength: ARB_REAR_ARM_LENGTH, armInset: 0.032 }
};
const ARB_ARM_DIR = -1;

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

/** Distance between two infinite lines, used for the bar/damper packaging check. */
function lineDistance(p1, d1, p2, d2) {
  const cross = new THREE.Vector3().crossVectors(d1, d2);
  const length = cross.length();
  if (length < 1e-9) return new THREE.Vector3().subVectors(p2, p1).length();
  return Math.abs(new THREE.Vector3().subVectors(p2, p1).dot(cross.divideScalar(length)));
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
  CAR.diag.arbLayout = {};
  CAR.diag.arbStemGapMm = 0;
  CAR.diag.arbBracketHits = 0;
  CAR.diag.arbBracketMisses = 0;
  for (const axleName of ['front', 'rear']) {
    const pair = corners.filter((corner) => (axleName === 'front' ? corner.front : !corner.front));
    if (pair.length < 2) continue;
    const left = pair.find((corner) => corner.zSign < 0);
    const right = pair.find((corner) => corner.zSign > 0);
    if (!left || !right) continue;
    const rocker = left.rocker;
    const layout = ARB_LAYOUT[axleName];
    const zEnd = Math.abs(rocker.pivot.z);
    const armZ = Math.max(0.055, zEnd - layout.armInset);
    const linkZSpan = zEnd - armZ;
    const barX = rocker.pivot.x + layout.xOffset;
    const barY = rocker.pivot.y + layout.yOffset;
    const restAngle = ARB_REST_ANGLE;

    const anchorRest = rockerBodyPoint(left, rocker.arbArm, rocker.baseAngle);
    const tipRestX = barX + layout.armLength * Math.cos(restAngle);
    const tipRestY = barY + layout.armLength * Math.sin(restAngle);
    const linkLength = Math.hypot(tipRestX - anchorRest.x, tipRestY - anchorRest.y, linkZSpan);
    const planarLinkLength = Math.sqrt(Math.max(1e-8, linkLength * linkLength - linkZSpan * linkZSpan));

    const barRoot = new THREE.Group();
    barRoot.name = 'antiRollBar-' + axleName;
    barRoot.position.set(barX, barY, 0);
    group.add(barRoot);

    // Centre clamp and outboard bearings. The bar rotates inside these; the
    // bearings stay fixed to the chassis through short probe-placed brackets.
    const sleeve = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
    sleeve.scale.set(0.027, 0.078, 0.027);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.castShadow = true;
    barRoot.add(sleeve);

    for (const sign of [-1, 1]) {
      const bearingZ = sign * armZ * 0.58;
      const bearing = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
      bearing.scale.set(0.031, 0.044, 0.031);
      bearing.rotation.x = Math.PI / 2;
      bearing.position.z = bearingZ;
      bearing.castShadow = true;
      barRoot.add(bearing);

      const center = V(barX, barY, bearingZ);
      let best = null;
      for (const up of [1, -1]) {
        const hit = probeBodySurface(center, V(0, up, 0), 0.12, true);
        if (!hit) continue;
        if (!best || hit.distance < best.distance) best = hit;
      }
      if (best) {
        const foot = best.point.clone().addScaledVector(best.normal, -0.004);
        addStaticRod(group, center, foot, 0.009, MAT.carbonMatte);
        addSkinPad(group, best, 0.055, 0.045);
        CAR.diag.arbBracketHits += 1;
      } else {
        CAR.diag.arbBracketMisses += 1;
      }
    }

    // Two half-shafts meet at the centre clamp. A bright stripe records the
    // local bar rotation, so the torsion between left and right ends is visible.
    const halves = {};
    for (const sign of [-1, 1]) {
      const half = new THREE.Group();
      half.position.z = sign * armZ / 2;
      const tube = new THREE.Mesh(CAR.shared.cylinder, MAT.arbBar);
      tube.scale.set(0.0145, armZ, 0.0145);
      tube.rotation.x = Math.PI / 2;
      tube.castShadow = true;
      half.add(tube);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0035, Math.max(0.01, armZ - 0.012)), MAT.arbBlade);
      stripe.position.set(0.0145, 0, 0);
      half.add(stripe);
      barRoot.add(half);
      halves[sign] = half;
      // The half shaft reaches the lever plane. Measure the residual clearance
      // to the root collar instead of relying on drop-link closure alone.
      const stemOuterZ = Math.abs(half.position.z) + tube.scale.y * 0.5;
      const stemGapMm = Math.max(0, armZ - 0.024 - stemOuterZ) * 1000;
      CAR.diag.arbStemGapMm = Math.max(CAR.diag.arbStemGapMm, stemGapMm);
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
          new THREE.BoxGeometry(layout.armLength - 0.04, ARB_BLADE_WIDTH, ARB_BLADE_THICKNESS),
          MAT.arbBlade
        );
        blade.position.x = 0.02 + (layout.armLength - 0.04) / 2;
        blade.castShadow = true;
        blade.receiveShadow = true;
        bladeRoll.add(blade);
        const tipBlock = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, ARB_BLADE_WIDTH * 0.82, ARB_BLADE_THICKNESS * 1.25),
          MAT.darkMetal
        );
        tipBlock.position.x = layout.armLength - 0.012;
        tipBlock.castShadow = true;
        bladeRoll.add(tipBlock);

        // A small orange adjuster knob marks the blade's own rotation axis.
        const adjuster = new THREE.Mesh(CAR.shared.cylinder, MAT.arbAdjuster);
        adjuster.scale.set(0.018, 0.026, 0.018);
        adjuster.rotation.z = -Math.PI / 2;
        adjuster.position.x = 0.020;
        armGroup.add(adjuster);
      } else {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.015, layout.armLength, 10), MAT.arbBar);
        arm.rotation.z = -Math.PI / 2;
        arm.position.x = layout.armLength / 2;
        arm.castShadow = true;
        armGroup.add(arm);
      }

      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0055, 5, 12), MAT.titanium);
      eye.position.x = layout.armLength;
      armGroup.add(eye);
      const tipJoint = new THREE.Mesh(CAR.shared.joint, MAT.titanium);
      tipJoint.scale.setScalar(0.012);
      tipJoint.position.x = layout.armLength;
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
        armLength: layout.armLength,
        restAngle,
        angle: restAngle,
        link,
        linkA,
        linkB,
        linkLength,
        planarLinkLength,
        linkZSpan,
        armZ,
        stretchMm: 0,
        closurePlusMm: (layout.armLength + planarLinkLength -
          Math.hypot(anchorRest.x - barX, anchorRest.y - barY)) * 1000,
        closureMinusMm: (Math.hypot(anchorRest.x - barX, anchorRest.y - barY) -
          Math.abs(layout.armLength - planarLinkLength)) * 1000,
        tip: new THREE.Vector3(),
        anchor: new THREE.Vector3(),
        barHalf: halves[sign]
      };
    }

    const damperTip = suspRockerPoint(left, left.rocker.damperArm, left.rocker.baseAngle);
    const damperAxis = left.body.damper.clone().sub(damperTip);
    const barAxis = V(0, 0, 1);
    const clearanceMm = lineDistance(V(barX, barY, 0), barAxis, damperTip, damperAxis) * 1000;

    CAR.arbs.push({
      axle: axleName,
      barRoot,
      barX,
      barY,
      zEnd,
      armZ,
      armDir: ARB_ARM_DIR,
      restAngle,
      armLength: layout.armLength,
      clearanceToDamperMm: clearanceMm,
      sides,
      bladeAngle: 0,
      twistDeg: 0,
      stretchMm: 0,
      point: V(barX, barY + 0.055, 0)
    });
    CAR.mechanics.arbPoints[axleName] = V(barX, barY + 0.055, 0);
    CAR.diag.arbLayout[axleName] = {
      x: barX,
      y: barY,
      armLength: layout.armLength,
      armHalfZ: armZ,
      restAngleDeg: restAngle * RAD,
      clearanceToDamperMm: clearanceMm
    };
  }
  CAR.mechanics.arbFront = CAR.arbs.some((arb) => arb.axle === 'front');
  CAR.mechanics.arbRear = CAR.arbs.some((arb) => arb.axle === 'rear');
  CAR.diag.arbArmLengthMm = CAR.arbs.map((arb) => arb.armLength * 1000);
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
  let minClosurePlus = Infinity;
  let minClosureMinus = Infinity;
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
      const planarDistance = Math.hypot(anchor.x - arb.barX, anchor.y - arb.barY);
      const planarLink = side.planarLinkLength;
      side.closurePlusMm = (side.armLength + planarLink - planarDistance) * 1000;
      side.closureMinusMm = (planarDistance - Math.abs(side.armLength - planarLink)) * 1000;
      minClosurePlus = Math.min(minClosurePlus, side.closurePlusMm);
      minClosureMinus = Math.min(minClosureMinus, side.closureMinusMm);
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
  CAR.diag.arbClosurePlusMinMm = Number.isFinite(minClosurePlus) ? minClosurePlus : 0;
  CAR.diag.arbClosureMinusMinMm = Number.isFinite(minClosureMinus) ? minClosureMinus : 0;
  CAR.diag.arbClosureOk = CAR.diag.arbClosurePlusMinMm > 0 && CAR.diag.arbClosureMinusMinMm > 0;
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
 * tie rods. The rack slides along z; the tie rods keep their design length; the
 * front uprights rotate about the kingpin axis defined by the lower and upper
 * ball joints.
 */
function buildSteeringMechanics(corners, group) {
  const front = corners.find((corner) => corner.front);
  if (!front) return;
  const xF = front.wheel.x;
  // The rack axis and its inner tie-rod points are the shared front body.track
  // hardpoints. No rack position constant is duplicated here.
  const trackBase = front.body.trackBase;
  const rackX = trackBase.x;
  const rackY = trackBase.y;
  const rackHalf = Math.abs(trackBase.z);

  const rackGroup = new THREE.Group();
  rackGroup.name = 'steeringRack';
  rackGroup.position.set(rackX, rackY, 0);
  group.add(rackGroup);
  const rackRod = new THREE.Mesh(CAR.shared.cylinder, MAT.steel);
  rackRod.scale.set(0.022, rackHalf * 2, 0.022);
  rackRod.rotation.x = Math.PI / 2;
  rackRod.castShadow = true;
  rackGroup.add(rackRod);
  for (const sign of [-1, 1]) {
    const socket = new THREE.Mesh(CAR.shared.joint, MAT.steel);
    socket.scale.setScalar(0.018);
    socket.position.set(0, 0, sign * rackHalf);
    socket.castShadow = true;
    rackGroup.add(socket);
  }
  CAR.mechanics.rackGroup = rackGroup;

  // Centre pinion housing and column.
  const pinion = makeRoundedBox(0.11, 0.10, 0.11, 0.025, MAT.darkMetal);
  pinion.position.set(rackX, rackY + 0.055, 0);
  pinion.castShadow = true;
  group.add(pinion);

  const steeringX = xF - 1.88 + 0.42;
  const steeringY = 0.658 - 0.07;
  const columnA = V(steeringX, steeringY, 0);
  const columnB = V(rackX, rackY + 0.085, 0);
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

  // Rack boots and housing saddles, all derived from the same half-length.
  const bootLength = clamp(rackHalf * 0.52, 0.08, 0.13);
  const bootZ = rackHalf - bootLength * 0.5 - 0.008;
  const mountZ = rackHalf * 0.62;
  for (const sign of [-1, 1]) {
    const boot = createBellows(bootLength, 0.034);
    boot.position.set(rackX, rackY, sign * bootZ);
    boot.quaternion.setFromUnitVectors(_axisY, _axisZ);
    group.add(boot);
    const saddle = makeRoundedBox(0.060, 0.060, 0.045, 0.012, MAT.darkMetal);
    saddle.position.set(rackX, rackY - 0.030, sign * mountZ);
    saddle.castShadow = true;
    group.add(saddle);
    const mountFoot = makeRoundedBox(0.080, 0.014, 0.060, 0.008, MAT.carbonMatte);
    mountFoot.position.set(rackX, rackY - 0.064, sign * mountZ);
    mountFoot.castShadow = true;
    group.add(mountFoot);
  }

  const left = corners.find((corner) => corner.front && corner.zSign < 0);
  const right = corners.find((corner) => corner.front && corner.zSign > 0);
  let socketErrorMm = 0;
  if (left && right) {
    const socketL = V(rackX, rackY, -rackHalf);
    const socketR = V(rackX, rackY, rackHalf);
    socketErrorMm = Math.max(
      socketL.distanceTo(left.body.trackBase),
      socketR.distanceTo(right.body.trackBase)
    ) * 1000;
  }
  CAR.diag.rackX = rackX;
  CAR.diag.rackY = rackY;
  CAR.diag.rackHalf = rackHalf;
  CAR.diag.rackSocketErrorMm = socketErrorMm;
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
  const diff = rear.body.diff;
  const diffX = diff.x;
  const diffY = diff.y;
  const diffHalfZ = Math.abs(diff.z);
  const casingY = diffY + 0.01;

  const casing = makeRoundedBox(0.30, 0.24, 0.27, 0.055, MAT.darkMetal);
  casing.position.set(diffX, casingY, 0);
  casing.castShadow = true;
  casing.receiveShadow = true;
  group.add(casing);
  const cover = makeRoundedBox(0.15, 0.17, 0.22, 0.035, MAT.steel);
  cover.position.set(diffX + 0.13, casingY, 0);
  cover.castShadow = true;
  group.add(cover);
  addStaticRod(group, V(diffX, diffY, -diffHalfZ), V(diffX, diffY, diffHalfZ), 0.036, MAT.steel);

  for (const sign of [-1, 1]) {
    const flange = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
    flange.scale.set(0.055, 0.035, 0.055);
    flange.rotation.x = Math.PI / 2;
    flange.position.set(diffX, diffY, sign * (diffHalfZ - 0.018));
    flange.castShadow = true;
    group.add(flange);
    // The output ring is coaxial with the halfshaft (axis Z); no extra rotation.
    const ring = new THREE.Mesh(CAR.shared.torus, MAT.darkMetal);
    ring.scale.setScalar(0.055);
    ring.position.set(diffX, diffY, sign * (diffHalfZ - 0.008));
    group.add(ring);
  }

  // Casing ribs / bolts.
  for (let i = -1; i <= 1; i += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.19, 0.235), MAT.steel);
    rib.position.set(diffX + i * 0.055, casingY, 0);
    group.add(rib);
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU;
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), MAT.titanium);
    bolt.position.set(diffX + 0.13, casingY + Math.cos(angle) * 0.085, Math.sin(angle) * 0.09);
    group.add(bolt);
  }

  CAR.diag.diffX = diffX;
  CAR.diag.diffY = diffY;
  CAR.diag.diffHalfZ = diffHalfZ;
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

function designAnchorPosition(spec, corner) {
  if (!spec) return new THREE.Vector3();
  if (spec.type === 'body') return spec.local.clone();
  if (spec.type === 'wheel') return spec.local.clone().applyQuaternion(corner.restQuat).add(corner.restCenter);
  if (spec.type === 'pushTip') return rockerBodyPoint(corner, corner.rocker.pushArm, corner.rocker.baseAngle);
  if (spec.type === 'damperTip') return rockerBodyPoint(corner, corner.rocker.damperArm, corner.rocker.baseAngle);
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
  const length0 = designAnchorPosition(aSpec, corner).distanceTo(designAnchorPosition(bSpec, corner));
  const link = {
    corner,
    aSpec,
    bSpec,
    mesh,
    jointA,
    jointB,
    radius,
    kind,
    length0,
    stretchMm: 0,
    lastA: new THREE.Vector3(),
    lastB: new THREE.Vector3()
  };
  if (kind === 'steer') corner.tieRodLength0 = length0;
  if (kind === 'pushrod' || kind === 'pullrod') corner.pushRodLength0 = length0;
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

/**
 * Pass-through seat where a push/pull rod crosses the body skin. The skin
 * point is probed from outside along the design rod axis, so it follows the
 * actual bodywork and stays on the outer surface. The seat belongs to the
 * exposed rod installation, not the hidden inboard suspension; it never changes
 * the rod pose and remains visible in both normal and x-ray views.
 */
function buildRodSkinBushing(corner, wheelSpec, rockerSpec) {
  if (!CAR.skinMountGroup) return;
  const outer = designAnchorPosition(wheelSpec, corner);
  const inner = designAnchorPosition(rockerSpec, corner);
  const delta = inner.clone().sub(outer);
  const span = delta.length();
  if (!(span > 1e-4)) {
    CAR.diag.rodBushingMisses += 1;
    CAR.diag.rodBushingMissing.push(corner.key);
    return;
  }
  const inward = delta.divideScalar(span);
  const hit = probeBodySurface(outer, inward, span, false);
  if (!hit || hit.distance > span * 0.995) {
    CAR.diag.rodBushingMisses += 1;
    CAR.diag.rodBushingMissing.push(corner.key);
    return;
  }
  // Flush reinforcement washer on the skin plus a short internal sleeve; this
  // keeps the seat from poking through the envelope while still showing the rod
  // passing through a bush.
  const washer = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.032, 24), MAT.titanium);
  washer.position.copy(hit.point).addScaledVector(hit.normal, 0.001);
  washer.quaternion.setFromUnitVectors(_axisZ, hit.normal);
  washer.castShadow = true;
  CAR.skinMountGroup.add(washer);
  const sleeveA = hit.point.clone().addScaledVector(inward, 0.005);
  const sleeveB = hit.point.clone().addScaledVector(inward, 0.035);
  addStaticRod(CAR.skinMountGroup, sleeveA, sleeveB, 0.017, MAT.darkMetal);
  addStaticJoint(CAR.skinMountGroup, sleeveB, 0.014, MAT.titanium);
  CAR.diag.rodBushingHits += 1;
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
    buildRodSkinBushing(corner, push, bRockerPush);
    if (!isFront) addDriveshaft(corner);

    // Spring / damper assembly: a longitudinal, near-horizontal unit between the
    // body mount and the rocker eye. The unit is placed and oriented from the
    // solved endpoints every frame; only its length scales the coil, never its
    // radius or the coil wire.
    const assembly = new THREE.Group();
    assembly.name = 'spring-damper-' + corner.key;
    const coil = new THREE.Mesh(CAR.shared.spring, MAT.springCoil);
    coil.castShadow = true;
    const damper = new THREE.Mesh(CAR.shared.cylinder, MAT.titanium);
    damper.castShadow = true;
    const capA = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
    const capB = new THREE.Mesh(CAR.shared.cylinder, MAT.darkMetal);
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

function applyRack(model) {
  const shift = model && Number.isFinite(model.rackShift) ? model.rackShift : 0;
  for (const corner of CAR.corners) {
    corner.rackShift = corner.front ? shift : 0;
    corner.body.track.z = corner.body.trackBase.z + corner.rackShift;
  }
  if (CAR.mechanics.rackGroup) CAR.mechanics.rackGroup.position.z = shift;
  CAR.diag.rackTravelMm = shift * 1000;
}

function solveRockerAngle(corner, bodyMatrix, wheelMatrix, fallback) {
  const target = corner.pushRodLength0;
  if (!target) return fallback;
  const wheelPush = _vecA.copy(corner.wheelLocal.push).applyMatrix4(wheelMatrix);
  const pivot = corner.rocker.pivot;
  const arm = corner.rocker.pushArm;
  const distanceAt = (angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    _vecB.set(
      pivot.x + arm.x * cos - arm.y * sin,
      pivot.y + arm.x * sin + arm.y * cos,
      pivot.z + arm.z
    ).applyMatrix4(bodyMatrix);
    return _vecB.distanceTo(wheelPush);
  };
  let angle = fallback;
  if (Math.abs(distanceAt(angle) - target) < 1e-6) {
    corner.rockerSolveFailed = false;
    return angle;
  }
  for (let i = 0; i < 10; i += 1) {
    const error = distanceAt(angle) - target;
    if (Math.abs(error) < 1e-7) {
      corner.rockerSolveFailed = false;
      return angle;
    }
    const h = 1e-4;
    const derivative = (distanceAt(angle + h) - distanceAt(angle - h)) / (2 * h);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-8) break;
    angle -= clamp(error / derivative, -0.35, 0.35);
    if (!Number.isFinite(angle)) break;
  }
  if (Math.abs(distanceAt(angle) - target) < 1e-5) {
    corner.rockerSolveFailed = false;
    return angle;
  }
  corner.rockerSolveFailed = true;
  return fallback;
}

function updateSuspension(model) {
  if (!model || !Number.isFinite(model.geometryRevision) || model.geometryRevision !== CAR.geometryRevision) {
    CAR.diag.geometryMismatch = true;
    return;
  }
  const bodyMatrix = S.bodyPivot.matrix;
  CAR.diag.coilLengthMm = new Array(CAR.corners.length).fill(0);
  CAR.diag.coilTiltDeg = new Array(CAR.corners.length).fill(0);
  CAR.diag.coilAxis = new Array(CAR.corners.length).fill(null);
  CAR.diag.rockerAngleDeg = new Array(CAR.corners.length).fill(0);
  applyRack(model);
  let maxLinkStretch = 0;
  let maxSuspLinkStretch = 0;
  let maxTieRodStretch = 0;
  let maxPushRodStretch = 0;

  for (let i = 0; i < CAR.corners.length; i += 1) {
    const corner = CAR.corners[i];
    corner.wheelRoot.updateMatrix();
    const wheelMatrix = corner.wheelRoot.matrix;
    const travel = -model.cornerY[i];
    const fallbackAngle = corner.rocker.baseAngle + travel * corner.rocker.gain;
    const solvedCorner = model.solved && model.solved[i] ? model.solved[i] : null;
    if (solvedCorner && solvedCorner.rocker && Number.isFinite(solvedCorner.rocker.angle)) {
      // Render-only display copy: the physics layer owns the seed and never
      // reads corner.angle back (B1-4).
      corner.angle = solvedCorner.rocker.angle;
      corner.rockerSolveFailed = !solvedCorner.rocker.feasible;
    } else {
      // Static rebuild before the first physics model exists: a display-only
      // fallback. Its result is never fed back into the solver.
      corner.angle = solveRockerAngle(corner, bodyMatrix, wheelMatrix, fallbackAngle);
    }
    corner.rocker.mesh.rotation.z = corner.angle;
    CAR.diag.rockerAngleDeg[i] = corner.angle * RAD;
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
      const stretch = Math.abs(a.distanceTo(b) - link.length0) * 1000;
      link.stretchMm = stretch;
      maxLinkStretch = Math.max(maxLinkStretch, stretch);
      if (link.kind === 'steer') maxTieRodStretch = Math.max(maxTieRodStretch, stretch);
      else maxSuspLinkStretch = Math.max(maxSuspLinkStretch, stretch);
      if (link.kind === 'pushrod' || link.kind === 'pullrod') maxPushRodStretch = Math.max(maxPushRodStretch, stretch);
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
        // Only the length axis scales; the lead-owned coil radius (0.040 m)
        // and the wire stay at their authored size.
        spring.coil.scale.set(1, length, 1);
        spring.damper.scale.set(0.016, length * 0.88, 0.016);
        spring.capA.position.y = -length / 2 + 0.006;
        spring.capB.position.y = length / 2 - 0.006;
        spring.capA.scale.set(0.042, 0.012, 0.042);
        spring.capB.scale.set(0.042, 0.012, 0.042);
        CAR.diag.coilLengthMm[i] = length * 1000;
        CAR.diag.coilTiltDeg[i] = Math.asin(clamp(Math.abs(_dir.y), 0, 1)) * RAD;
        CAR.diag.coilAxis[i] = [_dir.x, _dir.y, _dir.z];
      }
      spring.jointDamper.position.copy(b);
      spring.jointMount.position.copy(a);
      const internalVisible = Boolean(CAR.internalGroup && CAR.internalGroup.visible);
      spring.jointDamper.visible = internalVisible;
      spring.jointMount.visible = internalVisible;
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

  CAR.diag.coilSource = (model.solved || []).map((solvedCorner) => (
    solvedCorner && solvedCorner.coilSource ? solvedCorner.coilSource : 'none'
  ));
  CAR.diag.rockerArmMm = CAR.corners.map((corner) => [
    corner.rocker.pushArm.length() * 1000,
    corner.rocker.damperArm.length() * 1000,
    corner.rocker.arbArm.length() * 1000
  ]);
  CAR.diag.pushRodLengthMm = CAR.corners.map((corner) => corner.pushRodLength0 * 1000);
  CAR.diag.tieRodLengthMm = CAR.corners.map((corner) => corner.tieRodLength0 * 1000);
  CAR.diag.springCount = CAR.springs.length;
  CAR.diag.rodBushingCount = CAR.diag.rodBushingHits + CAR.diag.rodBushingMisses;
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
  CAR.diag.maxLinkStretchMm = maxLinkStretch;
  CAR.diag.maxSuspLinkStretchMm = maxSuspLinkStretch;
  CAR.diag.tieRodStretchMm = maxTieRodStretch;
  CAR.diag.pushRodStretchMm = maxPushRodStretch;
  CAR.diag.rockerSolveOk = CAR.corners.every((corner) => !corner.rockerSolveFailed);
  CAR.diag.wheelCount = 4;
  CAR.diag.contactCount = 4 - (model.liftedCount || 0);
}

/* ------------------------------ car lifecycle ------------------------------ */

function updateCar(model) {
  if (!CAR.built) return;
  if (!model || !Number.isFinite(model.geometryRevision) || model.geometryRevision !== CAR.geometryRevision) {
    CAR.diag.geometryMismatch = true;
    return;
  }
  CAR.diag.geometryMismatch = false;
  const bodyPos = model.bodyPos || { x: 0, y: model.heave || 0, z: 0 };
  const yaw = model.bodyYaw || 0;
  _qYaw.setFromAxisAngle(_axisY, yaw);

  if (model.bodyQuat) {
    S.bodyPivot.position.set(bodyPos.x, bodyPos.y, bodyPos.z);
    S.bodyPivot.quaternion.set(model.bodyQuat[1], model.bodyQuat[2], model.bodyQuat[3], model.bodyQuat[0]);
  } else {
    S.bodyPivot.position.set(bodyPos.x, bodyPos.y, bodyPos.z);
    const quat = simQuatFromEuler(yaw, model.pitch || 0, model.roll || 0);
    S.bodyPivot.quaternion.set(quat[1], quat[2], quat[3], quat[0]);
  }
  S.bodyPivot.updateMatrix();

  for (let index = 0; index < CAR.corners.length; index += 1) {
    const corner = CAR.corners[index];
    const root = corner.wheelRoot;
    if (!root) continue;
    const solvedCorner = model.solved && model.solved[index] ? model.solved[index] : null;
    if (solvedCorner) {
      // The solver output is already in the road frame and contains the bump
      // camber, toe and steering angle produced by the linkage.
      root.position.set(solvedCorner.wheelPos[0], solvedCorner.wheelPos[1], solvedCorner.wheelPos[2]);
      root.quaternion.set(
        solvedCorner.wheelQuat[0],
        solvedCorner.wheelQuat[1],
        solvedCorner.wheelQuat[2],
        solvedCorner.wheelQuat[3]
      );
    } else if (corner.front) {
      const axisLocal = _vecC.copy(corner.wheelLocal.upper).sub(corner.wheelLocal.lower).normalize();
      const axisWorld = _vecD.copy(axisLocal).applyQuaternion(corner.restQuat);
      const pivot = _vecE.copy(corner.wheelLocal.lower).applyQuaternion(corner.restQuat).add(corner.restCenter);
      _qSteer.setFromAxisAngle(axisWorld, state.steer * DEG);
      // The body's planar pose carries the wheel with it. Pitch and roll move
      // the body relative to the contact plane and therefore load the springs,
      // but the contact patch itself stays on the road.
      const pivotPlan = _vecA.set(bodyPos.x, 0, bodyPos.z)
        .add(_vecB.set(pivot.x, 0, pivot.z).applyQuaternion(_qYaw));
      pivotPlan.y = pivot.y;
      const offset = _vecC.copy(corner.restCenter).sub(pivot).applyQuaternion(_qSteer).applyQuaternion(_qYaw);
      root.position.copy(pivotPlan).add(offset);
      root.quaternion.copy(_qYaw).multiply(_qSteer).multiply(corner.restQuat);
    } else {
      const offset = _vecA.set(corner.restCenter.x, 0, corner.restCenter.z).applyQuaternion(_qYaw);
      root.position.set(bodyPos.x + offset.x, model.dims.R, bodyPos.z + offset.z);
      root.quaternion.copy(_qYaw).multiply(corner.restQuat);
    }
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
  if (!model || !Number.isFinite(model.geometryRevision)) {
    throw new Error('buildCar: model.geometryRevision is required');
  }
  beginCarBuild();
  initCarSceneGroups();
  disposeGroupChildren(S.bodyPivot);
  if (CAR.dynamicGroup) disposeGroupChildren(CAR.dynamicGroup);

  CAR.shellMeshes = [];
  CAR.wheels = [];
  CAR.corners = model.suspension && model.suspension.corners
    ? model.suspension.corners
    : buildCornerData(model);
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
    rackGroup: null,
    steeringPoint: null,
    columnPoint: null,
    diffPoint: null,
    arbPoints: {}
  };
  CAR.steeringWheel = null;
  CAR.bodyworkGroup = null;
  CAR.internalGroup = null;
  CAR.skinMountGroup = null;
  CAR.dims = model.dims;
  CAR.built = false;

  const initialPos = model.bodyPos || { x: 0, y: model.heave || 0, z: 0 };
  S.bodyPivot.position.set(initialPos.x, initialPos.y, initialPos.z);
  if (model.bodyQuat) {
    S.bodyPivot.quaternion.set(model.bodyQuat[1], model.bodyQuat[2], model.bodyQuat[3], model.bodyQuat[0]);
  } else {
    S.bodyPivot.quaternion.identity();
  }

  buildBodywork(model);

  for (const corner of CAR.corners) {
    buildWheelAssembly(corner, model);
    CAR.wheels.push(corner.wheelRoot);
    CAR.rockers.push(corner.rocker);
  }

  buildInternalSuspension(CAR.corners);
  buildSuspensionLinks(CAR.corners);

  finishCarBuild(model);
  CAR.built = true;
  applyXray();
  updateCar(model);
  S.scene.updateMatrixWorld(true);
}

function getCarDiagnostics() {
  return Object.assign({}, CAR.diag);
}
