/* =========================================================================
   30-ui.js — controls, telemetry, annotations, panels and interaction
   ========================================================================= */

const UI = {
  initialized: false,
  lastModel: null,
  selfTests: [],
  toastTimer: 0,
  labelLayer: null,
  cornerLabels: [],
  cgLabel: null,
  projLabel: null,
  partLabels: [],
  inspectIndex: -1,
  elements: {},
  modalReturnFocus: null
};

const INSPECT_VIEWS = [
  { preset: 'inspectSteering', label: '转向', toast: '转向机、转向拉杆与转向柱' },
  { preset: 'inspectDrivetrain', label: '传动', toast: '差速器与后轮半轴' },
  { preset: 'inspectArb', label: '前防倾杆', toast: '前防倾杆：横向扭杆、叶片臂与连接杆' },
  { preset: 'inspectArbRear', label: '后防倾杆', toast: '后防倾杆：横向扭杆、杠杆臂与连接杆' }
];

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
const _partWorld = new THREE.Vector3();

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
    button.classList.toggle('is-active', button.dataset.units === state.units);
  });
  const xrayButton = document.getElementById('btnXray');
  if (xrayButton) {
    xrayButton.classList.toggle('is-active', Boolean(state.xray));
    xrayButton.setAttribute('aria-pressed', String(Boolean(state.xray)));
  }
  updateRoadChips();
}

function updateRoadChips() {
  const presets = {
    level: [0, 0],
    slope: [8, 0],
    bank: [0, 7],
    mixed: [6, 5]
  };
  $$('[data-road-preset]').forEach((button) => {
    const target = presets[button.dataset.roadPreset];
    const matches = target && Math.abs(state.slope - target[0]) < 0.001 && Math.abs(state.bank - target[1]) < 0.001;
    button.classList.toggle('is-active', Boolean(matches));
  });
}

function applyRoadPreset(name) {
  const presets = {
    level: { slope: 0, bank: 0 },
    slope: { slope: 8, bank: 0 },
    bank: { slope: 0, bank: 7 },
    mixed: { slope: 6, bank: 5 }
  };
  const target = presets[name];
  if (!target) return;
  Object.assign(state, target);
  syncParamOutput('slope');
  syncParamOutput('bank');
  updateRoadChips();
  persistState();
  refreshAll({ rebuild: false });
}

function applyUnit(unit) {
  if (unit !== 'N' && unit !== 'kg') return;
  state.units = unit;
  $$('.unit-toggle button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.units === unit);
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
  const button = document.getElementById('btnAutoRotate');
  if (button) {
    button.classList.toggle('is-active', autoRotate);
    button.setAttribute('aria-pressed', String(autoRotate));
  }
}

function resetAll() {
  copyDefaults();
  autoRotate = false;
  syncControlsFromState();
  setAutoRotate(false);
  applyXray();
  persistState();
  resetCamera(false);
  resetInspectButton();
  syncCameraButtonActive(PORTRAIT_QUERY.matches ? 'portrait' : 'threeQuarter');
  refreshAll({ rebuild: true });
  showToast('已恢复默认标定与相机');
}

function buildConfigPayload() {
  const model = UI.lastModel;
  return {
    app: 'FS-01 Formula Simulator',
    version: APP_VERSION,
    stage: 'static-rig-stage-1',
    exportedAt: new Date().toISOString(),
    setup: cloneState(state),
    summary: model ? {
      totalNormalN: Number(model.totalNormal.toFixed(3)),
      cornerLoadsN: model.loads.map((value) => Number(value.toFixed(3))),
      planeBetaDeg: Number(model.frame.betaDeg.toFixed(4)),
      frictionDemand: Number(model.frictionDemand.toFixed(4)),
      bodyPitchDeg: Number(model.poseDeg.pitch.toFixed(5)),
      bodyRollDeg: Number(model.poseDeg.roll.toFixed(5)),
      heaveMm: Number((model.heave * 1000).toFixed(4)),
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
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(UI.toastTimer);
  UI.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function isCompact() {
  return window.innerWidth <= 980;
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
    leftButton.setAttribute('aria-pressed', String(Boolean(leftOpen)));
  }
  if (rightButton) {
    rightButton.classList.toggle('is-active', Boolean(rightOpen));
    rightButton.setAttribute('aria-pressed', String(Boolean(rightOpen)));
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
    if (other) other.classList.remove('is-open');
  }
  panel.classList.toggle('is-open', open);
  updatePanelUI();
}

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const open = !panel.classList.contains('is-open');
  setPanel(panelId, open, { exclusive: isCompact() });
}

function openModelModal() {
  const modal = document.getElementById('modelModal');
  if (!modal) return;
  UI.modalReturnFocus = document.activeElement;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  refreshSelfTests();
  window.setTimeout(() => {
    const closeButton = modal.querySelector('button[data-close-modal]');
    if (closeButton) closeButton.focus();
  }, 20);
}

function closeModelModal() {
  const modal = document.getElementById('modelModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  if (UI.modalReturnFocus && typeof UI.modalReturnFocus.focus === 'function') {
    UI.modalReturnFocus.focus();
  }
}

function refreshSelfTests() {
  const tests = runSelfTests(state);
  UI.selfTests = tests;
  const passed = tests.filter((test) => test.ok).length;
  const total = tests.length;

  const rightStatus = document.getElementById('selfTestStatus');
  if (rightStatus) rightStatus.textContent = `${passed} / ${total} 通过`;

  const summary = document.getElementById('selfTestSummary');
  if (summary) {
    summary.textContent = `${passed} / ${total} 项通过`;
    summary.style.color = passed === total ? 'var(--ok)' : 'var(--warn)';
  }

  const list = document.getElementById('selfTestList');
  if (list) {
    list.textContent = '';
    tests.forEach((test) => {
      const item = document.createElement('li');
      if (!test.ok) item.className = 'is-fail';
      const mark = document.createElement('span');
      mark.className = 'st-mark';
      mark.textContent = test.ok ? '✓' : '!';
      const name = document.createElement('span');
      name.textContent = test.name;
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
    label.element.style.transform = `translate(-50%, -50%) translate(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px)`;
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
    const x = (projected.x + label.offsetX).toFixed(1);
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

function refreshChecks(model) {
  const container = document.getElementById('checkList');
  if (!container) return;
  const diag = getCarDiagnostics();
  const tests = UI.selfTests;
  const passed = tests.filter((test) => test.ok).length;
  const forceOk = model.equilibriumOk && model.liftedCount === 0;
  const linksOk = diag.linkCount > 0 && diag.maxSuspLinkStretchMm < 1 && diag.rockerSolveOk;
  const steerOk = diag.tieRodStretchMm < 5 && diag.rockerSolveOk;
  const arbOk = diag.arbCount === 2 && diag.arbFront && diag.arbRear && diag.arbStretchMm < 0.5;
  const contactOk = model.contactOk;
  const frictionOk = model.frictionOk;
  const testsOk = tests.length > 0 && passed === tests.length;

  const rows = [
    {
      ok: forceOk,
      name: '法向力平衡',
      value: `ΣN ${model.forceError < 0.01 ? '<0.01' : model.forceError.toFixed(2)} N · M ${model.momentXError < 0.01 && model.momentZError < 0.01 ? '<0.01' : Math.max(model.momentXError, model.momentZError).toFixed(2)} N·m`
    },
    {
      ok: contactOk,
      name: '四轮接地',
      value: `${diag.contactCount} / 4 · 最小 ${loadDisplay(model.minLoad)} ${unitDisplay()}`
    },
    {
      ok: linksOk,
      name: '悬架杆长偏差',
      value: `${diag.linkCount} 根 / ${diag.jointCount} 点 · ${diag.maxSuspLinkStretchMm.toFixed(3)} mm`
    },
    {
      ok: steerOk,
      name: '齿条 / 横拉杆',
      value: `齿条 ${formatSigned(diag.rackTravelMm, 1)} mm · 横拉杆 ${diag.tieRodStretchMm.toFixed(3)} mm`
    },
    {
      ok: arbOk,
      name: '防倾杆连接',
      value: `${diag.arbCount} 套 · 扭转 ${diag.arbTwistDeg.toFixed(2)}° · 伸长 ${diag.arbStretchMm.toFixed(2)} mm`
    },
    {
      ok: frictionOk,
      name: '坡面静摩擦',
      value: `μ_req ${model.frictionDemand.toFixed(3)} / ${model.frictionCapacity.toFixed(2)}`
    },
    {
      ok: testsOk,
      name: '静力求解自检',
      value: tests.length ? `${passed} / ${tests.length} 通过` : '待运行'
    }
  ];

  container.textContent = '';
  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'check-item ' + (row.ok ? 'is-ok' : 'is-warn');
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
  });
}

function refreshTelemetry(model) {
  UI.lastModel = model;
  if (!model) return;
  UI.selfTests = runSelfTests(state);

  setText('topBeta', model.frame.betaDeg.toFixed(1) + '°');
  setText('topNormal', `${loadDisplay(model.totalNormal)} ${unitDisplay()}`);
  setText('topFrontShare', (model.frontShare * 100).toFixed(1) + '%');

  const maxLoad = Math.max(...model.loads, 1);
  const avgLoad = model.sumLoads / 4;
  CORNERS.forEach((corner, index) => {
    const load = model.loads[index];
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
      card.classList.toggle('is-max', load === Math.max(...model.loads) && load > 0);
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

  setText('totalNormal', `${loadDisplay(model.totalNormal)} ${unitDisplay()}`);
  setText('totalWeight', `${loadDisplay(model.totalWeight)} ${unitDisplay()}`);
  setText('frictionDemand', model.frictionDemand.toFixed(3));

  setText('planeTilt', model.frame.betaDeg.toFixed(2) + '°');
  setText('cgLong', `${formatSigned(model.xCG * 1000, 0)} mm`);
  setText('cgProjection', `Δx ${formatSigned((model.px - model.xCG) * 1000, 1)} / Δz ${formatSigned((model.pz - model.zCG) * 1000, 1)} mm`);
  setText('bodyHeave', `${formatSigned(model.heave * 1000, 2)} mm`);
  setText('bodyAttitude', `${formatSigned(model.poseDeg.pitch, 2)}° / ${formatSigned(model.poseDeg.roll, 2)}°`);
  setText('cornerTravel', model.travelMm.map((value) => formatSigned(value, 2)).join(' / ') + ' mm');

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
  if (tests.length) {
    const passed = tests.filter((test) => test.ok).length;
    setText('selfTestStatus', `${passed} / ${tests.length} 通过`);
  }

  ['FL', 'FR', 'RL', 'RR'].forEach((key, index) => {
    setText('level' + key, `${loadDisplay(model.levelLoads[index])} ${unitDisplay()}`);
  });

  const warning = document.getElementById('solverWarning');
  if (warning) {
    if (model.liftedCount > 0) {
      warning.hidden = false;
      warning.querySelector('b').textContent = `${model.liftedCount} 个车轮出现负法向载荷`;
      warning.querySelector('span').textContent = '线性静力模型已超出单侧接触范围，显示值已截断为 0；请减小倾角、质心高度或横向偏移。';
    } else {
      warning.hidden = true;
    }
  }

  refreshChecks(model);
  refreshLabelContent(model);
}

/* ------------------------------ screenshot ------------------------------ */

function syncCameraButtonActive(name) {
  $$('[data-camera]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.camera === name);
  });
}

function resetInspectButton() {
  UI.inspectIndex = -1;
  const button = document.getElementById('btnInspect');
  if (button) {
    button.classList.remove('is-active');
    button.innerHTML = '<span class="tool-glyph">⌬</span>机构';
  }
}

function cycleInspectView() {
  UI.inspectIndex = UI.inspectIndex < 0 ? 0 : (UI.inspectIndex + 1) % INSPECT_VIEWS.length;
  const view = INSPECT_VIEWS[UI.inspectIndex];
  if (!state.xray) setXray(true);
  setPanel('panelControls', false);
  setPanel('panelTelemetry', false);
  setCameraPreset(view.preset, true);
  syncCameraButtonActive('');
  const button = document.getElementById('btnInspect');
  if (button) {
    button.classList.add('is-active');
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
      input.addEventListener('change', () => {
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
    input.addEventListener('input', () => {
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
    button.addEventListener('click', () => applyRoadPreset(button.dataset.roadPreset));
  });

  $$('.unit-toggle button').forEach((button) => {
    button.addEventListener('click', () => applyUnit(button.dataset.units));
  });

  const btnScreenshot = document.getElementById('btnScreenshot');
  if (btnScreenshot) btnScreenshot.addEventListener('click', requestScreenshot);
  const btnScreenshotBottom = document.getElementById('btnScreenshotBottom');
  if (btnScreenshotBottom) btnScreenshotBottom.addEventListener('click', requestScreenshot);

  const btnReset = document.getElementById('btnResetAll');
  if (btnReset) btnReset.addEventListener('click', resetAll);
  const btnCopy = document.getElementById('btnCopyConfig');
  if (btnCopy) btnCopy.addEventListener('click', copyConfig);
  const btnLevel = document.getElementById('btnLevelSnapshot');
  if (btnLevel) btnLevel.addEventListener('click', () => applyRoadPreset('level'));

  const btnXray = document.getElementById('btnXray');
  if (btnXray) btnXray.addEventListener('click', () => setXray(!state.xray));
  const btnAuto = document.getElementById('btnAutoRotate');
  if (btnAuto) btnAuto.addEventListener('click', () => setAutoRotate(!autoRotate));
  const btnInspect = document.getElementById('btnInspect');
  if (btnInspect) btnInspect.addEventListener('click', cycleInspectView);

  const btnResetView = document.getElementById('btnResetView');
  if (btnResetView) btnResetView.addEventListener('click', () => {
    resetCamera();
    resetInspectButton();
    syncCameraButtonActive(PORTRAIT_QUERY.matches ? 'portrait' : 'threeQuarter');
    showToast('相机已重置');
  });

  $$('[data-camera]').forEach((button) => {
    button.addEventListener('click', () => {
      resetInspectButton();
      setCameraPreset(button.dataset.camera);
      syncCameraButtonActive(button.dataset.camera);
    });
  });

  const btnToggleControls = document.getElementById('btnToggleControls');
  if (btnToggleControls) btnToggleControls.addEventListener('click', () => togglePanel('panelControls'));
  const btnToggleTelemetry = document.getElementById('btnToggleTelemetry');
  if (btnToggleTelemetry) btnToggleTelemetry.addEventListener('click', () => togglePanel('panelTelemetry'));
  $$('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', () => setPanel(button.dataset.closePanel, false));
  });
  const scrim = document.getElementById('mobileScrim');
  if (scrim) scrim.addEventListener('click', () => {
    setPanel('panelControls', false);
    setPanel('panelTelemetry', false);
  });

  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) btnHelp.addEventListener('click', openModelModal);
  $$('[data-close-modal]').forEach((element) => {
    element.addEventListener('click', closeModelModal);
  });

  bindKeyboard();
  bindWindowChrome();
}

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
    const modal = document.getElementById('modelModal');
    const modalOpen = modal && !modal.hidden;

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

    const key = event.key.toLowerCase();
    if (key === 'r') {
      resetCamera();
      resetInspectButton();
      syncCameraButtonActive(PORTRAIT_QUERY.matches ? 'portrait' : 'threeQuarter');
      showToast('视角已重置');
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
      const name = presets[Number(key) - 1];
      resetInspectButton();
      setCameraPreset(name);
      syncCameraButtonActive(name);
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
    setPanel('panelControls', !event.matches);
    setPanel('panelTelemetry', !event.matches);
    updatePanelUI();
  };
  if (compactQuery.addEventListener) compactQuery.addEventListener('change', onCompactChange);
  else if (compactQuery.addListener) compactQuery.addListener(onCompactChange);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      updatePanelUI();
    }, 80);
  });
}

function initUI() {
  if (UI.initialized) return;
  createAnnotationLabels();
  bindControls();
  syncControlsFromState();
  refreshSelfTests();
  UI.initialized = true;
}

UI.refreshTelemetry = refreshTelemetry;
UI.refreshLabelContent = refreshLabelContent;
UI.updateLabelPositions = updateLabelPositions;
UI.refreshSelfTests = refreshSelfTests;
UI.openModelModal = openModelModal;
UI.closeModelModal = closeModelModal;
UI.syncControls = syncControlsFromState;
UI.applyStateChange = applyStateChange;
UI.copyConfig = copyConfig;
UI.resetAll = resetAll;
