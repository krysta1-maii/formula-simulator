/* =========================================================================
   40-app.js — boot, state orchestration, render loop and export
   ========================================================================= */

const REBUILD_KEYS = new Set(['wheelbase', 'trackFront', 'trackRear', 'wheelRadius', 'tireWidthF', 'tireWidthR']);
const PHYSICS_KEYS = ['mass', 'frontWeightPct', 'cgHeight', 'cgLateral', 'wheelRateF', 'wheelRateR', 'dampingF', 'dampingR', 'arbFront', 'arbRear', 'slope', 'bank', 'friction'];
const PENDING = {
  rebuild: false,
  reason: '',
  requestedAt: 0,
  lastBuildAt: 0,
  commits: 0,
  failures: 0,
  lastPolicy: 'none'
};

function physicsSignature(source = state) {
  return PHYSICS_KEYS.map((key) => Number(source[key]).toPrecision(10)).join('|');
}

function stampReference(sim, source = state) {
  if (!sim || !sim.reference) return;
  sim.geometryRevision = sim.reference.geometryRevision;
  sim.reference.physicsSignature = physicsSignature(source);
  sim.steerApplied = source.steer;
}

let booted = false;
let firstFrameRendered = false;
let loaderShownAt = 0;
let lastFrameTime = 0;
let screenshotCount = 0;

function liveModel() {
  if (!SIM) return computeStatic(state);
  return simBuildModel(SIM, state);
}

function calibrateRack(sim, steerDeg) {
  if (!sim || !sim.reference || !sim.reference.suspension) return 0;
  const st = sim.state;
  // B1-1: sim.state is the centre of mass; the linkage solver expects the
  // body reference point.
  const ref = simReferencePoint(sim);
  return suspRackForSteer(
    sim.reference.suspension.corners,
    { x: ref.x, y: ref.y, z: ref.z },
    new THREE.Quaternion(st.qx, st.qy, st.qz, st.qw),
    steerDeg * DEG
  );
}

function updateSceneFromModel(model) {
  if (typeof applyXray === 'function') applyXray();
  S.roadGroup.quaternion.copy(model.frame.q);
  S.roadGroup.updateMatrixWorld(true);
  updateCar(model);
  S.scene.updateMatrixWorld(true);
  updateOverlays(model);
  S.scene.updateMatrixWorld(true);
  if (UI.initialized) UI.updateLabelPositions();
}

function requestRebuild(reason = 'explicit') {
  if (!PENDING.rebuild) PENDING.requestedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  PENDING.rebuild = true;
  PENDING.reason = reason;
  PENDING.lastPolicy = reason === 'geometry' ? 'geometry-forced' : (reason || 'explicit');
}

function processPendingRebuild(now) {
  if (!PENDING.rebuild) return;
  if (now - PENDING.lastBuildAt < 85) return;
  PENDING.lastBuildAt = now;
  try {
    if (!SIM) SIM = simCreate(state);
    simReset(SIM, state, { settle: 0.5 });
    SIM.advanceCarry = 0;
    stampReference(SIM, state);
    SIM.rackShift = calibrateRack(SIM, state.steer);
    const model = simBuildModel(SIM, state);
    buildCar(model);
    applyXray();
    S.roadGroup.quaternion.copy(model.frame.q);
    S.roadGroup.updateMatrixWorld(true);
    updateCar(model);
    S.scene.updateMatrixWorld(true);
    updateOverlays(model);
    S.scene.updateMatrixWorld(true);
    UI.refreshSelfTests({ dynamic: false });
    UI.refreshTelemetry(model);
    UI.updateLabelPositions();
    PENDING.rebuild = false;
    PENDING.commits += 1;
    PENDING.failures = 0;
  } catch (error) {
    PENDING.failures += 1;
    if (PENDING.failures >= 3) {
      PENDING.rebuild = false;
      showFatalError(error);
    } else {
      PENDING.rebuild = true;
    }
  }
}

function refreshAll({ rebuild = false, reason = 'params' } = {}) {
  if (!booted) return;
  if (PENDING.rebuild) { PENDING.lastPolicy = 'pending'; return; }
  const staleGeometry = !SIM || geometryRevisionFor(state) !== SIM.geometryRevision;
  if (rebuild || staleGeometry) {
    requestRebuild(staleGeometry ? 'geometry' : reason);
    return;
  }
  const stalePhysics = !SIM.reference || SIM.reference.physicsSignature !== physicsSignature(state);
  if (stalePhysics) {
    simRetargetReference(SIM, state);
    stampReference(SIM, state);
    SIM.rackShift = calibrateRack(SIM, state.steer);
    const model = simBuildModel(SIM, state);
    updateSceneFromModel(model);
    UI.refreshTelemetry(model);
    UI.refreshLabelContent(model);
    PENDING.lastPolicy = 'params';
    return;
  }
  const staleSteer = !nearly(SIM.steerApplied, state.steer, 1e-12);
  if (staleSteer) {
    SIM.rackShift = calibrateRack(SIM, state.steer);
    SIM.steerApplied = state.steer;
    const model = simBuildModel(SIM, state);
    updateSceneFromModel(model);
    UI.refreshTelemetry(model);
    UI.refreshLabelContent(model);
    PENDING.lastPolicy = 'display';
    return;
  }
  PENDING.lastPolicy = 'display';
  UI.refreshTelemetry(UI.lastModel);
  UI.refreshLabelContent(UI.lastModel);
  if (UI.lastModel) {
    updateOverlays(UI.lastModel);
    S.scene.updateMatrixWorld(false);
  }
}

function formatStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function formatLocalDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function exportScreenshot() {
  if (!S.renderer) return false;
  const model = PENDING.rebuild && UI.lastModel ? UI.lastModel : liveModel();
  updateSceneFromModel(model);
  S.renderer.render(S.scene, S.camera);

  const source = S.renderer.domElement;
  const width = source.width;
  const height = source.height;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#0b111a');
  background.addColorStop(0.44, '#080d14');
  background.addColorStop(1, '#04070b');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.54, height * 0.36, 0, width * 0.54, height * 0.36, width * 0.62);
  glow.addColorStop(0, 'rgba(63,85,112,0.30)');
  glow.addColorStop(0.5, 'rgba(25,40,58,0.10)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const warm = ctx.createRadialGradient(width * 0.82, height * 0.78, 0, width * 0.82, height * 0.78, width * 0.42);
  warm.addColorStop(0, 'rgba(255,103,56,0.075)');
  warm.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(source, 0, 0, width, height);

  const vignette = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.2, width / 2, height * 0.45, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const scale = Math.max(0.55, Math.min(1.6, Math.min(width / 470, height / 1000)));
  const pad = Math.round(34 * scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(236,241,246,0.95)';
  ctx.font = `600 ${Math.round(22 * scale)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText('FS-01  /  DYNAMIC CHASSIS RIG', pad, pad + 26 * scale);
  ctx.fillStyle = 'rgba(255,103,56,0.95)';
  ctx.fillRect(pad, pad + 37 * scale, 38 * scale, 3 * scale);
  ctx.fillStyle = 'rgba(151,167,185,0.8)';
  ctx.font = `500 ${Math.round(11 * scale)}px ui-monospace, monospace`;
  ctx.fillText('STAGE 02  ·  SIX-DOF · SPRING-DAMPER  ·  ' + formatLocalDate(), pad, pad + 58 * scale);

  const cardW = Math.round(392 * scale);
  const cardH = Math.round(216 * scale);
  const cardX = pad;
  const cardY = height - pad - cardH;
  ctx.fillStyle = 'rgba(6,10,15,0.82)';
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, 13 * scale);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 1 * scale;
  ctx.stroke();
  ctx.fillStyle = 'rgba(69,217,200,0.9)';
  ctx.fillRect(cardX + 16 * scale, cardY + 17 * scale, 26 * scale, 2 * scale);
  ctx.fillStyle = 'rgba(160,177,195,0.82)';
  ctx.font = `500 ${Math.round(10 * scale)}px ui-monospace, monospace`;
  ctx.fillText('DYNAMIC CORNER LOADS', cardX + 50 * scale, cardY + 22 * scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(cardX + cardW / 2, cardY + 38 * scale);
  ctx.lineTo(cardX + cardW / 2, cardY + 154 * scale);
  ctx.stroke();
  const unit = unitDisplay();
  const positions = [
    ['FL', 16, 58], ['FR', cardW / 2 / scale + 18, 58],
    ['RL', 16, 120], ['RR', cardW / 2 / scale + 18, 120]
  ];
  for (const [key, dx, dy] of positions) {
    const index = CORNERS.findIndex((corner) => corner.key === key);
    const value = formatLoadValue(model.loads[index], state.units);
    ctx.fillStyle = 'rgba(69,217,200,0.92)';
    ctx.font = `700 ${Math.round(12 * scale)}px ui-monospace, monospace`;
    ctx.fillText(key, cardX + dx * scale, cardY + dy * scale);
    ctx.fillStyle = 'rgba(243,247,250,0.97)';
    ctx.font = `500 ${Math.round(30 * scale)}px "SFMono-Regular", ui-monospace, monospace`;
    ctx.fillText(value, cardX + dx * scale, cardY + (dy + 29) * scale);
    const valueWidth = ctx.measureText(value).width;
    ctx.fillStyle = 'rgba(142,158,175,0.72)';
    ctx.font = `500 ${Math.round(10 * scale)}px ui-monospace, monospace`;
    ctx.fillText(unit, cardX + dx * scale + valueWidth + 7 * scale, cardY + (dy + 29) * scale);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(cardX + 16 * scale, cardY + 164 * scale);
  ctx.lineTo(cardX + cardW - 16 * scale, cardY + 164 * scale);
  ctx.stroke();
  ctx.fillStyle = 'rgba(156,173,191,0.8)';
  ctx.font = `500 ${Math.round(9.5 * scale)}px ui-monospace, monospace`;
  ctx.fillText(
    `ΣN ${loadDisplay(model.sumLoads)} ${unit}    ·    β ${model.frame.betaDeg.toFixed(2)}°    ·    μreq ${model.frictionDemand.toFixed(3)}`,
    cardX + 16 * scale,
    cardY + 184 * scale
  );
  ctx.fillText(
    `h ${formatSigned(model.heave * 1000, 1)} mm    ·    θ ${formatSigned(model.poseDeg.pitch, 2)}°    ·    φ ${formatSigned(model.poseDeg.roll, 2)}°    ·    ${model.sim ? (model.sim.running ? 'RUN' : 'PAUSE') : 'STATIC'}`,
    cardX + 16 * scale,
    cardY + 201 * scale
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(133,149,168,0.55)';
  ctx.font = `500 ${Math.round(9 * scale)}px ui-monospace, monospace`;
  const creditY = cardX + cardW > width - 260 * scale ? cardY - 10 * scale : height - pad;
  ctx.fillText('FORMULA SIMULATOR  ·  DESIGN.md v0.2  ·  THREE.JS r149', width - pad, creditY);
  ctx.textAlign = 'left';

  const link = document.createElement('a');
  screenshotCount += 1;
  link.download = `FS-01_static_${formatStamp()}_${screenshotCount}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  return true;
}

function showFatalError(error) {
  console.error(error);
  const loading = document.getElementById('loading');
  if (loading) loading.classList.add('is-done');
  const screen = document.getElementById('errorScreen');
  const message = document.getElementById('errorMessage');
  if (screen) screen.hidden = false;
  if (message && error && error.message) {
    message.textContent = '当前浏览器无法启动三维动态底盘演示：' + error.message;
  }
}

function bindGlobalAPI() {
  window.FSApp = {
    ready: false,
    version: APP_VERSION,
    getState: () => cloneState(state),
    getSnapshot: () => {
      const model = liveModel();
      const tests = (UI.selfTestCache && UI.selfTestCache.staticTests) || (UI.selfTests.length ? UI.selfTests : runSelfTests(state));
      const diag = getCarDiagnostics();
      return {
        version: APP_VERSION,
        state: cloneState(state),
        loads: model.loads.slice(),
        rawLoads: model.rawLoads.slice(),
        levelLoads: model.levelLoads.slice(),
        totalNormal: model.sumLoads,
        totalWeight: model.totalWeight,
        betaDeg: model.frame.betaDeg,
        frictionDemand: model.frictionDemand,
        frictionCapacity: model.frictionCapacity,
        frontShare: model.frontShare,
        rearShare: model.rearShare,
        leftShare: model.leftShare,
        rightShare: model.rightShare,
        frontLoad: model.frontLoad,
        rearLoad: model.rearLoad,
        leftLoad: model.leftLoad,
        rightLoad: model.rightLoad,
        heaveMm: model.heave * 1000,
        pitchDeg: model.poseDeg.pitch,
        rollDeg: model.poseDeg.roll,
        yawDeg: model.poseDeg.yaw,
        bodyPos: model.bodyPos ? { x: model.bodyPos.x, y: model.bodyPos.y, z: model.bodyPos.z } : null,
        solved: model.solved || null,
        bodyVelocity: model.bodyVelocity ? { x: model.bodyVelocity.x, y: model.bodyVelocity.y, z: model.bodyVelocity.z } : null,
        bodyRatesDeg: model.bodyRatesDeg || null,
        travelMm: model.travelMm.slice(),
        springCompressionMm: model.springCompressionMm ? model.springCompressionMm.slice() : null,
        damperCompressionRate: model.damperCompressionRate ? model.damperCompressionRate.slice() : null,
        springForce: model.springForce ? model.springForce.slice() : null,
        dampingForce: model.dampingForce ? model.dampingForce.slice() : null,
        arbForce: model.arbForce ? model.arbForce.slice() : null,
        inertia: model.inertia ? Object.assign({}, model.inertia) : null,
        frequencies: model.frequencies ? Object.assign({}, model.frequencies) : null,
        motionRatio: model.motionRatio ? Object.assign({}, model.motionRatio) : null,
        springRateCoil: model.springRateCoil ? model.springRateCoil.slice() : null,
        damperRateWheel: model.damperRateWheel ? model.damperRateWheel.slice() : null,
        damperRateShaft: model.damperRateShaft ? model.damperRateShaft.slice() : null,
        sim: model.sim ? Object.assign({}, model.sim) : null,
        arbRate: Object.assign({}, model.arbRate),
        arbBladeAngleDeg: Object.assign({}, model.arbBladeAngleDeg),
        arbRollStiffness: model.arbRollStiffness,
        arbMoment: model.arbMoment,
        arbTwistDeg: diag.arbTwistDeg,
        arbStretchMm: diag.arbStretchMm,
        cgX: model.xCG,
        cgProjectionX: model.px,
        cgProjectionZ: model.pz,
        forceError: model.forceError,
        momentXError: model.momentXError,
        momentZError: model.momentZError,
        frictionOk: model.frictionOk,
        equilibriumOk: model.equilibriumOk,
        contactOk: model.contactOk,
        liftedCount: model.liftedCount,
        diag: getCarDiagnostics(),
        selfTests: tests.map((test) => ({ name: test.name, ok: test.ok, detail: test.detail })),
        camera: {
          theta: CAMERA.theta,
          phi: CAMERA.phi,
          zoom: CAMERA.zoom,
          radius: cameraDistance(),
          projection: CAMERA.projection,
          preset: CAMERA.preset,
          target: CAMERA.target.toArray(),
          transition: Boolean(CAMERA.transition)
        },
        pendingRebuild: PENDING.rebuild,
        setupRevision: typeof SETUP_REVISION === 'number' ? SETUP_REVISION : 0,
        selfTestRuns: UI.selfTestCache && UI.selfTestCache.runs ? Object.assign({}, UI.selfTestCache.runs) : { static: 0, dynamic: 0 },
        geometry: {
          sceneRevision: CAR.geometryRevision || null,
          physicsRevision: SIM && SIM.reference ? SIM.reference.geometryRevision : null,
          pending: PENDING.rebuild,
          policy: PENDING.lastPolicy,
          commitCount: PENDING.commits,
          mismatch: Boolean(CAR.diag.geometryMismatch),
          dims: {
            wheelbase: state.wheelbase,
            trackFront: state.trackFront,
            trackRear: state.trackRear,
            wheelRadius: state.wheelRadius,
            tireWidthF: state.tireWidthF,
            tireWidthR: state.tireWidthR
          }
        },
        assets: CAR.assets ? {
          totals: Object.assign({}, CAR.assets.totals),
          lastBuild: CAR.assets.lastBuild ? Object.assign({}, CAR.assets.lastBuild) : null,
          lastTeardown: CAR.assets.lastTeardown ? Object.assign({}, CAR.assets.lastTeardown) : null
        } : null,
        frameCount: UI.frameCount || 0
      };
    },
    setState: (patch, options = {}) => {
      if (!patch || typeof patch !== 'object') return window.FSApp.getSnapshot();
      const previous = cloneState(state);
      const merged = sanitizeState(Object.assign({}, state, patch));
      const dimensionsChanged = geometrySignature(merged) !== geometrySignature(previous);
      const forced = options.rebuild === true;
      const rebuild = dimensionsChanged || forced;
      if (options.rebuild === false && dimensionsChanged) {
        console.warn('[FS-01] geometry dimensions changed; rebuild:false is ignored');
      }
      Object.assign(state, merged);
      syncControlsFromState();
      persistState();
      refreshAll({ rebuild, reason: dimensionsChanged ? 'geometry' : (forced ? 'explicit' : 'params') });
      return window.FSApp.getSnapshot();
    },
    reset: () => {
      resetAll();
      return window.FSApp.getSnapshot();
    },
    setSimRunning: (running) => {
      if (SIM) SIM.running = Boolean(running);
      if (UI.syncSimControls) UI.syncSimControls();
      return window.FSApp.getSnapshot();
    },
    toggleSimRunning: () => {
      if (SIM) SIM.running = !SIM.running;
      if (UI.syncSimControls) UI.syncSimControls();
      return window.FSApp.getSnapshot();
    },
    resetDynamics: (options = {}) => {
      if (!SIM) SIM = simCreate(state);
      if (SIM.geometryRevision !== geometryRevisionFor(state)) {
        requestRebuild('geometry');
        return window.FSApp.getSnapshot();
      }
      const settle = Number.isFinite(options.settle) ? options.settle : 0;
      simReset(SIM, state, { settle });
      SIM.advanceCarry = 0;
      stampReference(SIM, state);
      const model = simBuildModel(SIM, state);
      updateSceneFromModel(model);
      UI.refreshTelemetry(model);
      if (UI.syncSimControls) UI.syncSimControls();
      return window.FSApp.getSnapshot();
    },
    impulse: (kind = 'heave') => {
      if (!SIM) SIM = simCreate(state);
      simApplyImpulse(SIM, kind);
      if (UI.syncSimControls) UI.syncSimControls();
      return window.FSApp.getSnapshot();
    },
    advanceSimulation: (seconds = 0.5) => {
      if (!SIM) SIM = simCreate(state);
      const duration = clamp(Number(seconds) || 0, 0, 10);
      const carry = Number.isFinite(SIM.advanceCarry) ? SIM.advanceCarry : 0;
      const total = carry + duration;
      const steps = Math.floor((total + 1e-12) / SIM_DT);
      SIM.advanceCarry = total - steps * SIM_DT;
      for (let i = 0; i < steps; i += 1) simStep(SIM, SIM_DT);
      const model = simBuildModel(SIM, state);
      updateSceneFromModel(model);
      UI.refreshTelemetry(model);
      if (UI.syncSimControls) UI.syncSimControls();
      return window.FSApp.getSnapshot();
    },
    openModel: UI.openModelModal,
    closeModel: UI.closeModelModal,
    getSceneProbe: () => ({
      springs: (CAR.springs || []).map((spring) => spring.lastA.distanceTo(spring.lastB)),
      wireLengths: SIM && SIM.reference && SIM.reference.suspension
        ? SIM.reference.suspension.design.map((row) => row.length0)
        : [],
      rockerAngles: (CAR.corners || []).map((corner) => corner.angle),
      wheelPos: (CAR.corners || []).map((corner) => (corner.wheelRoot ? corner.wheelRoot.position.toArray() : null)),
      rackShiftMm: CAR.diag.rackTravelMm,
      stretch: {
        susp: CAR.diag.maxSuspLinkStretchMm,
        tie: CAR.diag.tieRodStretchMm,
        push: CAR.diag.pushRodStretchMm,
        arb: CAR.diag.arbStretchMm
      },
      solverOk: CAR.diag.rockerSolveOk,
      geometryRevision: CAR.geometryRevision || null,
      physicsRevision: SIM && SIM.reference ? SIM.reference.geometryRevision : null,
      geometryMismatch: Boolean(CAR.diag.geometryMismatch)
    }),
    runSelfTests: () => runSelfTests(state),
    runDynamicSelfTests: () => runDynamicSelfTests(state),
    dispose: teardownScene,
    getAssetStats: () => ({
      totals: CAR.assets ? Object.assign({}, CAR.assets.totals) : null,
      lastBuild: CAR.assets && CAR.assets.lastBuild ? Object.assign({}, CAR.assets.lastBuild) : null,
      lastTeardown: CAR.assets && CAR.assets.lastTeardown ? Object.assign({}, CAR.assets.lastTeardown) : null,
      renderer: S.renderer ? { geometries: S.renderer.info.memory.geometries, textures: S.renderer.info.memory.textures, programs: S.renderer.info.programs ? S.renderer.info.programs.length : 0 } : null
    }),
    exportScreenshot,
    setCameraPreset,
    setCameraProjection
  };
}

function animate(now) {
  // requestAnimationFrame timestamps are monotonic frame-clock values, but the
  // first callback may carry a timestamp from before the expensive boot. Never
  // seed the frame clock with performance.now(), and clamp anomalous deltas.
  const frameDt = lastFrameTime ? Math.max(0, (now - lastFrameTime) / 1000) : 0;
  lastFrameTime = now;

  UI.frameCount = (UI.frameCount || 0) + 1;
  updateCamera(Math.min(frameDt, 0.05));
  processPendingRebuild(now);

  if (booted && SIM) {
    const steps = simAdvance(SIM, frameDt);
    if (steps > 0 || !UI.lastDynamicUpdate) {
      const model = simBuildModel(SIM, state);
      updateSceneFromModel(model);
      UI.lastDynamicUpdate = now;
      if (!UI.lastTelemetryAt || now - UI.lastTelemetryAt > 110) {
        UI.lastTelemetryAt = now;
        UI.refreshTelemetry(model);
      }
    }
  }

  // Camera and scene matrices are current before projecting the DOM labels.
  S.scene.updateMatrixWorld(false);
  if (UI.initialized) UI.updateLabelPositions();

  S.renderer.render(S.scene, S.camera);

  if (!firstFrameRendered) {
    firstFrameRendered = true;
    const wait = Math.max(0, 480 - (now - loaderShownAt));
    window.setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) loading.classList.add('is-done');
      document.documentElement.dataset.fsReady = '1';
      if (window.FSApp) window.FSApp.ready = true;
    }, wait);
  }

  requestAnimationFrame(animate);
}

function boot() {
  if (booted) return;
  try {
    loaderShownAt = performance.now();
    const restored = loadPersistedState();
    if (restored) Object.assign(state, restored);

    initScene();
    SIM = simCreate(state, { settle: 1.8 });
    stampReference(SIM, state);
    SIM.rackShift = calibrateRack(SIM, state.steer);
    const initialModel = simBuildModel(SIM, state);
    S.roadGroup.quaternion.copy(initialModel.frame.q);
    S.roadGroup.updateMatrixWorld(true);
    buildCar(initialModel);
    updateSceneFromModel(initialModel);

    initUI();
    UI.refreshTelemetry(initialModel);
    UI.refreshSelfTests({ dynamic: false });
    syncControlsFromState();
    persistState();
    bindGlobalAPI();
    window.addEventListener('pagehide', () => {
      if (typeof teardownScene === 'function') teardownScene();
    }, { once: true });

    booted = true;
    lastFrameTime = 0;
    requestAnimationFrame(animate);

    console.info('[FS-01] stage 02 dynamic chassis v' + APP_VERSION + ' ready');
  } catch (error) {
    showFatalError(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
