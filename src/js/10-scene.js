/* =========================================================================
   10-scene.js — renderer, environment, tilt rig, camera and force overlays
   ========================================================================= */

const S = {
  initialized: false,
  host: null,
  renderer: null,
  scene: null,
  camera: null,
  roadGroup: null,
  carRoot: null,
  bodyPivot: null,
  loadOverlay: null,
  cgOverlay: null,
  envRT: null,
  labels: {},
  labelAnchors: [],
  cgWorld: new THREE.Vector3(),
  projWorld: new THREE.Vector3(),
  plate: null
};

const MAT = {};
const TEX = {};

const CAMERA_PRESETS = {
  threeQuarter: { theta: 0.62, phi: 1.22, radius: 8.9, target: [0, 0.54, 0] },
  side: { theta: 1.52, phi: 1.36, radius: 9.3, target: [0, 0.48, 0] },
  front: { theta: 0.06, phi: 1.28, radius: 8.2, target: [0, 0.48, 0] },
  rear: { theta: 3.09, phi: 1.23, radius: 9.1, target: [0, 0.48, 0] },
  top: { theta: 0.74, phi: 0.42, radius: 9.6, target: [0, 0.38, 0] },
  portrait: { theta: 0.26, phi: 1.18, radius: 12.4, target: [0, 0.55, 0] },
  inspectSteering: { theta: 0.55, phi: 0.72, radius: 2.8, target: [1.35, 0.34, 0] },
  inspectDrivetrain: { theta: 2.40, phi: 0.70, radius: 2.8, target: [-1.40, 0.34, 0] },
  inspectArb: { theta: 0.15, phi: 0.72, radius: 3.0, target: [1.34, 0.55, 0] },
  inspectArbRear: { theta: 2.55, phi: 0.45, radius: 2.8, target: [-1.45, 0.52, 0] }
};

const PORTRAIT_QUERY = window.matchMedia('(max-width: 980px) and (orientation: portrait)');

const CAMERA = {
  theta: 0.62,
  phi: 1.22,
  radius: 8.9,
  target: new THREE.Vector3(0, 0.54, 0),
  goalTheta: 0.62,
  goalPhi: 1.22,
  goalRadius: 8.9,
  goalTarget: new THREE.Vector3(0, 0.54, 0),
  dragging: null,
  pointers: new Map(),
  pinchDistance: 0,
  enabled: true,
  userMoved: false
};

const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ utilities ------------------------------ */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasTexture(canvas, { srgb = true, repeat = null } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.encoding = THREE.sRGBEncoding;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  texture.anisotropy = Math.min(8, S.renderer ? S.renderer.capabilities.getMaxAnisotropy() : 4);
  return texture;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ------------------------------ textures ------------------------------ */

function createAsphaltTexture() {
  const size = 1024;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const random = mulberry32(20261031);

  ctx.fillStyle = '#262a2f';
  ctx.fillRect(0, 0, size, size);

  const wash = ctx.createLinearGradient(0, 0, size, size);
  wash.addColorStop(0, 'rgba(75,83,92,0.22)');
  wash.addColorStop(0.42, 'rgba(24,27,31,0.12)');
  wash.addColorStop(1, 'rgba(10,12,15,0.35)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  // Coarse aggregate.
  for (let i = 0; i < 9000; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 0.35 + random() * 1.6;
    const tone = 80 + Math.floor(random() * 75);
    ctx.fillStyle = `rgba(${tone},${tone + 3},${tone + 6},${0.16 + random() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fine speckle.
  for (let i = 0; i < 18000; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const tone = 30 + Math.floor(random() * 100);
    ctx.fillStyle = `rgba(${tone},${tone},${tone},${0.06 + random() * 0.12})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Slightly darker wheel-polished lanes.
  ctx.save();
  ctx.globalAlpha = 0.16;
  const lane = ctx.createLinearGradient(0, 300, 0, 740);
  lane.addColorStop(0, 'rgba(4,6,8,0)');
  lane.addColorStop(0.5, 'rgba(4,6,8,0.75)');
  lane.addColorStop(1, 'rgba(4,6,8,0)');
  ctx.fillStyle = lane;
  ctx.fillRect(0, 300, size, 440);
  ctx.restore();

  // Faint expansion joints.
  ctx.strokeStyle = 'rgba(8,10,12,0.35)';
  ctx.lineWidth = 3;
  [0.34, 0.68].forEach((u) => {
    ctx.beginPath();
    ctx.moveTo(u * size, 0);
    ctx.lineTo(u * size, size);
    ctx.stroke();
  });

  // A few hairline cracks.
  ctx.strokeStyle = 'rgba(9,11,13,0.42)';
  ctx.lineWidth = 1.1;
  const cracks = [
    [[120, 180], [148, 240], [130, 310], [172, 372]],
    [[810, 520], [790, 600], [830, 654], [806, 738]],
    [[430, 860], [488, 804], [540, 818], [588, 784]],
    [[715, 168], [684, 220], [706, 274], [692, 326]]
  ];
  cracks.forEach((points) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // Sparse rubber pickup.
  for (let i = 0; i < 80; i += 1) {
    ctx.fillStyle = `rgba(5,6,7,${0.04 + random() * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(random() * size, random() * size, 2 + random() * 9, 1 + random() * 3, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvasTexture(canvas, { repeat: [1.35, 1.0] });
}

function createCarbonTexture() {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15181c';
  ctx.fillRect(0, 0, size, size);
  const cell = 16;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const flip = ((x / cell + y / cell) | 0) % 2 === 0;
      const grad = ctx.createLinearGradient(x, y, x + cell, y + cell);
      if (flip) {
        grad.addColorStop(0, 'rgba(84,92,102,0.20)');
        grad.addColorStop(0.48, 'rgba(20,23,27,0.2)');
        grad.addColorStop(1, 'rgba(58,64,72,0.13)');
      } else {
        grad.addColorStop(0, 'rgba(14,16,19,0.2)');
        grad.addColorStop(0.52, 'rgba(66,73,82,0.15)');
        grad.addColorStop(1, 'rgba(24,27,31,0.2)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    }
  }
  return canvasTexture(canvas, { repeat: [4, 4] });
}

function createFloorTexture() {
  const size = 1024;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  const maxR = size * 0.5;

  // Transparent outside the grid to let the page gradient show.
  const base = ctx.createRadialGradient(center, center, 0, center, center, maxR);
  base.addColorStop(0, 'rgba(11,16,23,0.75)');
  base.addColorStop(0.52, 'rgba(8,12,18,0.55)');
  base.addColorStop(0.82, 'rgba(5,8,12,0.18)');
  base.addColorStop(1, 'rgba(4,6,9,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const step = size / 40; // 40 m across the texture
  ctx.lineWidth = 1;
  for (let i = 0; i <= 40; i += 1) {
    const pos = i * step;
    const major = i % 5 === 0;
    const alpha = major ? 0.13 : 0.055;
    ctx.strokeStyle = `rgba(116,145,178,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Concentric reference rings around the rig.
  for (const meters of [4, 8, 12, 16]) {
    const r = (meters / 40) * size;
    ctx.strokeStyle = meters === 8 ? 'rgba(69,217,200,0.13)' : 'rgba(120,148,178,0.10)';
    ctx.lineWidth = meters === 8 ? 1.4 : 1;
    ctx.beginPath();
    ctx.arc(center, center, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair axes.
  ctx.strokeStyle = 'rgba(69,217,200,0.16)';
  ctx.beginPath();
  ctx.moveTo(center, size * 0.12);
  ctx.lineTo(center, size * 0.88);
  ctx.moveTo(size * 0.12, center);
  ctx.lineTo(size * 0.88, center);
  ctx.stroke();

  // Edge vignette alpha mask.
  const mask = ctx.createRadialGradient(center, center, maxR * 0.35, center, center, maxR * 0.96);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.72, 'rgba(0,0,0,0.8)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  return canvasTexture(canvas);
}

function createFloorGlowTexture() {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(72,116,155,0.34)');
  grad.addColorStop(0.38, 'rgba(42,70,102,0.16)');
  grad.addColorStop(0.72, 'rgba(20,32,48,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas);
}

function createShadowTexture() {
  const width = 512;
  const height = 256;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.48, 'rgba(0,0,0,0.44)');
  grad.addColorStop(0.8, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  return canvasTexture(canvas);
}

function createBaseGaugeTexture() {
  const size = 1024;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  const outer = 490;
  ctx.clearRect(0, 0, size, size);
  ctx.translate(center, center);

  ctx.strokeStyle = 'rgba(152,171,194,0.16)';
  ctx.lineWidth = 2;
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const angle = (deg - 90) * DEG;
    const r0 = major ? outer - 43 : outer - 24;
    const r1 = outer - 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r0, Math.sin(angle) * r0);
    ctx.lineTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
    ctx.strokeStyle = major ? 'rgba(255,103,56,0.32)' : 'rgba(152,171,194,0.13)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
    if (major) {
      ctx.save();
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(192,204,219,0.42)';
      ctx.font = '20px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(deg === 0 ? '0' : deg), 0, -outer + 74);
      ctx.restore();
    }
  }

  ctx.strokeStyle = 'rgba(69,217,200,0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, outer - 55, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(159,176,196,0.26)';
  ctx.font = '600 18px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('STATIC LOAD RIG  ·  FS-01  ·  TILT TABLE', 0, 70);
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(159,176,196,0.16)';
  ctx.fillText('SLOPE / BANK DEGREE INDEX', 0, 100);
  return canvasTexture(canvas);
}

function createEnvironmentTexture() {
  const width = 1024;
  const height = 512;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#475a73');
  sky.addColorStop(0.34, '#263444');
  sky.addColorStop(0.56, '#141c26');
  sky.addColorStop(1, '#040608');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Large, soft studio sources give the paint and carbon useful highlights.
  const sources = [
    { x: 245, y: 118, rx: 155, ry: 55, color: 'rgba(255,249,238,0.95)', blur: 46 },
    { x: 840, y: 152, rx: 95, ry: 48, color: 'rgba(170,205,255,0.62)', blur: 50 },
    { x: 610, y: 300, rx: 230, ry: 20, color: 'rgba(255,141,91,0.26)', blur: 45 },
    { x: 55, y: 270, rx: 50, ry: 160, color: 'rgba(93,137,188,0.34)', blur: 40 }
  ];
  for (const source of sources) {
    ctx.save();
    ctx.filter = `blur(${source.blur}px)`;
    const grad = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, Math.max(source.rx, source.ry));
    grad.addColorStop(0, source.color);
    const colorHead = source.color.slice(0, source.color.lastIndexOf(',') + 1);
    grad.addColorStop(0.5, colorHead + '0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(source.x, source.y, source.rx, source.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Faint horizon luminaire.
  const strip = ctx.createLinearGradient(0, height * 0.58, 0, height * 0.67);
  strip.addColorStop(0, 'rgba(255,180,128,0)');
  strip.addColorStop(0.5, 'rgba(255,180,128,0.18)');
  strip.addColorStop(1, 'rgba(255,180,128,0)');
  ctx.fillStyle = strip;
  ctx.fillRect(0, height * 0.58, width, height * 0.09);

  const texture = canvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/* ------------------------------ materials ------------------------------ */

function createMaterials() {
  TEX.asphalt = createAsphaltTexture();
  TEX.carbon = createCarbonTexture();
  TEX.floor = createFloorTexture();
  TEX.floorGlow = createFloorGlowTexture();
  TEX.shadow = createShadowTexture();
  TEX.baseGauge = createBaseGaugeTexture();
  TEX.env = createEnvironmentTexture();

  const plateCanvas = makeCanvas(512, 96);
  const plateCtx = plateCanvas.getContext('2d');
  plateCtx.clearRect(0, 0, 512, 96);
  plateCtx.fillStyle = 'rgba(214,208,196,0.56)';
  plateCtx.font = '600 28px ui-monospace, monospace';
  plateCtx.fillText('STATIC  LOAD  RIG  /  FS-01', 14, 40);
  plateCtx.fillStyle = 'rgba(214,208,196,0.25)';
  plateCtx.font = '16px ui-monospace, monospace';
  plateCtx.fillText('TILT TABLE  ·  STAGE 01  ·  LOAD CALIBRATION', 16, 70);
  TEX.padPlate = canvasTexture(plateCanvas);

  MAT.paint = new THREE.MeshPhysicalMaterial({
    color: 0xe8e2d4,
    metalness: 0.28,
    roughness: 0.29,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.55
  });
  MAT.paintAccent = new THREE.MeshPhysicalMaterial({
    color: 0xd23a25,
    metalness: 0.30,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.5
  });
  MAT.paintDeep = new THREE.MeshPhysicalMaterial({
    color: 0x17212c,
    metalness: 0.44,
    roughness: 0.31,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.4
  });
  MAT.carbon = new THREE.MeshStandardMaterial({
    color: 0x7f858d,
    map: TEX.carbon,
    metalness: 0.28,
    roughness: 0.52,
    envMapIntensity: 0.15
  });
  MAT.carbonMatte = new THREE.MeshStandardMaterial({
    color: 0x171b20,
    metalness: 0.14,
    roughness: 0.67,
    envMapIntensity: 0.08
  });
  MAT.titanium = new THREE.MeshStandardMaterial({
    color: 0x9ba3ad,
    metalness: 0.96,
    roughness: 0.26,
    envMapIntensity: 0.42
  });
  MAT.darkMetal = new THREE.MeshStandardMaterial({
    color: 0x282d34,
    metalness: 0.82,
    roughness: 0.34,
    envMapIntensity: 0.24
  });
  MAT.steel = new THREE.MeshStandardMaterial({
    color: 0x515a66,
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 0.3
  });
  MAT.rubber = new THREE.MeshStandardMaterial({
    color: 0x0a0b0d,
    metalness: 0.0,
    roughness: 0.92,
    envMapIntensity: 0.03
  });
  MAT.rubberSide = new THREE.MeshStandardMaterial({
    color: 0x101114,
    metalness: 0.0,
    roughness: 0.76,
    envMapIntensity: 0.04
  });
  MAT.rim = new THREE.MeshStandardMaterial({
    color: 0xc7a15b,
    metalness: 0.98,
    roughness: 0.23,
    envMapIntensity: 0.7
  });
  MAT.brakeDisc = new THREE.MeshStandardMaterial({
    color: 0x3e3a35,
    metalness: 0.72,
    roughness: 0.55,
    envMapIntensity: 0.16
  });
  MAT.brakeCaliper = new THREE.MeshStandardMaterial({
    color: 0xd23a25,
    metalness: 0.42,
    roughness: 0.32,
    envMapIntensity: 0.24
  });
  MAT.glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b1118,
    metalness: 0.65,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 0.9
  });
  MAT.helmet = new THREE.MeshPhysicalMaterial({
    color: 0xf1eee7,
    metalness: 0.18,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.55
  });
  MAT.visir = new THREE.MeshPhysicalMaterial({
    color: 0x11181e,
    metalness: 0.9,
    roughness: 0.05,
    clearcoat: 1,
    envMapIntensity: 0.8
  });
  MAT.whiteLine = new THREE.MeshStandardMaterial({
    color: 0xa8a297,
    metalness: 0.0,
    roughness: 0.85
  });
  MAT.dimLine = new THREE.MeshBasicMaterial({
    color: 0xd8d0c1,
    transparent: true,
    opacity: 0.24,
    depthWrite: false
  });
  MAT.asphalt = new THREE.MeshStandardMaterial({
    color: 0x5c626a,
    map: TEX.asphalt,
    metalness: 0.02,
    roughness: 0.98,
    envMapIntensity: 0.025
  });
  MAT.padEdge = new THREE.MeshStandardMaterial({
    color: 0x22272e,
    metalness: 0.84,
    roughness: 0.35,
    envMapIntensity: 0.18
  });
  MAT.padSide = new THREE.MeshStandardMaterial({
    color: 0x171c23,
    metalness: 0.7,
    roughness: 0.44,
    envMapIntensity: 0.14
  });
  MAT.rigMetal = new THREE.MeshStandardMaterial({
    color: 0x191e25,
    metalness: 0.55,
    roughness: 0.48,
    envMapIntensity: 0.12
  });
  MAT.rigTop = new THREE.MeshStandardMaterial({
    color: 0x2f3742,
    metalness: 0.7,
    roughness: 0.36,
    envMapIntensity: 0.16
  });
  MAT.xray = new THREE.MeshBasicMaterial({
    color: 0x86b5ff,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  MAT.loadArrow = new THREE.MeshBasicMaterial({
    color: 0x4be5d5,
    transparent: true,
    opacity: 0.82,
    toneMapped: false
  });
  MAT.loadArrowSoft = new THREE.MeshBasicMaterial({
    color: 0x2a9f99,
    transparent: true,
    opacity: 0.35,
    toneMapped: false,
    depthWrite: false
  });
  MAT.cg = new THREE.MeshBasicMaterial({
    color: 0xffc873,
    transparent: true,
    opacity: 0.92,
    toneMapped: false,
    depthTest: false
  });
  MAT.cgLine = new THREE.LineDashedMaterial({
    color: 0xffc873,
    transparent: true,
    opacity: 0.52,
    dashSize: 0.055,
    gapSize: 0.045,
    depthTest: false
  });
  MAT.contactRing = new THREE.MeshBasicMaterial({
    color: 0x45d9c8,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
}

/* ------------------------------ lighting & environment ------------------------------ */

function setupEnvironment() {
  const pmrem = new THREE.PMREMGenerator(S.renderer);
  pmrem.compileEquirectangularShader();
  S.envRT = pmrem.fromEquirectangular(TEX.env);
  S.scene.environment = S.envRT.texture;
  pmrem.dispose();
  TEX.env.dispose();
}

function setupLights() {
  const hemi = new THREE.HemisphereLight(0x9eb5d4, 0x0b0b0c, 0.22);
  S.scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1df, 1.65);
  key.position.set(6.4, 9.2, 5.6);
  key.target.position.set(0, 0.3, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -7.5;
  key.shadow.camera.right = 7.5;
  key.shadow.camera.top = 7.5;
  key.shadow.camera.bottom = -7.5;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.018;
  S.scene.add(key);
  S.scene.add(key.target);
  S.keyLight = key;

  const fill = new THREE.DirectionalLight(0x7498ff, 0.28);
  fill.position.set(-8, 4.2, -6);
  fill.target.position.set(0, 0.5, 0);
  S.scene.add(fill);
  S.scene.add(fill.target);

  const rim = new THREE.DirectionalLight(0xff8a5c, 0.34);
  rim.position.set(-4.5, 3.2, 8.4);
  rim.target.position.set(0, 0.4, 0);
  S.scene.add(rim);
  S.scene.add(rim.target);

  const overhead = new THREE.SpotLight(0xd8e8ff, 0.28, 28, 0.62, 1, 1.4);
  overhead.position.set(0, 11, 0.8);
  overhead.target.position.set(0, 0, 0);
  S.scene.add(overhead);
  S.scene.add(overhead.target);
  S.overheadLight = overhead;
}

/* ------------------------------ scenery ------------------------------ */

function buildFloor() {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(27, 96),
    new THREE.MeshStandardMaterial({
      map: TEX.floor,
      color: 0x34414f,
      transparent: true,
      opacity: 0.55,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
      envMapIntensity: 0.2
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.22;
  floor.receiveShadow = true;
  floor.renderOrder = -2;
  S.scene.add(floor);
  S.floor = floor;

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 25),
    new THREE.MeshBasicMaterial({
      map: TEX.floorGlow,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -2.215;
  glow.renderOrder = -1;
  S.scene.add(glow);

  // A faint horizon ring gives the eye a world-horizontal reference.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(17.8, 17.87, 160),
    new THREE.MeshBasicMaterial({ color: 0x7894ad, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -2.21;
  S.scene.add(ring);
}

function buildTiltRig() {
  const baseY = -1.42;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.22, 2.34, 0.2, 72), MAT.rigMetal);
  base.position.set(0, baseY - 0.1, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  S.scene.add(base);

  const baseTop = new THREE.Mesh(
    new THREE.CylinderGeometry(2.19, 2.19, 0.025, 72),
    MAT.rigTop
  );
  baseTop.position.set(0, baseY + 0.006, 0);
  baseTop.receiveShadow = true;
  S.scene.add(baseTop);

  const gauge = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 96),
    new THREE.MeshBasicMaterial({ map: TEX.baseGauge, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
  );
  gauge.rotation.x = -Math.PI / 2;
  gauge.position.set(0, baseY + 0.021, 0);
  S.scene.add(gauge);

  // Hydraulic column.
  const profile = [];
  [
    [0.5, 0.0],
    [0.44, 0.06],
    [0.4, 0.12],
    [0.36, 0.62],
    [0.31, 0.72],
    [0.26, 0.94],
    [0.21, 1.0]
  ].forEach(([r, y]) => profile.push(new THREE.Vector2(r, y)));
  const column = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), MAT.rigMetal);
  column.position.set(0, -1.42, 0);
  column.castShadow = true;
  column.receiveShadow = true;
  S.scene.add(column);

  // Collar details.
  [0.4, 0.88].forEach((h, index) => {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(index === 0 ? 0.36 : 0.245, 0.016, 8, 48), MAT.darkMetal);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, -1.42 + h, 0);
    S.scene.add(collar);
  });

  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.045, 10, 48), MAT.darkMetal);
  socket.rotation.x = Math.PI / 2;
  socket.position.set(0, -0.44, 0);
  S.scene.add(socket);

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.255, 36, 24), MAT.steel);
  joint.position.set(0, -0.34, 0);
  joint.castShadow = true;
  S.scene.add(joint);

  const jointCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.1, 24), MAT.darkMetal);
  jointCap.position.set(0, -0.14, 0);
  S.scene.add(jointCap);

  // Base feet and indicator lamps.
  for (let i = 0; i < 4; i += 1) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.08, 24), MAT.rigMetal);
    foot.position.set(Math.cos(angle) * 1.9, -1.58, Math.sin(angle) * 1.9);
    foot.castShadow = true;
    S.scene.add(foot);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff8a5c, toneMapped: false }));
    lamp.position.set(Math.cos(angle) * 2.12, baseY + 0.012, Math.sin(angle) * 2.12);
    S.scene.add(lamp);
  }

  const ledRing = new THREE.Mesh(
    new THREE.RingGeometry(2.17, 2.19, 96),
    new THREE.MeshBasicMaterial({ color: 0xff6738, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
  );
  ledRing.rotation.x = -Math.PI / 2;
  ledRing.position.y = baseY + 0.022;
  S.scene.add(ledRing);

  // Soft pool of light on the studio floor.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(4.6, 64),
    new THREE.MeshBasicMaterial({ map: TEX.floorGlow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -2.205;
  S.scene.add(pool);
}

function buildRoadPad() {
  const pad = new THREE.Group();
  pad.name = 'roadPad';
  S.roadGroup.add(pad);
  S.pad = pad;

  const slab = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.18, 7.6), MAT.padSide);
  slab.position.y = -0.09;
  slab.castShadow = true;
  slab.receiveShadow = true;
  pad.add(slab);

  const top = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 7.6), MAT.asphalt);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.004;
  top.receiveShadow = true;
  top.castShadow = false;
  pad.add(top);
  S.padTop = top;

  const trim = new THREE.Mesh(new THREE.BoxGeometry(11.52, 0.03, 7.72), MAT.padEdge);
  trim.position.y = -0.018;
  trim.castShadow = true;
  trim.receiveShadow = true;
  pad.add(trim);

  // White perimeter test-pad markings.
  const lineMat = MAT.whiteLine;
  const long = 10.92;
  const short = 7.12;
  const y = 0.012;
  const lines = [
    [long, 0.005, 0.030, 0, y, -3.56],
    [long, 0.005, 0.030, 0, y, 3.56],
    [0.030, 0.005, short, -5.46, y, 0],
    [0.030, 0.005, short, 5.46, y, 0]
  ];
  for (const [w, h, d, x, yy, z] of lines) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lineMat);
    line.position.set(x, yy, z);
    line.receiveShadow = true;
    pad.add(line);
  }

  // Centre reference dashes along the car axis.
  for (let i = -5; i <= 5; i += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.004, 0.028), MAT.dimLine);
    dash.position.set(i * 0.95, 0.014, 0);
    dash.receiveShadow = false;
    pad.add(dash);
  }

  // Corner brackets.
  const bracketMat = new THREE.MeshBasicMaterial({ color: 0xd9d3c8, transparent: true, opacity: 0.38, toneMapped: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bx = sx * 5.28;
      const bz = sz * 3.45;
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.004, 0.035), bracketMat);
      a.position.set(bx, 0.015, bz);
      pad.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.004, 0.5), bracketMat);
      b.position.set(bx, 0.015, bz);
      pad.add(b);
    }
  }

  // Under-slab structural rails visible at low camera angles.
  for (const z of [-2.1, 2.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.13, 0.16), MAT.darkMetal);
    rail.position.set(0, -0.22, z);
    rail.castShadow = true;
    pad.add(rail);
  }
  for (const x of [-3.9, 0, 3.9]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 5.8), MAT.darkMetal);
    cross.position.set(x, -0.23, 0);
    cross.castShadow = true;
    pad.add(cross);
  }
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.16, 32), MAT.steel);
  mount.position.set(0, -0.25, 0);
  mount.castShadow = true;
  pad.add(mount);

  // Static contact shadow painted onto the pad, independent from shadow maps.
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 2.35),
    new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, opacity: 0.5, depthWrite: false, color: 0x000000, toneMapped: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, 0.011, 0);
  blob.renderOrder = 1;
  pad.add(blob);
  S.contactBlob = blob;

  // A logo plate on the pad's near side (faces up the +Z side).
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.34), new THREE.MeshBasicMaterial({ map: TEX.padPlate, transparent: true, opacity: 0.82, depthWrite: false }));
  plate.rotation.y = Math.PI / 2;
  plate.position.set(-4.8, 0.014, 0);
  pad.add(plate);
}

/* ------------------------------ overlay ------------------------------ */

function makeArrow(colorMaterial, { head = 0.16, radius = 0.028 } = {}) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.82, 1, 10, 1), colorMaterial);
  shaft.geometry.translate(0, 0.5, 0);
  shaft.castShadow = false;
  group.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.1, head, 12), colorMaterial);
  tip.castShadow = false;
  group.add(tip);
  return { group, shaft, tip, head };
}

function buildOverlay() {
  const overlay = new THREE.Group();
  overlay.name = 'loadOverlay';
  S.roadGroup.add(overlay);
  S.loadOverlay = overlay;
  S.loadArrows = [];

  for (let i = 0; i < 4; i += 1) {
    const arrow = makeArrow(MAT.loadArrow, { head: 0.115, radius: 0.016 });
    overlay.add(arrow.group);

    const contactRing = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.235, 36), MAT.contactRing.clone());
    contactRing.rotation.x = -Math.PI / 2;
    contactRing.position.y = 0.016;
    overlay.add(contactRing);

    const leaderGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const leader = new THREE.Line(leaderGeometry, new THREE.LineBasicMaterial({
      color: 0x45d9c8,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    }));
    overlay.add(leader);

    S.loadArrows.push({ arrow, contactRing, leader });
  }

  // World-space CG plumb line and marker.
  const cg = new THREE.Group();
  S.scene.add(cg);
  S.cgOverlay = cg;

  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), MAT.cg);
  diamond.renderOrder = 20;
  cg.add(diamond);
  S.cgMarker = diamond;

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.0055, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, toneMapped: false })
  );
  halo.renderOrder = 20;
  cg.add(halo);
  S.cgHalo = halo;

  const cgLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const cgLine = new THREE.Line(cgLineGeom, MAT.cgLine);
  cgLine.renderOrder = 19;
  cg.add(cgLine);
  cgLine.computeLineDistances();
  S.cgLine = cgLine;

  const projRing = new THREE.Mesh(
    new THREE.RingGeometry(0.09, 0.125, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false })
  );
  projRing.renderOrder = 20;
  S.scene.add(projRing);
  S.cgProjection = projRing;

  const projCrossMat = new THREE.LineBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.42, depthTest: false });
  const crossGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.22, 0, 0), new THREE.Vector3(0.22, 0, 0),
    new THREE.Vector3(0, 0, -0.22), new THREE.Vector3(0, 0, 0.22)
  ]);
  const projCross = new THREE.LineSegments(crossGeom, projCrossMat);
  projCross.renderOrder = 20;
  S.scene.add(projCross);
  S.cgProjectionCross = projCross;
}

function updateOverlays(model) {
  const visible = Boolean(state.showLoads);
  S.loadOverlay.visible = visible;
  const avgCorner = model.totalWeight / 4;
  const maxLoad = Math.max(...model.loads, 1);

  for (let i = 0; i < 4; i += 1) {
    const wheel = model.wheels[i];
    const load = model.loads[i];
    const axleWidth = wheel.axle === 'front' ? model.dims.wF : model.dims.wR;
    const outward = wheel.zSign * (axleWidth / 2 + 0.26);
    const baseZ = wheel.z + outward;
    const baseX = wheel.x + (wheel.axle === 'front' ? 0.24 : -0.24);
    const arrowHeight = clamp(0.26 + 0.56 * (load / Math.max(avgCorner, 1)), 0.2, 0.88);
    const arrow = S.loadArrows[i];
    const shaftLength = Math.max(0.02, arrowHeight - arrow.arrow.head);
    arrow.arrow.group.position.set(baseX, 0.035, baseZ);
    arrow.arrow.group.rotation.set(0, 0, 0);
    arrow.arrow.shaft.scale.y = shaftLength;
    arrow.arrow.shaft.position.y = 0;
    arrow.arrow.tip.position.y = shaftLength + arrow.arrow.head / 2;
    arrow.arrow.group.visible = visible && load > 0.5;
    const hueScale = clamp(load / maxLoad, 0, 1);
    arrow.arrow.shaft.material = MAT.loadArrow;
    arrow.arrow.tip.material = MAT.loadArrow;

    arrow.contactRing.visible = visible;
    arrow.contactRing.position.set(wheel.x, 0.018, wheel.z);
    arrow.contactRing.material.opacity = 0.12 + 0.24 * hueScale;

    // Thin leader on the pad from the contact patch to the annotation.
    const positions = arrow.leader.geometry.attributes.position;
    positions.setXYZ(0, wheel.x, 0.017, wheel.z);
    positions.setXYZ(1, baseX, 0.017, baseZ);
    positions.needsUpdate = true;
    arrow.leader.visible = visible;
    arrow.leader.material.opacity = 0.18 + 0.18 * hueScale;
  }

  // CG marker / plumb line.
  if (S.bodyPivot) {
    S.bodyPivot.updateWorldMatrix(true, false);
    const cgLocal = new THREE.Vector3(model.cgBody.x, model.cgBody.y, model.cgBody.z);
    cgLocal.applyMatrix4(S.bodyPivot.matrixWorld);
    S.cgWorld.copy(cgLocal);

    const proj = new THREE.Vector3(model.px, 0.018, model.pz);
    S.roadGroup.localToWorld(proj);
    S.projWorld.copy(proj);

    S.cgMarker.position.copy(S.cgWorld);
    S.cgHalo.position.copy(S.cgWorld);
    S.cgHalo.quaternion.copy(S.camera.quaternion);
    const linePositions = S.cgLine.geometry.attributes.position;
    linePositions.setXYZ(0, S.cgWorld.x, S.cgWorld.y, S.cgWorld.z);
    linePositions.setXYZ(1, S.projWorld.x, S.projWorld.y, S.projWorld.z);
    linePositions.needsUpdate = true;
    S.cgLine.geometry.computeBoundingSphere();
    S.cgLine.computeLineDistances();

    S.cgProjection.position.copy(S.projWorld).add(new THREE.Vector3(0, 0.006, 0));
    S.cgProjection.quaternion.copy(S.roadGroup.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    S.cgProjectionCross.position.copy(S.projWorld).add(new THREE.Vector3(0, 0.006, 0));
    S.cgProjectionCross.quaternion.copy(S.roadGroup.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));

    const cgVisible = Boolean(state.showCG);
    S.cgOverlay.visible = cgVisible;
    S.cgProjection.visible = cgVisible;
    S.cgProjectionCross.visible = cgVisible;
  }

  // Gather anchors for DOM labels.
  const normal = S.roadGroup.quaternion;
  S.labelAnchors = model.wheels.map((wheel, i) => {
    const axleWidth = wheel.axle === 'front' ? model.dims.wF : model.dims.wR;
    const baseZ = wheel.z + wheel.zSign * (axleWidth / 2 + 0.30);
    const baseX = wheel.x + (wheel.axle === 'front' ? 0.24 : -0.24);
    const h = clamp(0.26 + 0.56 * (model.loads[i] / Math.max(avgCorner, 1)), 0.2, 0.88);
    const local = new THREE.Vector3(baseX, 0.04 + h + 0.10, baseZ);
    const world = S.roadGroup.localToWorld(local.clone());
    return { key: wheel.key, load: model.loads[i], world };
  });
}

/* ------------------------------ camera ------------------------------ */

function initCameraControls() {
  const el = S.renderer.domElement;
  el.addEventListener('contextmenu', (event) => event.preventDefault());

  const onPointerDown = (event) => {
    if (event.button === 2 || event.shiftKey) {
      CAMERA.dragging = { mode: 'pan', x: event.clientX, y: event.clientY };
      el.classList.add('is-panning');
    } else {
      CAMERA.dragging = { mode: 'rotate', x: event.clientX, y: event.clientY };
      el.classList.add('is-dragging');
    }
    CAMERA.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (CAMERA.pointers.size === 2) {
      CAMERA.dragging = { mode: 'pinch', distance: pointerDistance() };
    }
    el.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const pointerDistance = () => {
    const values = Array.from(CAMERA.pointers.values());
    if (values.length < 2) return 0;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  };

  const onPointerMove = (event) => {
    if (!CAMERA.pointers.has(event.pointerId)) return;
    CAMERA.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (CAMERA.pointers.size >= 2) {
      const distance = pointerDistance();
      if (CAMERA.dragging && CAMERA.dragging.mode === 'pinch' && CAMERA.dragging.distance > 0) {
        const ratio = distance / CAMERA.dragging.distance;
        CAMERA.goalRadius = clamp(CAMERA.goalRadius / ratio, 4.0, 17);
      }
      CAMERA.dragging = { mode: 'pinch', distance };
      return;
    }

    if (!CAMERA.dragging) return;
    const dx = event.clientX - CAMERA.dragging.x;
    const dy = event.clientY - CAMERA.dragging.y;
    CAMERA.dragging.x = event.clientX;
    CAMERA.dragging.y = event.clientY;

    if (CAMERA.dragging.mode === 'pan') {
      const scale = CAMERA.goalRadius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(S.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(S.camera.matrix, 1);
      CAMERA.goalTarget.addScaledVector(right, -dx * scale);
      CAMERA.goalTarget.addScaledVector(up, dy * scale);
      CAMERA.goalTarget.x = clamp(CAMERA.goalTarget.x, -3.4, 3.4);
      CAMERA.goalTarget.y = clamp(CAMERA.goalTarget.y, -0.2, 2.3);
      CAMERA.goalTarget.z = clamp(CAMERA.goalTarget.z, -3.4, 3.4);
    } else {
      CAMERA.goalTheta -= dx * 0.0063;
      CAMERA.goalPhi = clamp(CAMERA.goalPhi - dy * 0.005, 0.24, 1.43);
      CAMERA.userMoved = true;
    }
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    CAMERA.pointers.delete(event.pointerId);
    if (CAMERA.pointers.size === 0) {
      CAMERA.dragging = null;
      el.classList.remove('is-dragging');
      el.classList.remove('is-panning');
    } else if (CAMERA.pointers.size === 1) {
      const [remaining] = Array.from(CAMERA.pointers.values());
      CAMERA.dragging = { mode: 'rotate', x: remaining.x, y: remaining.y };
      el.classList.remove('is-dragging');
      el.classList.add('is-dragging');
    }
    try { el.releasePointerCapture(event.pointerId); } catch (_) { /* noop */ }
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('pointerleave', (event) => {
    if (CAMERA.dragging && CAMERA.pointers.size === 1) {
      // Keep capture; pointerleave should not cancel an active drag.
    }
  });

  el.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0009);
    CAMERA.goalRadius = clamp(CAMERA.goalRadius * factor, 4.0, 17);
  }, { passive: false });

  el.addEventListener('dblclick', () => resetCamera());
}

function setCameraPreset(name, immediate = false) {
  const preset = CAMERA_PRESETS[name];
  if (!preset) return;
  CAMERA.goalTheta = preset.theta;
  CAMERA.goalPhi = preset.phi;
  CAMERA.goalRadius = preset.radius;
  CAMERA.goalTarget.set(preset.target[0], preset.target[1], preset.target[2]);
  CAMERA.userMoved = false;
  if (immediate) {
    CAMERA.theta = preset.theta;
    CAMERA.phi = preset.phi;
    CAMERA.radius = preset.radius;
    CAMERA.target.copy(CAMERA.goalTarget);
  }
}

function resetCamera(immediate = false) {
  setCameraPreset(PORTRAIT_QUERY.matches ? 'portrait' : 'threeQuarter', immediate);
}

function updateCamera(dt) {
  if (autoRotate && !REDUCED_MOTION && !CAMERA.dragging) {
    CAMERA.goalTheta += dt * 0.115;
  }

  const speed = CAMERA.userMoved || CAMERA.dragging ? 11 : 3.4;
  const k = 1 - Math.exp(-dt * speed);
  CAMERA.theta = lerp(CAMERA.theta, CAMERA.goalTheta, k);
  CAMERA.phi = lerp(CAMERA.phi, CAMERA.goalPhi, k);
  CAMERA.radius = lerp(CAMERA.radius, CAMERA.goalRadius, k);
  CAMERA.target.lerp(CAMERA.goalTarget, k);

  const sinPhi = Math.sin(CAMERA.phi);
  S.camera.position.set(
    CAMERA.target.x + CAMERA.radius * sinPhi * Math.cos(CAMERA.theta),
    CAMERA.target.y + CAMERA.radius * Math.cos(CAMERA.phi),
    CAMERA.target.z + CAMERA.radius * sinPhi * Math.sin(CAMERA.theta)
  );
  S.camera.lookAt(CAMERA.target);
  S.camera.updateMatrixWorld();
}

function resizeScene() {
  if (!S.renderer || !S.host) return;
  const width = Math.max(1, S.host.clientWidth);
  const height = Math.max(1, S.host.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  S.renderer.setPixelRatio(pixelRatio);
  S.renderer.setSize(width, height, true);
  S.camera.aspect = width / height;
  S.camera.updateProjectionMatrix();
}

function projectWorld(world, out = { x: 0, y: 0, visible: false }) {
  if (!S.camera || !S.renderer) return out;
  const projected = world.clone().project(S.camera);
  const rect = S.renderer.domElement.getBoundingClientRect();
  out.x = (projected.x * 0.5 + 0.5) * rect.width;
  out.y = (-projected.y * 0.5 + 0.5) * rect.height;
  out.visible = projected.z > -1 && projected.z < 1 && out.x > -80 && out.x < rect.width + 80 && out.y > -60 && out.y < rect.height + 60;
  return out;
}

/* ------------------------------ scene bootstrap ------------------------------ */

function initScene() {
  if (S.initialized) return;
  S.host = document.getElementById('viewport');

  S.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  S.renderer.setClearColor(0x000000, 0);
  S.renderer.outputEncoding = THREE.sRGBEncoding;
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 0.72;
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.domElement.setAttribute('aria-label', '方程式赛车三维静态底盘台');
  S.renderer.domElement.setAttribute('tabindex', '0');
  S.host.appendChild(S.renderer.domElement);

  S.scene = new THREE.Scene();
  S.scene.fog = new THREE.Fog(0x070b11, 17, 48);

  S.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 90);
  S.camera.position.set(8, 4, 5);

  createMaterials();
  setupEnvironment();
  setupLights();
  buildFloor();
  buildTiltRig();

  S.roadGroup = new THREE.Group();
  S.roadGroup.name = 'roadGroup';
  S.scene.add(S.roadGroup);

  S.carRoot = new THREE.Group();
  S.carRoot.name = 'carRoot';
  S.roadGroup.add(S.carRoot);

  S.bodyPivot = new THREE.Group();
  S.bodyPivot.name = 'bodyPivot';
  S.carRoot.add(S.bodyPivot);

  buildRoadPad();
  buildOverlay();
  initCameraControls();

  const resizeObserver = new ResizeObserver(() => resizeScene());
  resizeObserver.observe(S.host);
  window.addEventListener('resize', resizeScene);

  resizeScene();

  // Portrait screens need a wider, front-elevated framing to keep the full car
  // visible; desktop starts at the standard three-quarter view.
  if (PORTRAIT_QUERY.matches) setCameraPreset('portrait', true);
  else setCameraPreset('threeQuarter', true);
  const onPortraitChange = (event) => {
    setCameraPreset(event.matches ? 'portrait' : 'threeQuarter');
  };
  if (PORTRAIT_QUERY.addEventListener) PORTRAIT_QUERY.addEventListener('change', onPortraitChange);
  else if (PORTRAIT_QUERY.addListener) PORTRAIT_QUERY.addListener(onPortraitChange);

  updateCamera(0.016);
  S.initialized = true;
}
