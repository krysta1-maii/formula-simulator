/* =========================================================================
   20-car.js — bodywork, livery and shared vehicle geometry helpers
   ========================================================================= */

const CAR = {
  dynamicGroup: null,
  bodyworkGroup: null,
  internalGroup: null,
  skinMountGroup: null,
  shellMeshes: [],
  wheels: [],
  corners: [],
  links: [],
  joints: [],
  driveshafts: [],
  springs: [],
  rockers: [],
  arbs: [],
  bodyHardpoints: [],
  steeringWheel: null,
  mechanics: {
    steeringRack: false,
    steeringColumn: false,
    differential: false,
    arbFront: false,
    arbRear: false,
    rackGroup: null,
    steeringPoint: null,
    diffPoint: null,
    arbPoints: {}
  },
  decalCache: new Map(),
  shared: {},
  assets: {
    instanceMaterials: new Set(),
    totals: {
      instanceMaterialCreated: 0,
      instanceMaterialDisposed: 0,
      sceneMaterialsDisposed: 0,
      sharedMaterialDisposed: 0,
      cachedMaterialDisposed: 0,
      geometryDisposed: 0,
      textureDisposed: 0
    },
    lastBuild: null,
    lastTeardown: null
  },
  diag: {
    linkCount: 0,
    jointCount: 0,
    maxLinkStretchMm: 0,
    maxSuspLinkStretchMm: 0,
    tieRodStretchMm: 0,
    pushRodStretchMm: 0,
    rackTravelMm: 0,
    rockerSolveOk: true,
    wheelCount: 0,
    contactCount: 0,
    steeringLinks: 0,
    toeLinks: 0,
    driveshafts: 0,
    arbCount: 0,
    arbTwistDeg: 0,
    arbStretchMm: 0,
    arbBladeFrontDeg: 0,
    arbBladeRearDeg: 0,
    steeringRack: false,
    steeringColumn: false,
    differential: false,
    arbFront: false,
    arbRear: false,
    mechanicalOk: false,
    geometryRevision: 0,
    geometryMismatch: false
  },
  geometryRevision: 0,
  built: false,
  dims: null
};

const TAU = Math.PI * 2;

/* ------------------------------ shared assets ------------------------------ */

function initCarAssets() {
  if (CAR.shared.initialized) return;

  const rod = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
  rod.userData.shared = true;
  CAR.shared.rod = rod;

  const joint = new THREE.SphereGeometry(1, 14, 10);
  joint.userData.shared = true;
  CAR.shared.joint = joint;

  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  cylinder.userData.shared = true;
  CAR.shared.cylinder = cylinder;

  const cone = new THREE.ConeGeometry(1, 1, 14, 1);
  cone.userData.shared = true;
  CAR.shared.cone = cone;

  // Unit torus used for ribbed CV boots and rack bellows.
  const torus = new THREE.TorusGeometry(1, 0.12, 6, 22);
  torus.userData.shared = true;
  CAR.shared.torus = torus;

  if (!MAT.springCoil) {
    MAT.springCoil = new THREE.MeshStandardMaterial({
      color: 0xe0a33c,
      metalness: 0.86,
      roughness: 0.24,
      envMapIntensity: 1.0
    });
  }
  if (!MAT.arbBar) {
    MAT.arbBar = new THREE.MeshStandardMaterial({
      color: 0x8e99a5,
      metalness: 0.95,
      roughness: 0.24,
      envMapIntensity: 0.5
    });
    MAT.arbBlade = new THREE.MeshStandardMaterial({
      color: 0xd0a45b,
      metalness: 0.92,
      roughness: 0.22,
      envMapIntensity: 0.55
    });
    MAT.arbAdjuster = new THREE.MeshStandardMaterial({
      color: 0xe0662f,
      metalness: 0.55,
      roughness: 0.36,
      envMapIntensity: 0.35
    });
  }
  if (!MAT.carbonWing) {
    MAT.carbonWing = MAT.carbon.clone();
    MAT.carbonWing.side = THREE.DoubleSide;
    MAT.paintWing = MAT.paint.clone();
    MAT.paintWing.side = THREE.DoubleSide;
    MAT.accentWing = MAT.paintAccent.clone();
    MAT.accentWing.side = THREE.DoubleSide;
  }
  if (!MAT.helmetAccent) {
    MAT.helmetAccent = MAT.paintAccent.clone();
    MAT.helmetAccent.side = THREE.FrontSide;
  }
  if (!MAT.rainLight) {
    MAT.rainLight = new THREE.MeshStandardMaterial({
      color: 0x250403,
      emissive: 0xff2a18,
      emissiveIntensity: 1.8,
      metalness: 0.2,
      roughness: 0.4
    });
  }
  if (!MAT.tyreBand) {
    MAT.tyreBand = new THREE.MeshBasicMaterial({ color: 0xf05a30, toneMapped: false, side: THREE.DoubleSide });
    MAT.tyreBandLight = new THREE.MeshBasicMaterial({ color: 0xe5ded1, toneMapped: false, side: THREE.DoubleSide });
  }
  MAT.rubber.side = THREE.DoubleSide;
  MAT.rubber.reflectivity = 0.0;

  // Compact horizontal coilover: 40 mm outer radius, unit length along Y.
  const springPoints = [];
  const coilTurns = 8;
  const coilSegments = 280;
  for (let i = 0; i <= coilSegments; i += 1) {
    const t = i / coilSegments;
    const angle = t * coilTurns * TAU;
    springPoints.push(new THREE.Vector3(Math.cos(angle) * 0.034, t - 0.5, Math.sin(angle) * 0.034));
  }
  const springCurve = new THREE.CatmullRomCurve3(springPoints);
  const springGeo = new THREE.TubeGeometry(springCurve, 300, 0.006, 5, false);
  springGeo.userData.shared = true;
  CAR.shared.spring = springGeo;

  CAR.shared.initialized = true;
}

function markShared(mesh) {
  mesh.userData.shared = true;
  return mesh;
}


/* ------------------------------ scene-graph helpers ------------------------------ */

function instanceMaterial(material) {
  if (!material) return material;
  CAR.assets.instanceMaterials.add(material);
  CAR.assets.totals.instanceMaterialCreated += 1;
  if (CAR.assets.lastBuild) CAR.assets.lastBuild.instanceMaterialCreated += 1;
  return material;
}

function beginCarBuild() {
  CAR.assets.lastBuild = {
    instanceMaterialCreated: 0,
    instanceMaterialDisposed: 0,
    geometryDisposed: 0,
    textureDisposed: 0,
    at: typeof performance !== 'undefined' ? performance.now() : Date.now()
  };
}

function finishCarBuild(model) {
  CAR.geometryRevision = model.geometryRevision;
  CAR.diag.geometryRevision = model.geometryRevision;
  CAR.diag.geometryMismatch = false;
  if (CAR.assets.lastBuild) {
    CAR.assets.lastBuild.at = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}

function disposeResourceOnce(resource) {
  if (!resource) return false;
  if (!resource.userData) resource.userData = {};
  if (resource.userData.__disposed) return false;
  resource.userData.__disposed = true;
  if (typeof resource.dispose === 'function') resource.dispose();
  return true;
}

function disposeMaterialMaps(material) {
  if (!material) return 0;
  let disposed = 0;
  const keys = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'envMap'];
  for (const key of keys) {
    const texture = material[key];
    if (!texture || !texture.isTexture) continue;
    if (texture.userData && texture.userData.shared) continue;
    if (disposeResourceOnce(texture)) disposed += 1;
  }
  return disposed;
}

function disposeGroupChildren(group, options = {}) {
  const materials = options.materials !== false;
  const textures = options.textures !== false;
  if (!group) {
    return { geometryDisposed: 0, materialDisposed: 0, sceneMaterialsDisposed: 0, textureDisposed: 0, skipped: 0 };
  }
  const geometries = new Set();
  const materialSet = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => { if (item) materialSet.add(item); });
    else if (material) materialSet.add(material);
  });
  let geometryDisposed = 0;
  let materialDisposed = 0;
  let sceneMaterialsDisposed = 0;
  let textureDisposed = 0;
  let skipped = 0;
  geometries.forEach((geometry) => {
    if (geometry.userData && geometry.userData.shared) { skipped += 1; return; }
    if (disposeResourceOnce(geometry)) geometryDisposed += 1;
  });
  if (materials) {
    const sharedMaterials = new Set(typeof MAT !== 'undefined' ? Object.values(MAT) : []);
    const cachedMaterials = new Set(CAR.decalCache.values());
    materialSet.forEach((material) => {
      if (!material) return;
      if ((material.userData && material.userData.shared) || sharedMaterials.has(material) || cachedMaterials.has(material)) {
        skipped += 1;
        return;
      }
      if (textures) textureDisposed += disposeMaterialMaps(material);
      const registered = CAR.assets.instanceMaterials.has(material);
      if (!disposeResourceOnce(material)) return;
      if (registered) {
        CAR.assets.instanceMaterials.delete(material);
        materialDisposed += 1;
      } else {
        sceneMaterialsDisposed += 1;
      }
    });
  }
  while (group.children.length) group.remove(group.children[0]);
  CAR.assets.totals.geometryDisposed += geometryDisposed;
  CAR.assets.totals.instanceMaterialDisposed += materialDisposed;
  CAR.assets.totals.sceneMaterialsDisposed += sceneMaterialsDisposed;
  CAR.assets.totals.textureDisposed += textureDisposed;
  if (CAR.assets.lastBuild) {
    CAR.assets.lastBuild.geometryDisposed += geometryDisposed;
    CAR.assets.lastBuild.textureDisposed += textureDisposed;
    CAR.assets.lastBuild.instanceMaterialDisposed += materialDisposed;
  }
  return { geometryDisposed, materialDisposed, sceneMaterialsDisposed, textureDisposed, skipped };
}

function registerShellGroup(group) {
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.userData.originalMaterial = object.material;
    object.userData.isShell = true;
    CAR.shellMeshes.push(object);
  });
}

function applyXray() {
  const enabled = Boolean(state.xray);
  if (CAR.internalGroup) CAR.internalGroup.visible = enabled;
  for (const spring of CAR.springs) {
    spring.assembly.visible = enabled;
    spring.jointDamper.visible = enabled;
    spring.jointMount.visible = enabled;
  }
  for (const mesh of CAR.shellMeshes) {
    if (mesh.userData.isDecal) {
      mesh.visible = !enabled;
    } else {
      mesh.material = enabled ? MAT.xray : mesh.userData.originalMaterial;
    }
  }
}

/* ------------------------------ geometry helpers ------------------------------ */

function roundedRectShape(width, height, radius) {
  const w = width;
  const h = height;
  const r = Math.min(radius, w / 2, h / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  shape.closePath();
  return shape;
}

function makeRoundedBoxGeometry(width, height, depth, radius) {
  const shape = roundedRectShape(width, height, radius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.005,
    bevelThickness: 0.005,
    bevelSegments: 2,
    curveSegments: 10,
    steps: 1
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function makeRoundedBox(width, height, depth, radius, material) {
  const mesh = new THREE.Mesh(makeRoundedBoxGeometry(width, height, depth, radius), material);
  return mesh;
}

/**
 * Closed loft through superellipse cross-sections.
 * Sections are {x, zc, w, y0, y1, e}. All rings use the same vertex count, so the
 * surface is smooth and watertight. Tri as modelled for outward-facing normals.
 */
function makeLoftGeometry(sections, { segments = 32, exponent = 0.7, capStart = true, capEnd = true } = {}) {
  const sorted = [...sections].sort((a, b) => a.x - b.x);
  const count = sorted.length;
  const positions = [];
  const uvs = [];
  const indices = [];

  sorted.forEach((section, sectionIndex) => {
    const yc = (section.y0 + section.y1) / 2;
    const h = (section.y1 - section.y0) / 2;
    const exponentForSection = section.e ?? exponent;
    const zc = section.zc ?? 0;
    for (let j = 0; j < segments; j += 1) {
      const angle = (j / segments) * TAU;
      const cz = Math.cos(angle);
      const cy = Math.sin(angle);
      const z = zc + section.w * Math.sign(cz) * Math.pow(Math.abs(cz), exponentForSection);
      const y = yc + h * Math.sign(cy) * Math.pow(Math.abs(cy), exponentForSection);
      positions.push(section.x, y, z);
      uvs.push(j / segments, sectionIndex / (count - 1));
    }
  });

  for (let sectionIndex = 0; sectionIndex < count - 1; sectionIndex += 1) {
    for (let j = 0; j < segments; j += 1) {
      const next = (j + 1) % segments;
      const a = sectionIndex * segments + j;
      const an = sectionIndex * segments + next;
      const b = (sectionIndex + 1) * segments + j;
      const bn = (sectionIndex + 1) * segments + next;
      indices.push(a, b, bn, a, bn, an);
    }
  }

  const makeCap = (sectionIndex, reverse) => {
    const section = sorted[sectionIndex];
    const yc = (section.y0 + section.y1) / 2;
    const centerIndex = positions.length / 3;
    positions.push(section.x, yc, section.zc ?? 0);
    uvs.push(0.5, reverse ? 1 : 0);
    for (let j = 0; j < segments; j += 1) {
      const a = sectionIndex * segments + j;
      const an = sectionIndex * segments + ((j + 1) % segments);
      if (reverse) indices.push(centerIndex, an, a);
      else indices.push(centerIndex, a, an);
    }
  };

  if (capStart) makeCap(0, false);
  if (capEnd) makeCap(count - 1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeLoftMesh(sections, material, options) {
  return new THREE.Mesh(makeLoftGeometry(sections, options), material);
}

/** A narrow strip lying on top of a curved body. Points must be ordered by x. */
function makeTopRibbon(points, width, material, lift = 0.003) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const positions = [];
  const indices = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const point = sorted[i];
    positions.push(point.x, point.y + lift, -width / 2);
    positions.push(point.x, point.y + lift, width / 2);
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/** Extruded airfoil element. direction=-1 makes the chord run toward -X. */
function makeWingElement({ chord, span, thickness = 0.022, material, x, y, angle = 0, direction = 1 }) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(direction * chord * 0.22, thickness * 0.9, direction * chord * 0.7, thickness * 1.05, direction * chord, thickness * 0.18);
  shape.lineTo(direction * chord, -thickness * 0.12);
  shape.bezierCurveTo(direction * chord * 0.6, -thickness * 0.7, direction * chord * 0.2, -thickness * 0.42, 0, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: true,
    bevelSize: 0.0025,
    bevelThickness: 0.0025,
    bevelSegments: 1,
    curveSegments: 8,
    steps: 1
  });
  geometry.translate(0, 0, -span / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, 0);
  mesh.rotation.z = angle;
  return mesh;
}

function makeEndplate(profile, thickness, material, x, y, z) {
  const shape = new THREE.Shape();
  profile.forEach(([px, py], index) => {
    if (index === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    bevelSegments: 1,
    steps: 1
  });
  geometry.translate(0, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function makeTube(points, radius, material, { segments = 80, radialSegments = 8, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.25);
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radialSegments, closed);
  return new THREE.Mesh(geometry, material);
}

function makeFlatShape(points, material, { rotateFlat = true, y = 0 } = {}) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, material);
  if (rotateFlat) {
    mesh.rotation.x = -Math.PI / 2;
  }
  mesh.position.y = y;
  return mesh;
}

/* ------------------------------ decals ------------------------------ */

function makeTextMaterial(key, width, height, draw) {
  if (CAR.decalCache.has(key)) return CAR.decalCache.get(key);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  draw(ctx, width, height);
  const texture = canvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  CAR.decalCache.set(key, material);
  return material;
}

function makeDecal(material, width, height, { position, rotation = [0, 0, 0], renderOrder = 3 }) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = renderOrder;
  mesh.userData.isDecal = true;
  return mesh;
}

function drawTextBase(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
}

function textMaterialNumberNose() {
  return makeTextMaterial('number-nose', 512, 384, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = 'rgba(20,28,38,0.45)';
    ctx.lineWidth = 10;
    ctx.font = '900 260px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.strokeText('01', 0, 10);
    ctx.fillText('01', 0, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 34px ui-monospace, monospace';
    ctx.fillText('FSR  ·  DYNAMIC 02', 0, 158);
    ctx.restore();
  });
}

function textMaterialSidepod(side) {
  return makeTextMaterial('sidepod-' + side, 1024, 256, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.fillStyle = 'rgba(239,235,225,0.94)';
    ctx.font = '800 100px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('FS-01', 44, 112);
    ctx.fillStyle = 'rgba(230,79,49,0.98)';
    ctx.fillRect(45, 177, 208, 9);
    ctx.fillStyle = 'rgba(239,235,225,0.52)';
    ctx.font = '600 35px ui-monospace, monospace';
    ctx.fillText('APEX  DYNAMICS', 48, 214);
    ctx.fillStyle = 'rgba(230,79,49,0.92)';
    ctx.font = '900 240px "Arial Narrow", sans-serif';
    ctx.fillText('01', 690, 190);
    ctx.restore();
  });
}

function textMaterialFrontWing() {
  return makeTextMaterial('front-wing', 512, 192, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(239,235,225,0.88)';
    ctx.font = '800 72px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('APEX', 24, 82);
    ctx.fillStyle = 'rgba(210,58,37,0.95)';
    ctx.fillRect(26, 122, 148, 8);
    ctx.fillStyle = 'rgba(239,235,225,0.42)';
    ctx.font = '600 24px ui-monospace, monospace';
    ctx.fillText('AERODYNAMICS', 188, 112);
    ctx.restore();
  });
}

function textMaterialFinNumber() {
  return makeTextMaterial('fin-number', 256, 192, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(245,240,230,0.9)';
    ctx.font = '900 108px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('01', w / 2, h / 2 + 2);
    ctx.restore();
  });
}

function textMaterialEndplate() {
  return makeTextMaterial('endplate-number', 512, 512, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 230px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('01', w / 2, h / 2 - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '600 34px ui-monospace, monospace';
    ctx.fillText('FORMULA  SIMULATOR', w / 2, h / 2 + 152);
    ctx.restore();
  });
}

function textMaterialEndplateRear() {
  return makeTextMaterial('endplate-rear', 512, 512, (ctx, w, h) => {
    drawTextBase(ctx, w, h);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 210px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('FS', w / 2, h / 2 - 40);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '700 80px ui-monospace, monospace';
    ctx.fillText('01', w / 2, h / 2 + 120);
    ctx.restore();
  });
}

/* ------------------------------ bodywork ------------------------------ */

function buildBodywork(model) {
  const dims = model.dims;
  const { xF, xR, tf, tr, R, wF, wR } = dims;
  const wheelFrontX = xF;
  const wheelRearX = xR;
  const frontWingLead = xF + 0.46;
  const rearWingHalfSpan = clamp(tr / 2 - 0.22, 0.44, 0.58);
  const bodywork = new THREE.Group();
  bodywork.name = 'bodywork';

  const addBodyMesh = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    bodywork.add(mesh);
    return mesh;
  };
  const addPair = (mesh) => {
    addBodyMesh(mesh);
    return mesh;
  };

  /* ----------------------------- floor + diffuser ----------------------------- */
  {
    const floorPlan = [
      [xF - 0.92, 0.47],
      [xF - 1.15, 0.61],
      [0.40, 0.72],
      [-0.35, 0.72],
      [-0.95, 0.68],
      [xR + 0.62, 0.60],
      [xR + 0.36, 0.54],
      [xR + 0.08, 0.50],
      [xR - 0.30, 0.38]
    ];
    // The plan is mirrored in XZ; extrusion depth becomes +Y after the rotation.
    const shapePoints = [];
    floorPlan.forEach(([x, z]) => shapePoints.push(new THREE.Vector2(x, z)));
    for (let i = floorPlan.length - 1; i >= 0; i -= 1) {
      shapePoints.push(new THREE.Vector2(floorPlan[i][0], -floorPlan[i][1]));
    }
    const shape = new THREE.Shape(shapePoints);
    const floorGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.024,
      bevelEnabled: false,
      steps: 1
    });
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, MAT.carbon);
    floor.position.y = 0.055;
    addBodyMesh(floor);

    // Floor edge fences / vortex devices.
    for (const sign of [-1, 1]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.085, 0.018), MAT.carbonMatte);
      fence.position.set(-0.20, 0.105, sign * 0.715);
      addBodyMesh(fence);
      const frontFence = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 0.016), MAT.carbonMatte);
      frontFence.position.set(xF - 1.02, 0.10, sign * 0.66);
      frontFence.rotation.y = sign * 0.18;
      addBodyMesh(frontFence);
      const rearFence = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.075, 0.015), MAT.carbonMatte);
      rearFence.position.set(xR + 0.42, 0.108, sign * 0.56);
      addBodyMesh(rearFence);
    }

    // Diffuser ramp.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.022, 1.02), MAT.carbon);
    diffuser.position.set(xR - 0.03, 0.145, 0);
    diffuser.rotation.z = -0.20;
    addBodyMesh(diffuser);
    const diffuserVertical = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 1.0), MAT.carbonMatte);
    diffuserVertical.position.set(xR - 0.34, 0.19, 0);
    addBodyMesh(diffuserVertical);
    for (let i = -2; i <= 2; i += 1) {
      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.012), MAT.carbonMatte);
      strake.position.set(xR - 0.12, 0.14 + Math.abs(i) * 0.008, i * 0.18);
      strake.rotation.z = -0.18;
      addBodyMesh(strake);
    }

    // Central skid block.
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.014, 0.20), instanceMaterial(new THREE.MeshStandardMaterial({ color: 0x6d5a43, roughness: 0.8, metalness: 0.1 })));
    skid.position.set(0.18, 0.044, 0);
    addBodyMesh(skid);
  }

  /* ----------------------------- monocoque ----------------------------- */
  const bodyProfiles = buildBodyworkProfiles(dims);
  const monoSections = bodyProfiles.monocoque;
  const monoTopSamples = monoSections.slice(0, 11).map((section) => ({ x: section.x, y: section.y1 }));
  const monocoque = makeLoftMesh(monoSections, MAT.paint, { segments: 36, exponent: 0.7 });
  monocoque.name = 'envelope-monocoque';
  addBodyMesh(monocoque);

  // Accent stripe running the length of the nose and through the cockpit.
  const stripePoints = monoTopSamples
    .filter((point) => point.x > xF - 2.55)
    .map((point) => ({ x: point.x, y: point.y }));
  addBodyMesh(makeTopRibbon(stripePoints, 0.072, MAT.paintAccent, 0.005), { cast: false });

  // A subtle dark nose channel under the stripe.
  const noseChannel = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.012, 0.02), MAT.carbonMatte);
  noseChannel.position.set(xF + 0.55, 0.328, 0);
  noseChannel.rotation.z = 0.15;
  addBodyMesh(noseChannel, { cast: false });

  /* ----------------------------- cockpit / driver ----------------------------- */
  const cockpitCenterX = xF - 1.88;
  const cockpitY = 0.658;
  {
    const openingShape = roundedRectShape(0.82, 0.40, 0.18);
    const openingGeo = new THREE.ShapeGeometry(openingShape, 24);
    const opening = new THREE.Mesh(openingGeo, instanceMaterial(new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.9, metalness: 0.05 })));
    opening.rotation.x = -Math.PI / 2;
    opening.position.set(cockpitCenterX, cockpitY, 0);
    addBodyMesh(opening, { cast: false });

    const rimPoints = [];
    const rimW = 0.42;
    const rimL = 0.43;
    const rimR = 0.16;
    for (let i = 0; i <= 40; i += 1) {
      const angle = (i / 40) * TAU;
      const t = angle;
      const x = Math.cos(t) * rimL;
      const z = Math.sin(t) * rimW;
      // Blend toward a rounded rectangle.
      const nx = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.52) * rimL;
      const nz = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.52) * rimW;
      rimPoints.push(new THREE.Vector3(cockpitCenterX + nx, cockpitY + 0.014, nz));
    }
    const rim = makeTube(rimPoints, 0.0085, MAT.carbonMatte, { segments: 120, radialSegments: 5, closed: true });
    addBodyMesh(rim, { cast: false });

    // Raised padded headrest behind the driver.
    const headrest = makeRoundedBox(0.23, 0.13, 0.36, 0.055, MAT.carbonMatte);
    headrest.position.set(cockpitCenterX - 0.34, cockpitY - 0.015, 0);
    addBodyMesh(headrest);

    const seat = makeRoundedBox(0.34, 0.24, 0.38, 0.07, MAT.carbonMatte);
    seat.position.set(cockpitCenterX, cockpitY - 0.17, 0);
    addBodyMesh(seat);

    // Driver: helmet and visor.
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.105, 36, 26), MAT.helmet);
    helmet.scale.set(1.03, 1.10, 0.98);
    helmet.position.set(cockpitCenterX - 0.085, cockpitY + 0.12, 0);
    addBodyMesh(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.098, 28, 20, 0, TAU, 1.08, 0.55), MAT.visir);
    visor.scale.set(1.02, 1.01, 1.03);
    visor.rotation.y = -Math.PI / 2;
    visor.position.set(cockpitCenterX - 0.085, cockpitY + 0.14, 0);
    addBodyMesh(visor);
    const helmetStripe = makeTopRibbon(
      [
        { x: cockpitCenterX + 0.065, y: cockpitY + 0.235 },
        { x: cockpitCenterX - 0.025, y: cockpitY + 0.245 },
        { x: cockpitCenterX - 0.155, y: cockpitY + 0.225 }
      ],
      0.035,
      MAT.paintAccent,
      0.001
    );
    addBodyMesh(helmetStripe, { cast: false });

    // Steering wheel: torus normal along X, face points toward the driver.
    const steering = new THREE.Group();
    steering.position.set(cockpitCenterX + 0.42, cockpitY - 0.07, 0);
    const rimWheel = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.024, 10, 28), MAT.carbonMatte);
    rimWheel.rotation.y = Math.PI / 2;
    rimWheel.scale.set(1, 0.86, 1);
    steering.add(rimWheel);
    const wheelPlate = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.10, 0.15), MAT.darkMetal);
    steering.add(wheelPlate);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.032, 0.072), instanceMaterial(new THREE.MeshBasicMaterial({ color: 0x6cffd4, toneMapped: false })));
    screen.position.set(-0.018, 0.03, 0);
    steering.add(screen);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.42, 10), MAT.carbonMatte);
    column.rotation.z = Math.PI / 2;
    column.position.set(cockpitCenterX + 0.62, cockpitY - 0.10, 0);
    addBodyMesh(column);
    CAR.steeringWheel = steering;
    addBodyMesh(steering);

    const dash = makeRoundedBox(0.13, 0.11, 0.26, 0.035, MAT.carbonMatte);
    dash.position.set(cockpitCenterX + 0.52, cockpitY - 0.14, 0);
    addBodyMesh(dash);
  }

  /* ----------------------------- halo + roll structure ----------------------------- */
  {
    const haloPoints = [
      new THREE.Vector3(cockpitCenterX - 0.44, cockpitY - 0.01, -0.30),
      new THREE.Vector3(cockpitCenterX - 0.38, cockpitY + 0.10, -0.35),
      new THREE.Vector3(cockpitCenterX - 0.14, cockpitY + 0.185, -0.33),
      new THREE.Vector3(cockpitCenterX + 0.14, cockpitY + 0.190, -0.24),
      new THREE.Vector3(cockpitCenterX + 0.37, cockpitY + 0.175, -0.10),
      new THREE.Vector3(cockpitCenterX + 0.41, cockpitY + 0.170, 0),
      new THREE.Vector3(cockpitCenterX + 0.37, cockpitY + 0.175, 0.10),
      new THREE.Vector3(cockpitCenterX + 0.14, cockpitY + 0.190, 0.24),
      new THREE.Vector3(cockpitCenterX - 0.14, cockpitY + 0.185, 0.33),
      new THREE.Vector3(cockpitCenterX - 0.38, cockpitY + 0.10, 0.35),
      new THREE.Vector3(cockpitCenterX - 0.44, cockpitY - 0.01, 0.30)
    ];
    addBodyMesh(makeTube(haloPoints, 0.024, MAT.carbon, { segments: 110, radialSegments: 8 }));
    const pillar = makeTube(
      [
        new THREE.Vector3(cockpitCenterX + 0.37, cockpitY + 0.175, 0),
        new THREE.Vector3(cockpitCenterX + 0.36, cockpitY + 0.06, 0),
        new THREE.Vector3(cockpitCenterX + 0.34, cockpitY - 0.03, 0)
      ],
      0.021,
      MAT.carbon,
      { segments: 24, radialSegments: 7 }
    );
    addBodyMesh(pillar);
    for (const sign of [-1, 1]) {
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.06), MAT.titanium);
      mount.position.set(cockpitCenterX - 0.42, cockpitY - 0.02, sign * 0.30);
      addBodyMesh(mount);
    }

    const hoop = makeTube(
      [
        new THREE.Vector3(cockpitCenterX - 0.45, cockpitY - 0.08, -0.25),
        new THREE.Vector3(cockpitCenterX - 0.52, cockpitY + 0.10, -0.22),
        new THREE.Vector3(cockpitCenterX - 0.56, cockpitY + 0.20, 0),
        new THREE.Vector3(cockpitCenterX - 0.52, cockpitY + 0.10, 0.22),
        new THREE.Vector3(cockpitCenterX - 0.45, cockpitY - 0.08, 0.25)
      ],
      0.034,
      MAT.carbonMatte,
      { segments: 50, radialSegments: 8 }
    );
    addBodyMesh(hoop);
  }

  /* ----------------------------- engine cover + airbox + fin ----------------------------- */
  {
    const coverSections = bodyProfiles.engineCover;
    const engineCover = makeLoftMesh(coverSections, MAT.paintDeep, { segments: 28, exponent: 0.72 });
    engineCover.name = 'envelope-engine-cover';
    addBodyMesh(engineCover);

    // Shark fin livery element.
    const finShape = new THREE.Shape();
    finShape.moveTo(xF - 2.26, 0.80);
    finShape.lineTo(xF - 2.60, 0.79);
    finShape.lineTo(xF - 3.28, 0.46);
    finShape.lineTo(xF - 3.05, 0.43);
    finShape.lineTo(xF - 2.56, 0.69);
    finShape.lineTo(xF - 2.26, 0.72);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.018, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    finGeo.translate(0, 0, -0.009);
    const fin = new THREE.Mesh(finGeo, MAT.paintAccent);
    addBodyMesh(fin);

    // Airbox.
    const airbox = makeRoundedBox(0.45, 0.29, 0.34, 0.10, MAT.paint);
    airbox.rotation.y = Math.PI / 2;
    airbox.position.set(xF - 2.28, 0.795, 0);
    addBodyMesh(airbox);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.135, 32), instanceMaterial(new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 1, metalness: 0 })));
    intake.scale.set(1.0, 1.35, 1);
    intake.rotation.y = Math.PI / 2;
    intake.position.set(xF - 2.105, 0.805, 0);
    addBodyMesh(intake, { cast: false });
    const intakeLip = new THREE.Mesh(new THREE.TorusGeometry(0.137, 0.008, 6, 32), MAT.paintAccent);
    intakeLip.scale.set(1.0, 1.35, 1);
    intakeLip.rotation.y = Math.PI / 2;
    intakeLip.position.set(xF - 2.10, 0.805, 0);
    addBodyMesh(intakeLip, { cast: false });

    // Cameras / T-cam and antennae.
    const cameraPod = makeRoundedBox(0.10, 0.055, 0.18, 0.025, MAT.carbonMatte);
    cameraPod.position.set(xF - 2.12, 0.975, 0);
    addBodyMesh(cameraPod);
    for (const sign of [-1, 1]) {
      const cam = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), sign < 0 ? MAT.darkMetal : MAT.paintAccent);
      cam.position.set(xF - 2.12, 0.973, sign * 0.085);
      addBodyMesh(cam);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.18, 4), MAT.darkMetal);
    antenna.position.set(xF - 2.85, 0.79, 0);
    addBodyMesh(antenna);

    // Engine cover centre accent ribbon.
    addBodyMesh(
      makeTopRibbon(
        [
          { x: xF - 2.18, y: 0.812 },
          { x: xF - 2.55, y: 0.745 },
          { x: xF - 2.90, y: 0.640 },
          { x: xF - 3.22, y: 0.470 }
        ],
        0.060,
        MAT.paintAccent,
        0.006
      ),
      { cast: false }
    );
  }

  /* ----------------------------- sidepods ----------------------------- */
  {
    const sidepodSections = [
      { x: xF - 1.45, w: 0.115, y0: 0.145, y1: 0.47, zc: 0.405, e: 0.8 },
      { x: xF - 1.56, w: 0.145, y0: 0.12, y1: 0.50, zc: 0.435, e: 0.77 },
      { x: xF - 1.72, w: 0.215, y0: 0.095, y1: 0.55, zc: 0.49, e: 0.72 },
      { x: xF - 1.95, w: 0.285, y0: 0.08, y1: 0.58, zc: 0.54, e: 0.68 },
      { x: xF - 2.28, w: 0.30, y0: 0.075, y1: 0.585, zc: 0.56, e: 0.66 },
      { x: xF - 2.62, w: 0.29, y0: 0.07, y1: 0.57, zc: 0.56, e: 0.66 },
      { x: xF - 2.92, w: 0.245, y0: 0.07, y1: 0.525, zc: 0.53, e: 0.69 },
      { x: xF - 3.20, w: 0.155, y0: 0.08, y1: 0.445, zc: 0.46, e: 0.75 },
      { x: xF - 3.42, w: 0.085, y0: 0.10, y1: 0.345, zc: 0.40, e: 0.85 }
    ];
    for (const sign of [-1, 1]) {
      const sections = sidepodSections.map((section) => ({
        x: section.x,
        w: section.w,
        y0: section.y0,
        y1: section.y1,
        zc: sign * section.zc,
        e: section.e
      }));
      addBodyMesh(makeLoftMesh(sections, MAT.paintDeep, { segments: 30, exponent: 0.7 }));

      // Sidepod intake.
      const intake = new THREE.Mesh(new THREE.CircleGeometry(0.155, 32), instanceMaterial(new THREE.MeshStandardMaterial({ color: 0x030506, roughness: 0.95, metalness: 0.05 })));
      intake.scale.set(1.0, 1.28, 1);
      intake.rotation.y = Math.PI / 2;
      intake.position.set(xF - 1.44, 0.31, sign * 0.415);
      addBodyMesh(intake, { cast: false });
      const intakeLip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.30), MAT.paintAccent);
      intakeLip.position.set(xF - 1.435, 0.47, sign * 0.43);
      addBodyMesh(intakeLip, { cast: false });

      // Cooling louvres on top of the sidepod.
      for (let i = 0; i < 6; i += 1) {
        const louvre = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.012, 0.018), MAT.carbonMatte);
        louvre.position.set(xF - 2.55 - i * 0.12, 0.545 - i * 0.006, sign * 0.55);
        louvre.rotation.y = sign * 0.06;
        louvre.rotation.z = 0.10;
        addBodyMesh(louvre, { cast: false });
      }

      // Small sidepod exit at the rear.
      const exit = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.015), MAT.carbonMatte);
      exit.position.set(xF - 3.38, 0.25, sign * 0.40);
      addBodyMesh(exit);

      // Bargeboards / turning vanes forward of the sidepod.
      const vaneShape = new THREE.Shape();
      vaneShape.moveTo(0, 0);
      vaneShape.quadraticCurveTo(0.12, 0.05, 0.20, 0.22);
      vaneShape.quadraticCurveTo(0.16, 0.36, 0.02, 0.40);
      vaneShape.lineTo(-0.04, 0.22);
      vaneShape.lineTo(-0.01, 0.06);
      vaneShape.closePath();
      const vaneGeo = new THREE.ExtrudeGeometry(vaneShape, { depth: 0.012, bevelEnabled: false });
      vaneGeo.translate(0, 0, -0.006);
      const vane = new THREE.Mesh(vaneGeo, MAT.carbon);
      vane.position.set(xF - 1.62, 0.085, sign * 0.67);
      vane.rotation.y = sign < 0 ? Math.PI : 0;
      addBodyMesh(vane);
    }
  }

  /* ----------------------------- front wing ----------------------------- */
  {
    const span = tf + 0.28;
    const half = span / 2;
    const lead = frontWingLead;
    const main = makeWingElement({ chord: 0.40, span, thickness: 0.020, material: MAT.carbonWing, x: lead, y: 0.055, angle: 0.055 });
    addBodyMesh(main);
    const mainLip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, span - 0.03), MAT.paintAccent);
    mainLip.position.set(0, 0.014, 0);
    main.add(mainLip);
    const flap1 = makeWingElement({ chord: 0.27, span: span - 0.06, thickness: 0.017, material: MAT.carbonWing, x: lead + 0.16, y: 0.102, angle: 0.13 });
    addBodyMesh(flap1);
    const flap2 = makeWingElement({ chord: 0.21, span: span - 0.18, thickness: 0.014, material: MAT.carbonWing, x: lead + 0.27, y: 0.145, angle: 0.20 });
    addBodyMesh(flap2);
    const flap3 = makeWingElement({ chord: 0.155, span: span - 0.30, thickness: 0.012, material: MAT.carbonWing, x: lead + 0.36, y: 0.183, angle: 0.26 });
    addBodyMesh(flap3);

    // Wing pylons to the nose.
    for (const sign of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.018), MAT.carbonMatte);
      pylon.position.set(lead + 0.17, 0.165, sign * 0.11);
      pylon.rotation.z = -0.15;
      addBodyMesh(pylon);
    }

    // Endplates.
    for (const sign of [-1, 1]) {
      const profile = [
        [0.00, 0.03],
        [0.34, 0.02],
        [0.52, 0.10],
        [0.58, 0.20],
        [0.54, 0.37],
        [0.10, 0.34],
        [0.02, 0.22],
        [-0.02, 0.08]
      ];
      const endplate = makeEndplate(profile, 0.018, MAT.carbonWing, lead - 0.02, 0.0, sign * (half + 0.012));
      addBodyMesh(endplate);
      const frontWingDecal = makeDecal(textMaterialFrontWing(), 0.21, 0.075, {
        position: [lead + 0.20, 0.205, sign * (half + 0.027)],
        rotation: [0, sign > 0 ? 0 : Math.PI, 0]
      });
      addBodyMesh(frontWingDecal);
      const footplate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.018, 0.15), MAT.carbonMatte);
      footplate.position.set(lead + 0.22, 0.026, sign * (half + 0.075));
      addBodyMesh(footplate);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.004), MAT.paintAccent);
      stripe.position.set(lead + 0.16, 0.29, sign * (half + 0.024));
      addBodyMesh(stripe, { cast: false });
    }

    // Small turning vanes inboard of the endplates.
    for (const sign of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(0.14, 0.03, 0.28, 0.16);
      shape.lineTo(0.20, 0.24);
      shape.quadraticCurveTo(0.09, 0.12, 0, 0.06);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.010, bevelEnabled: false });
      geo.translate(0, 0, -0.005);
      const vane = new THREE.Mesh(geo, MAT.carbonMatte);
      vane.position.set(lead + 0.12, 0.058, sign * 0.72);
      vane.rotation.y = sign < 0 ? Math.PI : 0;
      addBodyMesh(vane);
    }
  }

  /* ----------------------------- rear wing ----------------------------- */
  {
    const halfSpan = rearWingHalfSpan;
    const lead = xR - 0.48;
    const main = makeWingElement({ chord: 0.42, span: halfSpan * 2 - 0.02, thickness: 0.023, material: MAT.carbonWing, x: lead, y: 0.84, angle: -0.09, direction: -1 });
    addBodyMesh(main);
    const mainLip = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.008, halfSpan * 2 - 0.04), MAT.paintAccent);
    mainLip.position.set(0, 0.016, 0);
    main.add(mainLip);
    const flap = makeWingElement({ chord: 0.27, span: halfSpan * 2 - 0.10, thickness: 0.017, material: MAT.carbonWing, x: lead - 0.16, y: 0.965, angle: -0.19, direction: -1 });
    addBodyMesh(flap);
    const beam1 = makeWingElement({ chord: 0.18, span: halfSpan * 2 - 0.22, thickness: 0.013, material: MAT.carbonWing, x: lead + 0.10, y: 0.49, angle: -0.15, direction: -1 });
    addBodyMesh(beam1);
    const beam2 = makeWingElement({ chord: 0.14, span: halfSpan * 2 - 0.30, thickness: 0.011, material: MAT.carbonWing, x: lead + 0.04, y: 0.565, angle: -0.21, direction: -1 });
    addBodyMesh(beam2);

    for (const sign of [-1, 1]) {
      const profile = [
        [0.00, 0.02],
        [0.44, 0.00],
        [0.53, 0.13],
        [0.50, 0.48],
        [0.35, 0.50],
        [0.25, 0.43],
        [0.02, 0.10]
      ];
      const endplate = makeEndplate(profile, 0.020, MAT.carbonWing, lead - 0.34, 0.595, sign * (halfSpan + 0.010));
      addBodyMesh(endplate);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.016, 0.004), MAT.paintAccent);
      accent.position.set(lead - 0.10, 1.035, sign * (halfSpan + 0.022));
      addBodyMesh(accent, { cast: false });
      const endplateFoot = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.02, 0.12), MAT.carbonMatte);
      endplateFoot.position.set(lead - 0.02, 0.595, sign * (halfSpan + 0.02));
      addBodyMesh(endplateFoot);
    }

    // Swan-neck supports.
    for (const sign of [-1, 1]) {
      const support = makeTube(
        [
          new THREE.Vector3(xR - 0.05, 0.52, sign * 0.15),
          new THREE.Vector3(xR - 0.24, 0.65, sign * 0.15),
          new THREE.Vector3(lead + 0.04, 0.83, sign * 0.15)
        ],
        0.026,
        MAT.carbon,
        { segments: 30, radialSegments: 7 }
      );
      addBodyMesh(support);
    }

    // DRS actuator housing.
    const drs = makeRoundedBox(0.16, 0.09, 0.12, 0.03, MAT.carbonMatte);
    drs.position.set(lead - 0.13, 1.02, 0);
    addBodyMesh(drs);
    const drsLight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.06), MAT.paintAccent);
    drsLight.position.set(lead - 0.21, 1.04, 0);
    addBodyMesh(drsLight, { cast: false });
  }

  /* ----------------------------- rear structures ----------------------------- */
  {
    // Keep the default silhouette unchanged. Other wheelbases need a longer
    // bellhousing/suspension carrier because the rear axle moves relative to
    // the engine-cover loft; its front extension encloses the same inboard unit.
    const rearPackageExtension = Math.abs(dims.L - 3.55) * 1.20;
    const gearbox = makeRoundedBox(0.44 + rearPackageExtension, 0.29, 0.34, 0.06, MAT.darkMetal);
    gearbox.name = 'envelope-gearbox';
    gearbox.position.set(xR + 0.24 + rearPackageExtension * 0.5, 0.29, 0);
    addBodyMesh(gearbox);

    // Rear suspension carrier: the wishbones and pullrods attach to this
    // carbon/metal structure rather than to thin bodywork.
    const rearCarrier = makeRoundedBox(0.58, 0.36, 0.30, 0.055, MAT.darkMetal);
    rearCarrier.name = 'envelope-rear-carrier';
    rearCarrier.position.set(xR - 0.15, 0.31, 0);
    addBodyMesh(rearCarrier);
    for (const sign of [-1, 1]) {
      const carrierPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.018), MAT.carbonMatte);
      carrierPlate.position.set(xR - 0.06, 0.33, sign * 0.152);
      addBodyMesh(carrierPlate);
    }
    const crash = makeRoundedBox(0.42, 0.22, 0.24, 0.08, MAT.carbonMatte);
    crash.position.set(xR - 0.38, 0.36, 0);
    addBodyMesh(crash);
    const crashTip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.10, 20), MAT.darkMetal);
    crashTip.rotation.z = Math.PI / 2;
    crashTip.position.set(xR - 0.61, 0.36, 0);
    addBodyMesh(crashTip);
    const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.11), MAT.rainLight);
    rainLight.position.set(xR - 0.655, 0.40, 0);
    addBodyMesh(rainLight, { cast: false });
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.13, 16, 1, true), MAT.titanium);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(xR - 0.46, 0.49, 0);
    addBodyMesh(exhaust);
    const exhaustInner = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), instanceMaterial(new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide })));
    exhaustInner.rotation.y = Math.PI / 2;
    exhaustInner.position.set(xR - 0.525, 0.49, 0);
    addBodyMesh(exhaustInner, { cast: false });

    // Suspension/gearbox mount blocks.
    for (const sign of [-1, 1]) {
      const block = makeRoundedBox(0.18, 0.14, 0.13, 0.03, MAT.darkMetal);
      block.position.set(xR + 0.34, 0.35, sign * 0.18);
      addBodyMesh(block);
    }
  }

  /* ----------------------------- mirrors ----------------------------- */
  {
    for (const sign of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.15, 8), MAT.carbonMatte);
      stalk.rotation.z = Math.PI / 2;
      stalk.rotation.y = sign * 0.55;
      stalk.position.set(cockpitCenterX + 0.34, cockpitY + 0.02, sign * 0.36);
      addBodyMesh(stalk);
      const pod = makeRoundedBox(0.13, 0.055, 0.07, 0.026, MAT.paint);
      pod.rotation.y = Math.PI / 2;
      pod.position.set(cockpitCenterX + 0.39, cockpitY + 0.052, sign * 0.47);
      addBodyMesh(pod);
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.038), MAT.glass);
      mirror.rotation.y = Math.PI;
      mirror.position.set(cockpitCenterX + 0.455, cockpitY + 0.052, sign * 0.47);
      addBodyMesh(mirror, { cast: false });
    }
  }

  /* ----------------------------- livery decals ----------------------------- */
  {
    const noseNumber = makeDecal(textMaterialNumberNose(), 0.30, 0.225, {
      position: [xF + 0.21, 0.430, 0],
      rotation: [-Math.PI / 2, 0, -0.22]
    });
    addBodyMesh(noseNumber);

    for (const sign of [-1, 1]) {
      const sidepodDecal = makeDecal(textMaterialSidepod(sign > 0 ? 'right' : 'left'), 0.52, 0.13, {
        position: [xF - 2.53, 0.335, sign * 0.858],
        rotation: [0, sign > 0 ? 0 : Math.PI, 0]
      });
      addBodyMesh(sidepodDecal);

      const rearNumber = makeDecal(sign > 0 ? textMaterialEndplateRear() : textMaterialEndplate(), 0.20, 0.30, {
        position: [xR - 0.60, 0.82, sign * (rearWingHalfSpan + 0.022)],
        rotation: [0, sign > 0 ? 0 : Math.PI, 0]
      });
      addBodyMesh(rearNumber);

      const finNumber = makeDecal(textMaterialFinNumber(), 0.18, 0.13, {
        position: [xF - 2.98, 0.602, sign * 0.014],
        rotation: [0, sign > 0 ? 0 : Math.PI, 0]
      });
      addBodyMesh(finNumber);
    }
  }

  registerShellGroup(bodywork);
  CAR.bodyworkGroup = bodywork;
  S.bodyPivot.add(bodywork);
  return bodywork;
}
