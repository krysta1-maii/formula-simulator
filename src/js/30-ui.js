/* =========================================================================
   30-ui.js — controls, telemetry, annotations, panels and interaction
   ========================================================================= */

const UI = {
  initialized: false,
  lastModel: null,
  selfTests: [],
  selfTestCache: {
    revision: 0,
    staticTests: null,
    dynamicTests: null,
    dynamicRevision: 0,
    dynamicSetupRevision: 0,
    dynamicRunning: false,
    dynamicJob: null,
    dynamicToken: 0,
    runs: { static: 0, dynamic: 0 }
  },
  checkRows: {},
  toastTimer: 0,
  labelLayer: null,
  cornerLabels: [],
  cgLabel: null,
  projLabel: null,
  partLabels: [],
  inspectIndex: -1,
  elements: {},
  modalReturnFocus: null,
  modalInert: null,
  solverState: 'ok',
  listeners: [],
  mediaListeners: [],
  modalFocusTimer: 0,
  resizeTimer: 0,
  disposed: false
};

const PANEL_TABINDEX = new WeakMap();

const SETUP_KEYS = ['mass', 'frontWeightPct', 'cgHeight', 'cgLateral', 'wheelbase', 'trackFront', 'trackRear', 'wheelRadius', 'tireWidthF', 'tireWidthR', 'wheelRateF', 'wheelRateR', 'dampingF', 'dampingR', 'arbFront', 'arbRear', 'slope', 'bank', 'friction'];
let SETUP_REVISION = 0;
let SETUP_SIGNATURE = '';

function setupSignature(source = state) {
  return SETUP_KEYS.map((key) => Number(source[key]).toPrecision(10)).join('|');
}

function noteSetupChange(source = state) {
  const signature = setupSignature(source);
  if (signature !== SETUP_SIGNATURE) {
    SETUP_SIGNATURE = signature;
    SETUP_REVISION += 1;
  }
  return SETUP_REVISION;
}

const INSPECT_VIEWS = [
  { preset: 'inspectSteering', label: '转向', toast: '转向机、转向拉杆与转向柱' },
  { preset: 'inspectDrivetrain', label: '传动', toast: '差速器与后轮半轴' },
  { preset: 'inspectArb', label: '前防倾杆', toast: '前防倾杆：横向扭杆、叶片臂与连接杆' },
  { preset: 'inspectArbRear', label: '后防倾杆', toast: '后防倾杆：横向扭杆、杠杆臂与连接杆' }
];

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
const _partWorld = new THREE.Vector3();

function listenUI(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  UI.listeners.push({ target, type, handler, options });
}

function listenUIMedia(query, handler) {
  if (query.addEventListener) query.addEventListener('change', handler);
  else if (query.addListener) query.addListener(handler);
  UI.mediaListeners.push({ query, handler });
}

function formatOutputValue(param, value) {
  switch (param) {
    case 'slope':
    case 'bank':
    case 'steer':
      return (Math.abs(value) < 0.05 ? '0.0' : formatSigned(value, 1)) + '°';
    case 'friction':
      return Number(value).toFixed(2);
    case 'mass':
      return formatInt(value) + ' kg';
    case 'frontWeightPct':
      return Number(value).toFixed(1) + '%';
    case 'cgHeight':
    case 'wheelbase':
    case 'trackFront':
    case 'trackRear':
    case 'wheelRadius':
      return Number(value).toFixed(3) + ' m';
    case 'cgLateral':
      return formatSigned(value, 3) + ' m';
    case 'wheelRateF':
    case 'wheelRateR':
      return formatInt(value) + ' N/mm';
    case 'dampingF':
    case 'dampingR':
      return Number(value).toFixed(2) + ' ζ';
    case 'arbFront':
    case 'arbRear':
      return formatInt(value) + '%';
    default:
      return String(value);
  }
}

function refreshSliderFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return;
  const percent = clamp(((value - min) / (max - min)) * 100, 0, 100);
  input.style.setProperty('--fill', percent.toFixed(2) + '%');
}

function syncParamOutput(param) {
  const input = document.querySelector(`[data-param="${param}"]`);
  if (!input) return;
  const outputId = param + 'Out';
  const output = document.getElementById(outputId);
  if (output) output.textContent = formatOutputValue(param, state[param]);
  if (input.type === 'range') {
    input.value = state[param];
    refreshSliderFill(input);
    input.setAttribute('aria-valuetext', formatOutputValue(param, state[param]));
  } else if (input.type === 'checkbox') {
    input.checked = Boolean(state[param]);
  }
}

function syncControlsFromState() {
  $$('[data-param]').forEach((input) => {
    const param = input.dataset.param;
    if (!(param in state)) return;
    if (input.type === 'range') {
      input.value = state[param];
      refreshSliderFill(input);
    } else if (input.type === 'checkbox') {
      input.checked = Boolean(state[param]);
    }
    const output = document.getElementById(param + 'Out');
    if (output) output.textContent = formatOutputValue(param, state[param]);
    if (input.type === 'range') input.setAttribute('aria-valuetext', formatOutputValue(param, state[param]));
  });
  $$('.unit-toggle button').forEach((button) => {
    const selected = button.dataset.units === state.units;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const xrayButton = document.getElementById('btnXray');
  if (xrayButton) {
    xrayButton.classList.toggle('is-active', Boolean(state.xray));
    xrayButton.setAttribute('aria-pressed', String(Boolean(state.xray)));
  }
  updateRoadChips();
}

function roadPresetTable() {
  return {
    level: { slope: 0, bank: 0 },
    slope: { slope: 8, bank: 0 },
    bank: { slope: 0, bank: 7 },
    mixed: { slope: 6, bank: 5 },
    lowGrip: { slope: 10, bank: 10, friction: 0.2 }
  };
}

function updateRoadChips() {
  const presets = roadPresetTable();
  $$('[data-road-preset]').forEach((button) => {
    const target = presets[button.dataset.roadPreset];
    const matches = target &&
      Math.abs(state.slope - target.slope) < 0.001 &&
      Math.abs(state.bank - target.bank) < 0.001 &&
      (target.friction == null || Math.abs(state.friction - target.friction) < 0.001);
    button.classList.toggle('is-active', Boolean(matches));
    button.setAttribute('aria-pressed', String(Boolean(matches)));
  });
}

function applyRoadPreset(name) {
  const target = roadPresetTable()[name];
  if (!target) return;
  Object.assign(state, target);
  syncParamOutput('slope');
  syncParamOutput('bank');
  if (target.friction != null) syncParamOutput('friction');
  updateRoadChips();
  persistState();
  refreshAll({ rebuild: false });
}

function applyUnit(unit) {
  if (unit !== 'N' && unit !== 'kg') return;
  state.units = unit;
  $$('.unit-toggle button').forEach((button) => {
    const selected = button.dataset.units === unit;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  persistState();
  refreshAll({ rebuild: false });
}

function applyStateChange(param, value, { rebuild = false } = {}) {
  state[param] = value;
  syncParamOutput(param);
  updateRoadChips();
  persistState();
  refreshAll({ rebuild });
}

function setXray(enabled) {
  state.xray = Boolean(enabled);
  const checkbox = document.getElementById('xray');
  if (checkbox) checkbox.checked = state.xray;
  const button = document.getElementById('btnXray');
  if (button) {
    button.classList.toggle('is-active', state.xray);
    button.setAttribute('aria-pressed', String(state.xray));
  }
  persistState();
  applyXray();
  refreshAll({ rebuild: false });
}

function setAutoRotate(enabled) {
  if (enabled && REDUCED_MOTION) {
    showToast('系统已开启“减少动态效果”，环绕动画保持关闭');
    autoRotate = false;
  } else {
    autoRotate = Boolean(enabled);
  }
  if (autoRotate) clearCameraPreset();
  const button = document.getElementById('btnAutoRotate');
  if (button) {
    button.classList.toggle('is-active', autoRotate);
    button.setAttribute('aria-pressed', String(autoRotate));
  }
}

function simulationReset({ settle = 0, toast = '姿态已重置到平衡位置' } = {}) {
  if (!SIM) SIM = simCreate(state);
  if (SIM.geometryRevision !== geometryRevisionFor(state)) {
    refreshAll({ rebuild: true, reason: 'geometry' });
    if (toast) showToast('几何参数已变化，重建完成后再重置');
    return;
  }
  simReset(SIM, state, { settle });
  SIM.running = true;
  const model = simBuildModel(SIM, state);
  updateSceneFromModel(model);
  refreshTelemetry(model);
  syncSimControls(model);
  if (toast) showToast(toast);
}

function simulationToggle() {
  if (!SIM) SIM = simCreate(state);
  SIM.running = !SIM.running;
  syncSimControls(UI.lastModel);
  showToast(SIM.running ? '动力学仿真继续' : '动力学仿真已暂停');
}

function simulationImpulse(kind) {
  if (!SIM) SIM = simCreate(state);
  const labels = { heave: '垂向脉冲', roll: '侧倾脉冲', pitch: '俯仰脉冲' };
  if (!simApplyImpulse(SIM, kind)) return;
  syncSimControls(UI.lastModel);
  showToast(`已施加${labels[kind] || '脉冲'}，观察弹簧—阻尼器响应`);
}

function resetAll() {
  copyDefaults();
  autoRotate = false;
  if (SIM) {
    SIM.running = true;
  }
  syncControlsFromState();
  setAutoRotate(false);
  applyXray();
  persistState();
  resetCamera(false);
  resetInspectButton();
  refreshAll({ rebuild: true, reason: 'reset' });
  showToast('已恢复默认标定与相机');
}

function buildConfigPayload() {
  const model = UI.lastModel;
  return {
    app: 'FS-01 Formula Simulator',
    version: APP_VERSION,
    stage: 'dynamic-rig-stage-2',
    exportedAt: new Date().toISOString(),
    setup: cloneState(state),
    summary: model ? {
      totalNormalN: Number(model.sumLoads.toFixed(3)),
      cornerLoadsN: model.loads.map((value) => Number(value.toFixed(3))),
      planeBetaDeg: Number(model.frame.betaDeg.toFixed(4)),
      frictionDemand: Number(model.frictionDemand.toFixed(4)),
      bodyPitchDeg: Number(model.poseDeg.pitch.toFixed(5)),
      bodyRollDeg: Number(model.poseDeg.roll.toFixed(5)),
      bodyYawDeg: Number(model.poseDeg.yaw.toFixed(5)),
      heaveMm: Number((model.heave * 1000).toFixed(4)),
      travelMm: model.travelMm.map((value) => Number(value.toFixed(4))),
      bodyVelocity: model.bodyVelocity ? {
        x: Number(model.bodyVelocity.x.toFixed(5)),
        y: Number(model.bodyVelocity.y.toFixed(5)),
        z: Number(model.bodyVelocity.z.toFixed(5))
      } : null,
      inertia: model.inertia ? {
        Ixx: Number(model.inertia.Ixx.toFixed(3)),
        Iyy: Number(model.inertia.Iyy.toFixed(3)),
        Izz: Number(model.inertia.Izz.toFixed(3))
      } : null,
      frequenciesHz: model.frequencies ? {
        heave: Number(model.frequencies.heave.toFixed(4)),
        roll: Number(model.frequencies.roll.toFixed(4)),
        pitch: Number(model.frequencies.pitch.toFixed(4))
      } : null,
      sim: model.sim ? {
        timeS: Number(model.sim.time.toFixed(4)),
        running: model.sim.running,
        holding: model.sim.holding,
        sliding: model.sim.sliding,
        stepHz: model.sim.stepHz
      } : null,
      arbFrontRateNPerM: Number(model.arbRate.front.toFixed(3)),
      arbRearRateNPerM: Number(model.arbRate.rear.toFixed(3)),
      arbTwistDeg: Number((getCarDiagnostics().arbTwistDeg || 0).toFixed(4))
    } : null
  };
}

async function copyConfig() {
  const text = JSON.stringify(buildConfigPayload(), null, 2);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_error) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (_second) {
      ok = false;
    }
  }
  showToast(ok ? '当前参数已复制为 JSON' : '浏览器未允许剪贴板访问，可改用截图');
}

function showToast(message) {
  if (UI.disposed) return;
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(UI.toastTimer);
  UI.toastTimer = window.setTimeout(() => {
    UI.toastTimer = 0;
    if (!UI.disposed) toast.classList.remove('is-visible');
  }, 2400);
}

function isCompact() {
  return window.innerWidth <= 980;
}

function setPanelInert(panel, inert) {
  if (!panel) return;
  if ('inert' in panel) {
    panel.inert = inert;
  } else if (inert) {
    const saved = [];
    $$('button, [href], input, select, textarea, summary, [tabindex]', panel).forEach((element) => {
      saved.push([element, element.getAttribute('tabindex')]);
      element.setAttribute('tabindex', '-1');
    });
    PANEL_TABINDEX.set(panel, saved);
  } else {
    const saved = PANEL_TABINDEX.get(panel) || [];
    saved.forEach(([element, value]) => {
      if (value === null) element.removeAttribute('tabindex');
      else element.setAttribute('tabindex', value);
    });
    PANEL_TABINDEX.delete(panel);
  }
  if (inert) panel.setAttribute('aria-hidden', 'true');
  else panel.removeAttribute('aria-hidden');
}

function modalFocusables(modal) {
  return $$('button, [href], input, select, textarea, summary, [tabindex]', modal).filter((element) => {
    if (element.disabled) return false;
    if (element.getAttribute('tabindex') === '-1') return false;
    if (element.closest('[inert]')) return false;
    return element.offsetParent !== null;
  });
}

function setModalBackgroundInert() {
  if (UI.modalInert) return;
  UI.modalInert = new Map();
  $$('#viewport, .topbar, .panel, .bottom-bar, .viewport-hint, #mobileScrim').forEach((element) => {
    UI.modalInert.set(element, element.inert);
    element.inert = true;
  });
}

function restoreModalBackgroundInert() {
  if (!UI.modalInert) return;
  UI.modalInert.forEach((value, element) => {
    element.inert = value;
  });
  UI.modalInert = null;
}

function trapModalFocus(event) {
  const modal = document.getElementById('modelModal');
  if (!modal || modal.hidden) return;
  const items = modalFocusables(modal);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    last.focus();
    event.preventDefault();
  } else if (!event.shiftKey && document.activeElement === last) {
    first.focus();
    event.preventDefault();
  }
}

function updatePanelUI() {
  const left = document.getElementById('panelControls');
  const right = document.getElementById('panelTelemetry');
  const leftOpen = left && left.classList.contains('is-open');
  const rightOpen = right && right.classList.contains('is-open');
  const leftButton = document.getElementById('btnToggleControls');
  const rightButton = document.getElementById('btnToggleTelemetry');
  if (leftButton) {
    leftButton.classList.toggle('is-active', Boolean(leftOpen));
    leftButton.setAttribute('aria-expanded', String(Boolean(leftOpen)));
  }
  if (rightButton) {
    rightButton.classList.toggle('is-active', Boolean(rightOpen));
    rightButton.setAttribute('aria-expanded', String(Boolean(rightOpen)));
  }
  const scrim = document.getElementById('mobileScrim');
  if (scrim) scrim.hidden = !(isCompact() && (leftOpen || rightOpen));
}

function setPanel(panelId, open, { exclusive = false } = {}) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  if (open && exclusive) {
    const otherId = panelId === 'panelControls' ? 'panelTelemetry' : 'panelControls';
    const other = document.getElementById(otherId);
    if (other) {
      other.classList.remove('is-open');
      setPanelInert(other, true);
    }
  }
  if (!open && panel.contains(document.activeElement)) {
    const toggleId = panelId === 'panelControls' ? 'btnToggleControls' : 'btnToggleTelemetry';
    const toggle = document.getElementById(toggleId);
    if (toggle) toggle.focus({ preventScroll: true });
  }
  panel.classList.toggle('is-open', open);
  setPanelInert(panel, !open);
  updatePanelUI();
  if (S.initialized && !UI.disposed) resizeScene();
}

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const open = !panel.classList.contains('is-open');
  setPanel(panelId, open, { exclusive: isCompact() });
}

function openModelModal() {
  if (UI.disposed) return;
  const modal = document.getElementById('modelModal');
  if (!modal) return;
  UI.modalReturnFocus = document.activeElement;
  modal.hidden = false;
  setModalBackgroundInert();
  document.body.classList.add('modal-open');
  refreshSelfTests();
  window.clearTimeout(UI.modalFocusTimer);
  UI.modalFocusTimer = window.setTimeout(() => {
    UI.modalFocusTimer = 0;
    if (UI.disposed || modal.hidden) return;
    const items = modalFocusables(modal);
    const target = modal.querySelector('button[data-close-modal]') || items[0];
    if (target) target.focus();
  }, 20);
}

function closeModelModal() {
  const modal = document.getElementById('modelModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  restoreModalBackgroundInert();
  if (UI.modalReturnFocus && typeof UI.modalReturnFocus.focus === 'function') {
    UI.modalReturnFocus.focus();
  }
}

function cancelDynamicSelfTests() {
  const cache = UI.selfTestCache;
  cache.dynamicToken += 1;
  if (cache.dynamicJob) cache.dynamicJob.cancel();
  cache.dynamicJob = null;
  cache.dynamicRunning = false;
  cache.dynamicTests = null;
  cache.dynamicRevision = 0;
  UI.dynamicTests = [];
}

function startDynamicSelfTestJob(setup, { isCurrent, onDone, onDiscard }) {
  const iterator = simDynamicSelfTestSteps(setup);
  const tests = [];
  let timer = 0;
  let stopped = false;
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    if (typeof iterator.return === 'function') iterator.return();
  };
  const discard = () => {
    cancel();
    if (onDiscard) onDiscard();
  };
  const pump = () => {
    timer = 0;
    if (stopped) return;
    if (!isCurrent()) {
      discard();
      return;
    }
    const startedAt = performance.now();
    while (!stopped) {
      if (!isCurrent()) {
        discard();
        return;
      }
      const step = iterator.next();
      if (step.done) {
        stopped = true;
        if (onDone) onDone(step.value || tests);
        return;
      }
      tests.push(step.value);
      if (performance.now() - startedAt >= 50) {
        timer = window.setTimeout(pump, 0);
        return;
      }
    }
  };
  pump();
  return { cancel };
}

function ensureStaticSelfTests({ force = false } = {}) {
  const revision = noteSetupChange(state);
  if (force || UI.selfTestCache.revision !== revision || !UI.selfTestCache.staticTests) {
    UI.selfTestCache.staticTests = runSelfTests(state);
    UI.selfTestCache.revision = revision;
    UI.selfTestCache.runs.static += 1;
    if (UI.selfTestCache.dynamicRevision !== revision || UI.selfTestCache.dynamicRunning) {
      cancelDynamicSelfTests();
    }
  }
  UI.selfTests = UI.selfTestCache.staticTests;
  return UI.selfTests;
}

function ensureDynamicSelfTests({ force = false, onDone = null } = {}) {
  if (UI.disposed) return null;
  const cache = UI.selfTestCache;
  const revision = noteSetupChange(state);
  if (!force && cache.dynamicTests && cache.dynamicRevision === revision) {
    if (onDone) onDone(cache.dynamicTests);
    return cache.dynamicTests;
  }
  if (!force && cache.dynamicRunning && cache.dynamicJob && cache.dynamicJob.revision === revision) return null;
  if (cache.dynamicJob || cache.dynamicTests) cancelDynamicSelfTests();
  const setup = cloneState(state);
  const startedRevision = revision;
  const token = cache.dynamicToken + 1;
  cache.dynamicToken = token;
  cache.dynamicRunning = true;
  cache.dynamicSetupRevision = startedRevision;
  cache.dynamicTests = null;
  cache.dynamicRevision = 0;
  UI.dynamicTests = [];
  const isCurrent = () => !UI.disposed && cache.dynamicToken === token && noteSetupChange(state) === startedRevision;
  const discard = () => {
    if (cache.dynamicToken !== token) return;
    cache.dynamicJob = null;
    cache.dynamicRunning = false;
    cache.dynamicTests = null;
    cache.dynamicRevision = 0;
    UI.dynamicTests = [];
  };
  const job = startDynamicSelfTestJob(setup, {
    isCurrent,
    onDiscard: discard,
    onDone: (tests) => {
      if (!isCurrent()) {
        discard();
        return;
      }
      cache.dynamicJob = null;
      cache.dynamicRunning = false;
      cache.dynamicTests = tests;
      cache.dynamicRevision = startedRevision;
      cache.runs.dynamic += 1;
      UI.dynamicTests = tests;
      if (onDone) onDone(tests);
      refreshSelfTests({ dynamic: false });
    }
  });
  job.revision = startedRevision;
  if (cache.dynamicRunning && cache.dynamicToken === token) cache.dynamicJob = job;
  return null;
}

function refreshSelfTests({ dynamic = true, force = false } = {}) {
  if (UI.disposed) return UI.selfTests;
  const staticTests = ensureStaticSelfTests({ force });
  if (dynamic && (force || !UI.selfTestCache.dynamicTests || UI.selfTestCache.dynamicRevision !== UI.selfTestCache.revision)) {
    ensureDynamicSelfTests({ force, onDone: () => refreshSelfTests({ dynamic: false }) });
  }
  const dynamicTests = UI.selfTestCache.dynamicTests || [];
  UI.dynamicTests = dynamicTests;
  const tests = staticTests.concat(dynamicTests);
  const passed = tests.filter((test) => test.ok).length;
  const total = tests.length;

  const dynamicState = dynamicTests.length
    ? `动态 ${dynamicTests.filter((test) => test.ok).length} / ${dynamicTests.length}`
    : (UI.selfTestCache.dynamicRunning ? '动态运行中' : '动态待运行');
  const rightStatus = document.getElementById('selfTestStatus');
  if (rightStatus) rightStatus.textContent = `静力 ${staticTests.filter((test) => test.ok).length} / ${staticTests.length} · ${dynamicState}`;

  const solverState = UI.lastModel ? solverStateOf(UI.lastModel) : 'ok';
  const solverWarn = solverState !== 'ok';
  const solverText = solverState === 'failed' ? '求解失败' : solverState === 'degraded' ? '求解降级' : '求解正常';
  const summary = document.getElementById('selfTestSummary');
  if (summary) {
    summary.textContent = `${passed} / ${total} 项通过 · 静态 ${staticTests.length} / ${dynamicState}${solverWarn ? ' · ' + solverText : ''}`;
    summary.style.color = passed === total && !solverWarn && dynamicTests.length ? 'var(--ok)' : 'var(--warn)';
  }

  const list = document.getElementById('selfTestList');
  if (list) {
    list.textContent = '';
    const labelled = staticTests.map((test) => ({ ...test, group: '静态' }))
      .concat(dynamicTests.map((test) => ({ ...test, group: '动态' })));
    labelled.forEach((test) => {
      const item = document.createElement('li');
      if (!test.ok) item.className = 'is-fail';
      const mark = document.createElement('span');
      mark.className = 'st-mark';
      mark.textContent = test.ok ? '✓' : '!';
      const name = document.createElement('span');
      name.textContent = test.group + ' · ' + test.name;
      const detail = document.createElement('span');
      detail.className = 'st-detail';
      detail.textContent = test.detail;
      item.append(mark, name, detail);
      list.appendChild(item);
    });
  }

  if (UI.lastModel) refreshChecks(UI.lastModel);
}

/* ------------------------------ annotations ------------------------------ */

function createAnnotationLabels() {
  UI.labelLayer = document.getElementById('labelLayer');
  if (!UI.labelLayer) return;
  UI.labelLayer.textContent = '';

  UI.cornerLabels = CORNERS.map((corner) => {
    const element = document.createElement('div');
    element.className = 'scene-label load-label';
    element.innerHTML = `<span class="sl-code">${corner.key}</span><span class="sl-val">—</span><span class="sl-unit">N</span>`;
    UI.labelLayer.appendChild(element);
    return { key: corner.key, element, value: element.querySelector('.sl-val'), unit: element.querySelector('.sl-unit') };
  });

  UI.cgLabel = document.createElement('div');
  UI.cgLabel.className = 'scene-label cg-label';
  UI.cgLabel.innerHTML = '<span class="sl-code">CG</span><span class="sl-val">0.300 m</span>';
  UI.labelLayer.appendChild(UI.cgLabel);

  UI.projLabel = document.createElement('div');
  UI.projLabel.className = 'scene-label proj-label';
  UI.projLabel.innerHTML = '<span class="sl-code">CG′</span>';
  UI.labelLayer.appendChild(UI.projLabel);

  const partSpecs = [
    { code: 'STEER', text: '转向机 / 拉杆', offset: -150, offsetX: 70, anchor: () => CAR.mechanics.steeringPoint },
    { code: 'COLUMN', text: '转向柱', offset: -260, offsetX: 40, anchor: () => CAR.mechanics.columnPoint },
    { code: 'DRIVE', text: '差速器 / 半轴', offset: -150, offsetX: 80, anchor: () => CAR.mechanics.diffPoint },
    { code: 'ARB-F', text: '前防倾杆', offset: -160, offsetX: -90, anchor: () => CAR.mechanics.arbPoints.front },
    { code: 'ARB-R', text: '后防倾杆', offset: -160, offsetX: -70, anchor: () => CAR.mechanics.arbPoints.rear }
  ];
  UI.partLabels = partSpecs.map((spec) => {
    const element = document.createElement('div');
    element.className = 'scene-label part-label is-hidden';
    element.innerHTML = `<span class="sl-code">${spec.code}</span><span class="sl-text">${spec.text}</span>`;
    UI.labelLayer.appendChild(element);
    return { element, anchor: spec.anchor, offset: spec.offset, offsetX: spec.offsetX || 0 };
  });
}

function refreshLabelContent(model) {
  const units = state.units;
  const unit = loadUnitLabel(units);
  if (!model || !UI.cornerLabels.length) return;
  UI.cornerLabels.forEach((label, index) => {
    label.value.textContent = formatLoadValue(model.loads[index], units);
    label.unit.textContent = unit;
  });
  if (UI.cgLabel) {
    UI.cgLabel.innerHTML = `<span class="sl-code">CG</span><span class="sl-val">${Number(state.cgHeight).toFixed(3)} m</span>`;
  }
}

function updateLabelPositions() {
  if (!UI.cornerLabels.length || !S.initialized) return;
  const showLoadLabels = Boolean(state.showLoads && state.showLabels);
  const anchors = S.labelAnchors || [];
  const safe = cameraSafeArea();
  for (let i = 0; i < UI.cornerLabels.length; i += 1) {
    const label = UI.cornerLabels[i];
    const anchor = anchors[i];
    if (!showLoadLabels || !anchor) {
      label.element.classList.add('is-hidden');
      continue;
    }
    const projected = projectWorld(anchor.world);
    if (!projected.visible) {
      label.element.classList.add('is-hidden');
      continue;
    }
    label.element.classList.remove('is-hidden');
    const halfWidth = label.element.offsetWidth / 2;
    const halfHeight = label.element.offsetHeight / 2;
    const x = clamp(projected.x, safe.left + halfWidth + 3, safe.right - halfWidth - 3);
    const y = clamp(projected.y, safe.top + halfHeight + 3, safe.bottom - halfHeight - 3);
    label.element.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  if (UI.cgLabel) {
    if (!state.showCG || !S.cgWorld) {
      UI.cgLabel.classList.add('is-hidden');
    } else {
      const projected = projectWorld(S.cgWorld);
      if (projected.visible) {
        UI.cgLabel.classList.remove('is-hidden');
        UI.cgLabel.style.transform = `translate(-50%, -115%) translate(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px)`;
      } else {
        UI.cgLabel.classList.add('is-hidden');
      }
    }
  }

  if (UI.projLabel) {
    if (!state.showCG || !S.projWorld) {
      UI.projLabel.classList.add('is-hidden');
    } else {
      const projected = projectWorld(S.projWorld);
      if (projected.visible) {
        UI.projLabel.classList.remove('is-hidden');
        UI.projLabel.style.transform = `translate(-50%, 10%) translate(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px)`;
      } else {
        UI.projLabel.classList.add('is-hidden');
      }
    }
  }

  const showParts = Boolean(state.xray && state.showParts);
  UI.partLabels.forEach((label) => {
    if (!showParts) {
      label.element.classList.add('is-hidden');
      return;
    }
    const anchor = label.anchor();
    if (!anchor) {
      label.element.classList.add('is-hidden');
      return;
    }
    _partWorld.copy(anchor).applyMatrix4(S.bodyPivot.matrixWorld);
    const projected = projectWorld(_partWorld);
    if (!projected.visible) {
      label.element.classList.add('is-hidden');
      return;
    }
    label.element.classList.remove('is-hidden');
    const halfWidth = label.element.offsetWidth / 2;
    const x = clamp(projected.x + label.offsetX, safe.left + halfWidth + 3, safe.right - halfWidth - 3).toFixed(1);
    label.element.style.transform = `translate(-50%, ${label.offset}%) translate(${x}px, ${projected.y.toFixed(1)}px)`;
  });
}

/* ------------------------------ telemetry ------------------------------ */

function loadDisplay(value) {
  return formatLoadValue(value, state.units);
}

function unitDisplay() {
  return loadUnitLabel(state.units);
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function setNodeText(element, text) {
  if (!element) return;
  const first = element.firstChild;
  if (first && first.nodeType === 3) {
    if (first.nodeValue !== text) first.nodeValue = text;
    return;
  }
  element.textContent = text;
}

function solverStateOf(model) {
  const sim = model && model.sim;
  if (sim && sim.solverFailed) return 'failed';
  if (sim && sim.solverDegraded) return 'degraded';
  if (model && model.solverOk === true) return 'ok';
  if (sim) return 'failed';
  return 'ok';
}

function refreshSolverBadge(model) {
  const state = solverStateOf(model);
  if (UI.solverState === state) return;
  UI.solverState = state;
  const badge = document.getElementById('solverBadge');
  if (!badge) return;
  badge.dataset.state = state;
  if (state === 'ok') {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = state === 'degraded' ? '求解降级' : '求解失败';
}

function refreshChecks(model) {
  const container = document.getElementById('checkList');
  if (!container || !model) return;
  const diag = getCarDiagnostics();
  const tests = UI.selfTests || [];
  const dynamicTests = (UI.selfTestCache && UI.selfTestCache.dynamicTests) || UI.dynamicTests || [];
  const passed = tests.filter((test) => test.ok).length;
  const dynamicPassed = dynamicTests.filter((test) => test.ok).length;
  const fallbackSim = {
    time: 0, running: true, holding: true, sliding: false, finite: true,
    recovered: false, stepHz: 500, substeps: 0, backlog: 0, droppedTime: 0, timeScale: 1
  };
  const sim = model.sim || fallbackSim;
  const linksOk = diag.linkCount > 0 && diag.maxSuspLinkStretchMm < 1 && diag.rockerSolveOk;
  const steerOk = diag.tieRodStretchMm < 5 && diag.rockerSolveOk;
  const arbOk = diag.arbCount === 2 && diag.arbFront && diag.arbRear && diag.arbStretchMm < 0.5;
  const contactOk = model.contactOk;
  const frictionOk = model.frictionDemand <= model.frictionCapacity + 1e-9;
  const testsOk = tests.length > 0 && passed === tests.length;
  const dynamicOk = dynamicTests.length > 0 && dynamicPassed === dynamicTests.length;
  const frictionState = sim.sliding ? '滑移' : sim.holding ? '静摩擦' : '—';
  const timeScale = Number.isFinite(sim.timeScale) ? sim.timeScale : 1;
  const dropped = Number.isFinite(sim.droppedTime) ? sim.droppedTime : 0;
  const solverState = solverStateOf(model);
  const solverOk = model.solverOk === true;
  const residuals = Array.isArray(model.rockerResidualMm) ? model.rockerResidualMm : [];
  const feasible = Array.isArray(model.rockerFeasible) ? model.rockerFeasible : [];
  const residualMaxMm = residuals.length ? Math.max.apply(null, residuals) : NaN;
  const failedCorners = feasible.filter((value) => !value).length;
  const residualOk = feasible.length === 4 && feasible.every(Boolean) && Number.isFinite(residualMaxMm) && residualMaxMm < 0.1;
  const ratioStates = Array.isArray(model.motionRatioState) ? model.motionRatioState : [];
  const unavailableCorners = ratioStates.filter((value) => value !== 'ok').length;
  const motionOk = ratioStates.length === 4 && unavailableCorners === 0;
  const solverLabel = solverState === 'failed' ? '失败' : solverState === 'degraded' ? '降级' : '正常';

  const rows = [
    { id: 'sim', ok: sim.finite && !sim.recovered && solverOk, name: '六自由度积分与求解', value: `t ${sim.time.toFixed(2)} s · ${sim.stepHz} Hz · ${sim.substeps} 子步 · ${timeScale.toFixed(2)}× · 丢 ${dropped.toFixed(2)} s · 求解 ${solverLabel}` },
    { id: 'contact', ok: contactOk, name: '四轮接地', value: `${diag.contactCount} / 4 · 最小 ${loadDisplay(model.minLoad)} ${unitDisplay()}` },
    { id: 'links', ok: linksOk, name: '悬架杆长偏差', value: `${diag.linkCount} 根 / ${diag.jointCount} 点 · ${diag.maxSuspLinkStretchMm.toFixed(3)} mm` },
    { id: 'steer', ok: steerOk, name: '齿条 / 横拉杆', value: `齿条 ${formatSigned(diag.rackTravelMm, 1)} mm · 横拉杆 ${diag.tieRodStretchMm.toFixed(3)} mm` },
    { id: 'arb', ok: arbOk, name: '防倾杆连接', value: `${diag.arbCount} 套 · 扭转 ${diag.arbTwistDeg.toFixed(2)}° · 伸长 ${diag.arbStretchMm.toFixed(2)} mm` },
    { id: 'friction', ok: frictionOk, name: '坡面摩擦', value: `μ_req ${model.frictionDemand.toFixed(3)} / ${model.frictionCapacity.toFixed(2)} · ${frictionState}` },
    { id: 'rockerResidual', ok: residualOk, error: solverState === 'failed', name: '摇臂闭合残差', value: Number.isFinite(residualMaxMm) ? `${residualMaxMm.toFixed(3)} / 0.100 mm · 失败 ${failedCorners} 角` : '—' },
    { id: 'motionRatio', ok: motionOk, error: solverState === 'failed', name: '运动比连续性', value: ratioStates.length ? `不可用 ${unavailableCorners} 角 · 求解${solverLabel}` : '—' },
    { id: 'staticTests', ok: testsOk, name: '静力自检', value: tests.length ? `${passed} / ${tests.length} 通过` : '待运行' },
    { id: 'dynamicTests', ok: dynamicOk, name: '动态自检', value: dynamicTests.length ? `${dynamicPassed} / ${dynamicTests.length} 通过` : '待运行' }
  ];

  rows.forEach((row) => {
    const className = 'check-item ' + (row.ok ? 'is-ok' : row.error ? 'is-error' : 'is-warn');
    let cached = UI.checkRows[row.id];
    if (!cached || !cached.item || cached.item.parentNode !== container) {
      const item = document.createElement('div');
      item.className = className;
      item.dataset.checkId = row.id;
      const icon = document.createElement('span');
      icon.className = 'check-icon';
      icon.textContent = row.ok ? '✓' : '!';
      const name = document.createElement('span');
      name.className = 'check-name';
      name.textContent = row.name;
      const value = document.createElement('span');
      value.className = 'check-val';
      value.textContent = row.value;
      item.append(icon, name, value);
      container.appendChild(item);
      cached = { item, icon, name, value, ok: row.ok, className, text: row.name, valueText: row.value };
      UI.checkRows[row.id] = cached;
      return;
    }
    if (cached.className !== className) {
      cached.className = className;
      cached.ok = row.ok;
      cached.item.className = className;
      setNodeText(cached.icon, row.ok ? '✓' : '!');
    }
    if (cached.text !== row.name) {
      cached.text = row.name;
      setNodeText(cached.name, row.name);
    }
    if (cached.valueText !== row.value) {
      cached.valueText = row.value;
      setNodeText(cached.value, row.value);
    }
  });
}

function renderSimStatus(model = UI.lastModel) {
  const sim = model && model.sim ? model.sim : null;
  if (!sim && !SIM) {
    setText('simDetail', '静态参考');
    return;
  }
  const running = SIM ? SIM.running : sim ? sim.running : true;
  const time = SIM ? SIM.time : sim ? sim.time : 0;
  const sliding = SIM ? SIM.flags.sliding : Boolean(sim && sim.sliding);
  const holding = SIM ? SIM.flags.holding : Boolean(sim && sim.holding);
  const stateText = sliding ? '切向滑移' : holding ? '静摩擦保持' : '瞬态';
  const backlogMs = (Number.isFinite(sim && sim.backlog) ? sim.backlog : (Number.isFinite(sim && sim.accumulator) ? sim.accumulator : 0)) * 1000;
  const dropped = Number.isFinite(sim && sim.droppedTime) ? sim.droppedTime : 0;
  const stepHz = sim && sim.stepHz ? sim.stepHz : Math.round(1 / SIM_DT);
  setText('simDetail', `${running ? '运行' : '暂停'} · t ${time.toFixed(2)} s · ${stepHz} Hz · ${stateText} · 积压 ${backlogMs.toFixed(1)} ms · 丢 ${dropped.toFixed(2)} s`);
}

function syncSimControls(model = UI.lastModel) {
  const sim = model && model.sim ? model.sim : null;
  const running = SIM ? SIM.running : sim ? sim.running : true;
  const simTime = SIM ? SIM.time : sim ? sim.time : 0;
  const substeps = running ? (SIM ? SIM.lastSubsteps : sim ? sim.substeps : 0) : 0;
  const sliding = SIM ? SIM.flags.sliding : Boolean(sim && sim.sliding);
  setText('simStatus', running ? '运行' : '暂停');
  setText('simClock', `${simTime.toFixed(2)} s`);
  const toggle = document.getElementById('btnSimToggle');
  if (toggle) toggle.textContent = running ? '暂停' : '继续';
  const readout = document.querySelector('.sim-readout');
  if (readout) {
    readout.classList.toggle('is-paused', !running);
    readout.classList.toggle('is-sliding', sliding);
  }
  const telemetryReadout = document.querySelector('.sim-readout-telemetry');
  if (telemetryReadout) {
    telemetryReadout.classList.toggle('is-paused', !running);
    telemetryReadout.classList.toggle('is-sliding', sliding);
  }
  setText('telemetrySimState', sim || SIM ? (running ? '运行' : '暂停') : '静态');
  setText('telemetrySimTime', `${simTime.toFixed(2)} s`);
  const timeScale = SIM && Number.isFinite(SIM.timeScale) ? SIM.timeScale : (sim && Number.isFinite(sim.timeScale) ? sim.timeScale : 1);
  setText('telemetrySimSteps', sim || SIM ? `${sim ? sim.stepHz : Math.round(1 / SIM_DT)} Hz · ${substeps} 子步/帧 · ${timeScale.toFixed(2)}×` : '—');
  renderSimStatus(model);
}

function refreshTelemetry(model) {
  UI.lastModel = model;
  if (!model) return;
  ensureStaticSelfTests();
  const sim = model.sim || null;
  const loads = model.loads.slice();
  const sumLoads = loads.reduce((acc, value) => acc + value, 0);

  setText('topBeta', model.frame.betaDeg.toFixed(1) + '°');
  setText('topNormal', `${loadDisplay(sumLoads)} ${unitDisplay()}`);
  setText('topFrontShare', (model.frontShare * 100).toFixed(1) + '%');

  const maxLoad = Math.max(...loads, 1);
  const avgLoad = sumLoads / 4;
  CORNERS.forEach((corner, index) => {
    const load = loads[index];
    const levelLoad = model.levelLoads[index];
    const delta = load - levelLoad;
    const card = document.getElementById('corner' + corner.key);
    const value = document.getElementById('load' + corner.key);
    const sub = document.getElementById('massEq' + corner.key);
    const deltaEl = document.getElementById('delta' + corner.key);
    const bar = document.getElementById('bar' + corner.key);
    const unitLabel = card ? card.querySelector('[data-unit-label]') : null;

    if (value) value.textContent = loadDisplay(load);
    if (unitLabel) unitLabel.textContent = unitDisplay();
    if (sub) {
      sub.textContent = state.units === 'kg'
        ? `≈ ${formatInt(load)} N`
        : `≈ ${formatFixed(massEquivalentKg(load), 1)} kg 等效`;
    }
    if (deltaEl) {
      if (Math.abs(delta) < 0.05) {
        deltaEl.textContent = '±0';
        deltaEl.className = 'corner-delta';
      } else {
        const shownDelta = state.units === 'kg' ? delta / GRAVITY : delta;
        deltaEl.textContent = `Δ ${formatSigned(shownDelta, state.units === 'kg' ? 1 : 0)} ${unitDisplay()}`;
        deltaEl.className = 'corner-delta ' + (delta >= 0 ? 'is-up' : 'is-down');
      }
    }
    if (bar) {
      const width = clamp((load / maxLoad) * 100, load > 0 ? 2 : 0, 100);
      bar.style.width = width.toFixed(1) + '%';
    }
    if (card) {
      card.classList.toggle('is-max', load === maxLoad && load > 0);
      card.classList.toggle('is-low', load < avgLoad * 0.78);
    }
  });

  setText('frontShare', (model.frontShare * 100).toFixed(1) + '%');
  setText('rearShare', (model.rearShare * 100).toFixed(1) + '%');
  setText('leftShare', (model.leftShare * 100).toFixed(1) + '%');
  setText('rightShare', (model.rightShare * 100).toFixed(1) + '%');
  const frontBar = document.getElementById('frontShareBar');
  if (frontBar) frontBar.style.width = (model.frontShare * 100).toFixed(1) + '%';
  const leftBar = document.getElementById('leftShareBar');
  if (leftBar) leftBar.style.width = (model.leftShare * 100).toFixed(1) + '%';

  setText('totalNormal', `${loadDisplay(sumLoads)} ${unitDisplay()}`);
  setText('totalWeight', `${loadDisplay(model.totalWeight)} ${unitDisplay()}`);
  setText('frictionDemand', model.frictionDemand.toFixed(3));

  setText('dynHeave', formatSigned(model.heave * 1000, 1));
  setText('dynPitch', formatSigned(model.poseDeg.pitch, 2));
  setText('dynRoll', formatSigned(model.poseDeg.roll, 2));
  setText('dynYaw', formatSigned(model.poseDeg.yaw, 2));

  setText('planeTilt', model.frame.betaDeg.toFixed(2) + '°');
  setText('cgLong', `${formatSigned(model.xCG * 1000, 0)} mm`);
  setText('cgProjection', `Δx ${formatSigned((model.px - model.xCG) * 1000, 1)} / Δz ${formatSigned((model.pz - model.zCG) * 1000, 1)} mm`);
  setText('bodyHeave', `${formatSigned(model.heave * 1000, 2)} mm`);
  setText('bodyAttitude', `${formatSigned(model.heave * 1000, 2)} mm / ${formatSigned(model.poseDeg.pitch, 2)}° / ${formatSigned(model.poseDeg.roll, 2)}°`);
  const bodyPos = model.bodyPos || { x: 0, y: 0, z: 0 };
  setText('bodyPosition', `${formatSigned(bodyPos.x * 1000, 1)} / ${formatSigned(bodyPos.y * 1000, 1)} / ${formatSigned(bodyPos.z * 1000, 1)} mm`);
  if (model.bodyRatesDeg) {
    setText('bodyRates', `φ̇ ${formatSigned(model.bodyRatesDeg.roll, 2)} · ψ̇ ${formatSigned(model.bodyRatesDeg.yaw, 2)} · θ̇ ${formatSigned(model.bodyRatesDeg.pitch, 2)} °/s`);
  } else {
    setText('bodyRates', '—');
  }
  setText('cornerTravel', model.travelMm.map((value) => formatSigned(value, 2)).join(' / ') + ' mm');
  if (model.springCompressionMm && model.dampingForce && model.arbForce) {
    const maxDamping = Math.max(...model.dampingForce.map((value) => Math.abs(value)));
    const maxArb = Math.max(...model.arbForce.map((value) => Math.abs(value)));
    setText(
      'cornerForces',
      `压缩 ${model.springCompressionMm.map((value) => value.toFixed(1)).join(' / ')} mm · 阻尼 ${formatInt(maxDamping)} N · ARB ${formatInt(maxArb)} N`
    );
  } else {
    setText('cornerForces', '—');
  }
  if (model.motionRatioInstant && model.motionRatioInstant.length === 4) {
    const instant = model.motionRatioInstant;
    setText('dynRatio', `${((instant[0] + instant[1]) / 2).toFixed(2)} / ${((instant[2] + instant[3]) / 2).toFixed(2)}`);
  } else if (model.motionRatio) {
    setText('dynRatio', `${model.motionRatio.front.toFixed(2)} / ${model.motionRatio.rear.toFixed(2)}`);
  }
  if (model.frequencies) {
    setText('dynFreq', `${model.frequencies.heave.toFixed(2)} / ${model.frequencies.roll.toFixed(2)} / ${model.frequencies.pitch.toFixed(2)} Hz`);
  }
  if (model.inertia) {
    setText('dynInertia', `${model.inertia.Ixx.toFixed(0)} / ${model.inertia.Iyy.toFixed(0)} / ${model.inertia.Izz.toFixed(0)} kg·m²`);
  }
  const diag = getCarDiagnostics();
  setText('linkStatus', `${diag.linkCount} 根 · ${diag.jointCount} 点 · 悬架杆长偏差 ${diag.maxSuspLinkStretchMm.toFixed(3)} mm`);
  setText(
    'steerStatus',
    `齿条 ${formatSigned(diag.rackTravelMm, 1)} mm · 横拉杆 ${diag.tieRodStretchMm.toFixed(3)} mm · 推杆 ${diag.pushRodStretchMm.toFixed(3)} mm`
  );
  setText(
    'arbStatus',
    `${formatInt(model.arbRate.front / 1000)} / ${formatInt(model.arbRate.rear / 1000)} N/mm · 扭转 ${diag.arbTwistDeg.toFixed(2)}° · 叶片 ${diag.arbBladeFrontDeg.toFixed(0)}° / ${diag.arbBladeRearDeg.toFixed(0)}°`
  );
  const tests = UI.selfTests;
  const dynamicTests = UI.dynamicTests || [];
  if (tests.length) {
    const passed = tests.filter((test) => test.ok).length;
    const dynamicPassed = dynamicTests.filter((test) => test.ok).length;
    setText(
      'selfTestStatus',
      `静力 ${passed} / ${tests.length}${dynamicTests.length ? ` · 动态 ${dynamicPassed} / ${dynamicTests.length}` : ' · 动态待运行'} · ${solverStateOf(model) === 'failed' ? '求解失败' : solverStateOf(model) === 'degraded' ? '求解降级' : '求解正常'}`
    );
  }

  ['FL', 'FR', 'RL', 'RR'].forEach((key, index) => {
    setText('level' + key, `${loadDisplay(model.levelLoads[index])} ${unitDisplay()}`);
  });

  const warning = document.getElementById('solverWarning');
  if (warning) {
    const title = warning.querySelector('b');
    const detail = warning.querySelector('span');
    const solverState = solverStateOf(model);
    const residuals = Array.isArray(model.rockerResidualMm) ? model.rockerResidualMm : [];
    const residualMax = residuals.length ? Math.max.apply(null, residuals) : NaN;
    const feasible = Array.isArray(model.rockerFeasible) ? model.rockerFeasible : [];
    const failedCorners = feasible.filter((value) => !value).length;
    const ratioStates = Array.isArray(model.motionRatioState) ? model.motionRatioState : [];
    const unavailable = ratioStates.filter((value) => value !== 'ok').length;
    warning.classList.toggle('is-error', solverState === 'failed');
    if (solverState !== 'ok') {
      warning.hidden = false;
      title.textContent = solverState === 'failed' ? `求解失败：${failedCorners} 个角点不可达` : `求解降级：${failedCorners} 个角点不可达`;
      detail.textContent = `最大残差 ${Number.isFinite(residualMax) ? residualMax.toFixed(3) : '—'} mm（判据 0.100 mm）· 运动比不可用 ${unavailable} 角；载荷按降级分支计算。`;
    } else if (model.liftedCount > 0) {
      warning.hidden = false;
      title.textContent = `${model.liftedCount} 个车轮卸载`;
      detail.textContent = '等效悬挂力已截断为 0；请减小倾角、质心高度或横向偏移，或提高轮心率。';
    } else if (sim && sim.boundary) {
      warning.hidden = false;
      title.textContent = '车辆到达试验台边界';
      detail.textContent = '平面自由度已停在台面边界，按“重置姿态”回到中心。';
    } else if (sim && sim.sliding) {
      warning.hidden = false;
      title.textContent = '切向摩擦不足，车辆滑移';
      detail.textContent = `μ_req ${model.frictionDemand.toFixed(3)} > μ ${model.frictionCapacity.toFixed(2)}；阶段二使用库仑摩擦，按“重置姿态”可回到台面中心。`;
    } else {
      warning.hidden = true;
    }
  }

  refreshSolverBadge(model);
  const solveResiduals = Array.isArray(model.rockerResidualMm) ? model.rockerResidualMm : [];
  const solveMax = solveResiduals.length ? Math.max.apply(null, solveResiduals) : NaN;
  const solveRatios = Array.isArray(model.motionRatioState) ? model.motionRatioState : [];
  const solveUnavailable = solveRatios.filter((value) => value !== 'ok').length;
  const solveState = solverStateOf(model);
  setText('cornerSolveStatus', Number.isFinite(solveMax) ? `max ${solveMax.toFixed(3)} / 0.100 mm · 不可用 ${solveUnavailable} 角 · ${solveState === 'failed' ? '求解失败' : solveState === 'degraded' ? '求解降级' : '求解正常'}` : '—');
  syncSimControls(model);
  refreshChecks(model);
  refreshLabelContent(model);
}

/* ------------------------------ screenshot ------------------------------ */

function syncCameraButtonActive(name) {
  $$('[data-camera]').forEach((button) => {
    const selected = button.dataset.camera === name;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function syncCameraModeButtons() {
  const button = document.getElementById('btnOrtho');
  if (!button) return;
  const ortho = CAMERA.projection === 'orthographic';
  button.classList.toggle('is-active', ortho);
  button.setAttribute('aria-pressed', String(ortho));
}

function setOrtho(enabled) {
  const ortho = Boolean(enabled);
  if ((CAMERA.projection === 'orthographic') === ortho) return;
  setCameraProjection(ortho ? 'orthographic' : 'perspective');
  showToast(ortho ? '正交投影：平行线保持平行，无透视收敛' : '透视投影：恢复近大远小');
}

function resetInspectButton() {
  UI.inspectIndex = -1;
  const button = document.getElementById('btnInspect');
  if (button) {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = '<span class="tool-glyph">⌬</span>机构';
  }
}

function cycleInspectView() {
  UI.inspectIndex = UI.inspectIndex < 0 ? 0 : (UI.inspectIndex + 1) % INSPECT_VIEWS.length;
  const view = INSPECT_VIEWS[UI.inspectIndex];
  if (!state.xray) setXray(true);
  setPanel('panelControls', false);
  setPanel('panelTelemetry', false);
  setCameraPreset(view.preset);
  syncCameraButtonActive('');
  const button = document.getElementById('btnInspect');
  if (button) {
    button.classList.add('is-active');
    button.setAttribute('aria-pressed', 'true');
    button.innerHTML = `<span class="tool-glyph">⌬</span>机构 · ${view.label}`;
  }
  showToast(`${view.toast} · 按 R 返回总览`);
}

function requestScreenshot() {
  try {
    const ok = exportScreenshot();
    if (ok) showToast('截图已保存为 PNG');
  } catch (error) {
    console.error(error);
    showToast('截图失败：浏览器未允许导出画布');
  }
}

/* ------------------------------ bindings ------------------------------ */

function bindControls() {
  $$('[data-param]').forEach((input) => {
    const param = input.dataset.param;
    if (input.type === 'checkbox') {
      listenUI(input, 'change', () => {
        applyStateChange(param, input.checked, { rebuild: false });
        if (param === 'xray') {
          const button = document.getElementById('btnXray');
          if (button) {
            button.classList.toggle('is-active', state.xray);
            button.setAttribute('aria-pressed', String(state.xray));
          }
        }
      });
      return;
    }
    listenUI(input, 'input', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const rebuild = input.dataset.rebuild === '1';
      state[param] = value;
      refreshSliderFill(input);
      const output = document.getElementById(param + 'Out');
      if (output) output.textContent = formatOutputValue(param, value);
      input.setAttribute('aria-valuetext', formatOutputValue(param, value));
      updateRoadChips();
      persistState();
      refreshAll({ rebuild });
    });
  });

  $$('[data-road-preset]').forEach((button) => {
    listenUI(button, 'click', () => applyRoadPreset(button.dataset.roadPreset));
  });

  $$('.unit-toggle button').forEach((button) => {
    listenUI(button, 'click', () => applyUnit(button.dataset.units));
  });

  const btnScreenshot = document.getElementById('btnScreenshot');
  if (btnScreenshot) listenUI(btnScreenshot, 'click', requestScreenshot);
  const btnScreenshotBottom = document.getElementById('btnScreenshotBottom');
  if (btnScreenshotBottom) listenUI(btnScreenshotBottom, 'click', requestScreenshot);

  const btnReset = document.getElementById('btnResetAll');
  if (btnReset) listenUI(btnReset, 'click', resetAll);
  const btnCopy = document.getElementById('btnCopyConfig');
  if (btnCopy) listenUI(btnCopy, 'click', copyConfig);
  const btnLevel = document.getElementById('btnLevelSnapshot');
  if (btnLevel) listenUI(btnLevel, 'click', () => applyRoadPreset('level'));

  const btnXray = document.getElementById('btnXray');
  if (btnXray) listenUI(btnXray, 'click', () => setXray(!state.xray));
  const btnAuto = document.getElementById('btnAutoRotate');
  if (btnAuto) listenUI(btnAuto, 'click', () => setAutoRotate(!autoRotate));
  const btnInspect = document.getElementById('btnInspect');
  if (btnInspect) listenUI(btnInspect, 'click', cycleInspectView);

  const btnSimToggle = document.getElementById('btnSimToggle');
  if (btnSimToggle) listenUI(btnSimToggle, 'click', simulationToggle);
  const btnSimReset = document.getElementById('btnSimReset');
  if (btnSimReset) listenUI(btnSimReset, 'click', () => simulationReset({ settle: 0 }));
  const btnSimSettle = document.getElementById('btnSimSettle');
  if (btnSimSettle) listenUI(btnSimSettle, 'click', () => simulationReset({ settle: 2, toast: '已回到静力平衡姿态' }));
  const impulseButtons = [
    ['btnImpulseHeave', 'heave'],
    ['btnImpulseRoll', 'roll'],
    ['btnImpulsePitch', 'pitch']
  ];
  for (const [id, kind] of impulseButtons) {
    const button = document.getElementById(id);
    if (button) listenUI(button, 'click', () => simulationImpulse(kind));
  }

  const btnResetView = document.getElementById('btnResetView');
  if (btnResetView) listenUI(btnResetView, 'click', () => {
    resetCamera();
    resetInspectButton();
    showToast('相机已重置');
  });

  const btnOrtho = document.getElementById('btnOrtho');
  if (btnOrtho) listenUI(btnOrtho, 'click', () => {
    setOrtho(CAMERA.projection !== 'orthographic');
  });

  $$('[data-camera]').forEach((button) => {
    listenUI(button, 'click', () => {
      resetInspectButton();
      setCameraPreset(button.dataset.camera);
    });
  });

  const btnToggleControls = document.getElementById('btnToggleControls');
  if (btnToggleControls) listenUI(btnToggleControls, 'click', () => togglePanel('panelControls'));
  const btnToggleTelemetry = document.getElementById('btnToggleTelemetry');
  if (btnToggleTelemetry) listenUI(btnToggleTelemetry, 'click', () => togglePanel('panelTelemetry'));
  $$('[data-close-panel]').forEach((button) => {
    listenUI(button, 'click', () => setPanel(button.dataset.closePanel, false));
  });
  const scrim = document.getElementById('mobileScrim');
  if (scrim) listenUI(scrim, 'click', () => {
    setPanel('panelControls', false);
    setPanel('panelTelemetry', false);
  });

  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) listenUI(btnHelp, 'click', openModelModal);
  $$('[data-close-modal]').forEach((element) => {
    listenUI(element, 'click', closeModelModal);
  });

  bindKeyboard();
  bindWindowChrome();
}

const SHORTCUT_BLOCK_SELECTOR = 'button, a[href], summary, label, input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="switch"], [role="checkbox"]';
function shortcutTargetBlocked(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest(SHORTCUT_BLOCK_SELECTOR));
}

function bindKeyboard() {
  listenUI(window, 'keydown', (event) => {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
    const modal = document.getElementById('modelModal');
    const modalOpen = modal && !modal.hidden;

    if (event.key === 'Tab' && modalOpen) {
      trapModalFocus(event);
      return;
    }
    if (event.key === 'Escape') {
      if (modalOpen) {
        closeModelModal();
        event.preventDefault();
        return;
      }
      if (isCompact()) {
        setPanel('panelControls', false);
        setPanel('panelTelemetry', false);
      }
      return;
    }
    if (isTyping || modalOpen) return;
    if (event.defaultPrevented || shortcutTargetBlocked(event.target)) return;
    // Leave browser and OS shortcuts (Ctrl+R, Cmd+O, Alt+...) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (event.key === ' ' || event.code === 'Space') {
      simulationToggle();
      event.preventDefault();
    } else if (key === 'i') {
      simulationImpulse('heave');
      event.preventDefault();
    } else if (key === 'r') {
      resetCamera();
      resetInspectButton();
      showToast('视角已重置');
      event.preventDefault();
    } else if (key === 'o') {
      setOrtho(CAMERA.projection !== 'orthographic');
      event.preventDefault();
    } else if (key === 'm') {
      cycleInspectView();
      event.preventDefault();
    } else if (key === 'h') {
      state.slope = 0;
      state.bank = 0;
      syncParamOutput('slope');
      syncParamOutput('bank');
      updateRoadChips();
      persistState();
      refreshAll({ rebuild: false });
      event.preventDefault();
    } else if (key === 'x') {
      setXray(!state.xray);
      event.preventDefault();
    } else if (key === 'f') {
      state.showLoads = !state.showLoads;
      syncParamOutput('showLoads');
      persistState();
      refreshAll({ rebuild: false });
      event.preventDefault();
    } else if (key === 'g') {
      state.showCG = !state.showCG;
      syncParamOutput('showCG');
      persistState();
      refreshAll({ rebuild: false });
      event.preventDefault();
    } else if (key === '?') {
      openModelModal();
      event.preventDefault();
    } else if (['1', '2', '3', '4', '5'].includes(key)) {
      const presets = ['threeQuarter', 'side', 'front', 'rear', 'top'];
      resetInspectButton();
      setCameraPreset(presets[Number(key) - 1]);
      event.preventDefault();
    }
  });
}

function bindWindowChrome() {
  const applyInitialPanels = () => {
    const wide = window.innerWidth > 1180;
    setPanel('panelControls', wide, { exclusive: false });
    setPanel('panelTelemetry', wide, { exclusive: false });
    if (isCompact()) {
      setPanel('panelControls', false);
      setPanel('panelTelemetry', false);
    }
    updatePanelUI();
  };
  applyInitialPanels();

  // Viewport resizes do not consistently dispatch a window resize event in all
  // embedded browsers, so use the same media query as the CSS layout.
  const compactQuery = window.matchMedia('(max-width: 980px)');
  const onCompactChange = (event) => {
    if (event.matches) {
      setPanel('panelControls', false);
      setPanel('panelTelemetry', false);
    }
    updatePanelUI();
  };
  listenUIMedia(compactQuery, onCompactChange);

  listenUI(window, 'resize', () => {
    window.clearTimeout(UI.resizeTimer);
    UI.resizeTimer = window.setTimeout(() => {
      UI.resizeTimer = 0;
      if (!UI.disposed) updatePanelUI();
    }, 80);
  });
}

function initUI() {
  if (UI.initialized || UI.disposed) return;
  createAnnotationLabels();
  bindControls();
  syncControlsFromState();
  refreshSelfTests({ dynamic: false });
  syncSimControls();
  CAMERA.onChange = (reason) => {
    if (reason === 'preset') {
      syncCameraButtonActive(CAMERA.preset || '');
    } else if (reason === 'manual' || reason === 'orbit') {
      syncCameraButtonActive('');
    }
    syncCameraModeButtons();
    if (reason === 'preset' || reason === 'manual') setAutoRotate(false);
  };
  syncCameraButtonActive(CAMERA.preset || '');
  syncCameraModeButtons();
  UI.initialized = true;
}

function teardownUI() {
  if (UI.disposed) return;
  UI.disposed = true;
  cancelDynamicSelfTests();
  window.clearTimeout(UI.toastTimer);
  window.clearTimeout(UI.modalFocusTimer);
  window.clearTimeout(UI.resizeTimer);
  UI.toastTimer = 0;
  UI.modalFocusTimer = 0;
  UI.resizeTimer = 0;
  for (const entry of UI.listeners.splice(0)) {
    entry.target.removeEventListener(entry.type, entry.handler, entry.options);
  }
  for (const entry of UI.mediaListeners.splice(0)) {
    if (entry.query.removeEventListener) entry.query.removeEventListener('change', entry.handler);
    else if (entry.query.removeListener) entry.query.removeListener(entry.handler);
  }
  const modal = document.getElementById('modelModal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('modal-open');
  restoreModalBackgroundInert();
  UI.modalReturnFocus = null;
  CAMERA.onChange = null;
  if (UI.labelLayer) UI.labelLayer.textContent = '';
  UI.labelLayer = null;
  UI.cornerLabels = [];
  UI.partLabels = [];
  UI.cgLabel = null;
  UI.projLabel = null;
  UI.initialized = false;
}

UI.refreshTelemetry = refreshTelemetry;
UI.refreshLabelContent = refreshLabelContent;
UI.updateLabelPositions = updateLabelPositions;
UI.refreshSelfTests = refreshSelfTests;
UI.openModelModal = openModelModal;
UI.closeModelModal = closeModelModal;
UI.syncControls = syncControlsFromState;
UI.syncSimControls = syncSimControls;
UI.applyStateChange = applyStateChange;
UI.copyConfig = copyConfig;
UI.resetAll = resetAll;
