#!/usr/bin/env node
import { runBrowserAudit } from './_cdp.mjs';
import { sleep } from '../audit/_harness.mjs';

function maxAbs(values) {
  let max = 0;
  for (const value of values) max = Math.max(max, Math.abs(value));
  return max;
}

function numericDiff(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  let max = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (typeof x === 'number' && typeof y === 'number') max = Math.max(max, Math.abs(x - y));
  }
  return max;
}

async function waitFrames(ctx, count = 2) {
  await ctx.evaluate('new Promise(function (resolve) { var left = ' + count + '; function step() { left -= 1; if (left <= 0) resolve(true); else requestAnimationFrame(step); } requestAnimationFrame(step); })');
}

await runBrowserAudit({ audit: 'browser-contract', group: 'runtime', title: 'B5.2/B5.3/B5.4/O1 浏览器合同' }, async (audit, ctx) => {
  const snapshot = () => ctx.evaluateJson('window.FSApp.getSnapshot()');
  const scene = () => ctx.evaluateJson('window.FSApp.getSceneProbe()');

  const before = await snapshot();
  await ctx.evaluate("window.FSApp.setState({ wheelbase: 3.90 }, { rebuild: false })");
  await sleep(2600);
  await waitFrames(ctx, 2);
  const after = await snapshot();
  const afterScene = await scene();
  const wheelGaps = [];
  for (let index = 0; index < afterScene.wheelPos.length; index += 1) {
    const scenePos = afterScene.wheelPos[index];
    const solved = after.solved && after.solved[index];
    if (!scenePos || !solved || !solved.wheelPos) {
      wheelGaps.push(999);
      continue;
    }
    wheelGaps.push(Math.hypot(scenePos[0] - solved.wheelPos[0], scenePos[2] - solved.wheelPos[2]));
  }
  const wheelGapMax = Math.max.apply(null, wheelGaps);
  const stretch = afterScene.stretch || {};
  const linkStretchMm = Math.max(
    Math.abs(stretch.susp || 0),
    Math.abs(stretch.tie || 0),
    Math.abs(stretch.push || 0)
  );
  const diagStretchMm = after.diag && typeof after.diag.maxSuspLinkStretchMm === 'number'
    ? after.diag.maxSuspLinkStretchMm
    : null;
  audit.check(
    'B5.2/geometry-generation',
    wheelGapMax <= 1e-6 && linkStretchMm <= 0.001 && (diagStretchMm === null || diagStretchMm <= 0.001),
    {
      wheelGapMaxMm: wheelGapMax * 1000,
      linkStretchMm,
      diagStretchMm,
      stretch,
      beforeWheelbase: before.state.wheelbase,
      afterWheelbase: after.state.wheelbase,
      sceneWheel0: afterScene.wheelPos[0],
      solvedWheel0: after.solved && after.solved[0] ? after.solved[0].wheelPos : null
    },
    'wheel gap <= 1e-6 m and link stretch <= 0.001 mm',
    'setState with rebuild=false must not mix geometry generations'
  );

  await ctx.evaluate("window.FSApp.setState({ wheelbase: 3.55 })");
  await sleep(2200);
  await waitFrames(ctx, 2);

  const observer = await ctx.evaluate("(function () { window.__auditMutations = 0; if (window.__auditObserver) window.__auditObserver.disconnect(); var list = document.getElementById('checkList'); window.__auditObserver = new MutationObserver(function (records) { window.__auditMutations += records.length; }); window.__auditObserver.observe(list, { childList: true, subtree: true, characterData: true }); return Boolean(list); })()");
  await sleep(1200);
  const mutationCount = await ctx.evaluate('window.__auditMutations');
  await ctx.evaluate('if (window.__auditObserver) window.__auditObserver.disconnect()');
  audit.check(
    'B5.3/telemetry-dom',
    observer === true && mutationCount === 0,
    { listPresent: observer, mutationCount },
    'mutationCount === 0 over 1.2 s idle',
    'periodic telemetry must not rebuild the self-test DOM'
  );

  const threePresent = await ctx.evaluate("Boolean(window.THREE && window.THREE.Material && window.THREE.BufferGeometry)");
  if (threePresent) {
    await ctx.evaluate("(function () { if (window.__auditHooked) return; window.__auditMatDispose = 0; window.__auditGeomDispose = 0; var mp = THREE.Material.prototype; var md = mp.dispose; mp.dispose = function () { window.__auditMatDispose += 1; return md.call(this); }; var gp = THREE.BufferGeometry.prototype; var gd = gp.dispose; gp.dispose = function () { window.__auditGeomDispose += 1; return gd.call(this); }; window.__auditHooked = true; })()");
    await ctx.evaluate("window.FSApp.setState({ wheelbase: 3.70 })");
    await sleep(2600);
    await waitFrames(ctx, 2);
    const counts = await ctx.evaluateJson('({ material: window.__auditMatDispose, geometry: window.__auditGeomDispose })');
    audit.check(
      'B5.4/material-release',
      counts.material >= 3 && counts.geometry > 0,
      { materialDisposed: counts.material, geometryDisposed: counts.geometry },
      'materialDisposed >= 3 and geometryDisposed > 0',
      'rebuild must dispose owned materials as well as geometry'
    );
    await ctx.evaluate("window.FSApp.setState({ wheelbase: 3.55 })");
    await sleep(2200);
  } else {
    audit.check(
      'B5.4/material-release',
      false,
      { threePresent: false },
      'THREE.Material.prototype.dispose observable',
      'cannot observe material disposal without global THREE'
    );
  }

  await ctx.evaluate("window.FSApp.resetDynamics({ settle: 1 })");
  await ctx.evaluate("window.FSApp.impulse('pitch')");
  await ctx.evaluate("window.FSApp.advanceSimulation(0.06)");
  const oneShot = await snapshot();

  await ctx.evaluate("window.FSApp.resetDynamics({ settle: 1 })");
  await ctx.evaluate("window.FSApp.impulse('pitch')");
  for (let index = 0; index < 4; index += 1) {
    await ctx.evaluate("window.FSApp.advanceSimulation(0.015)");
  }
  const chunked = await snapshot();

  const bodyPosDelta = Math.hypot(
    oneShot.bodyPos.x - chunked.bodyPos.x,
    oneShot.bodyPos.y - chunked.bodyPos.y,
    oneShot.bodyPos.z - chunked.bodyPos.z
  );
  const quatDelta = numericDiff(oneShot.bodyQuat, chunked.bodyQuat);
  const dampingDelta = numericDiff(oneShot.dampingForce, chunked.dampingForce);
  const travelDelta = numericDiff(oneShot.travelMm, chunked.travelMm);
  audit.check(
    'O1/chunked-vs-one-shot',
    bodyPosDelta <= 1e-9 && quatDelta <= 1e-9 && dampingDelta <= 1e-6 && travelDelta <= 1e-6,
    { bodyPosDelta, quatDelta, dampingDelta, travelDelta },
    'body/quaternion delta <= 1e-9 and damping/travel delta <= 1e-6',
    'rendering between simulation chunks must not change the physical result'
  );
});
