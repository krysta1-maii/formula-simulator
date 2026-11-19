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

function sceneWheelbase(scene) {
  if (!scene || !Array.isArray(scene.wheelPos) || scene.wheelPos.length < 4) return NaN;
  const frontX = (scene.wheelPos[0][0] + scene.wheelPos[1][0]) / 2;
  const rearX = (scene.wheelPos[2][0] + scene.wheelPos[3][0]) / 2;
  return Math.abs(rearX - frontX);
}

async function changeWheelbase(ctx, target, timeoutMs = 20000) {
  const before = await ctx.evaluateJson('window.FSApp.getSnapshot()');
  const requested = await ctx.evaluateJson('window.FSApp.setState({ wheelbase: ' + target + ' })');
  const deadline = Date.now() + timeoutMs;
  let after = null;
  while (Date.now() < deadline) {
    after = await ctx.evaluateJson('window.FSApp.getSnapshot()');
    const geometry = after.geometry || {};
    if (geometry.pending === false && geometry.commitCount > before.geometry.commitCount &&
        Math.abs(after.state.wheelbase - target) < 1e-9) {
      const afterScene = await ctx.evaluateJson('window.FSApp.getSceneProbe()');
      const geometry = after.geometry;
      const valid = requested.geometry && requested.geometry.pending === true &&
        requested.geometry.commitCount === before.geometry.commitCount &&
        geometry.commitCount === before.geometry.commitCount + 1 && geometry.mismatch === false &&
        Number.isFinite(geometry.sceneRevision) && geometry.sceneRevision === geometry.physicsRevision &&
        afterScene.geometryRevision === geometry.sceneRevision && afterScene.physicsRevision === geometry.physicsRevision &&
        afterScene.geometryMismatch === false && Math.abs(sceneWheelbase(afterScene) - target) <= 1e-4;
      if (!valid) throw new Error('invalid geometry commit for ' + target.toFixed(2) + ' m: ' + JSON.stringify({ before: before.geometry, requested: requested.geometry, after: geometry, sceneRevision: afterScene.geometryRevision, actualWheelbase: sceneWheelbase(afterScene) }));
      return { before, requested, after, afterScene };
    }
    await sleep(50);
  }
  throw new Error('geometry rebuild did not commit ' + target.toFixed(2) + ' m: ' + JSON.stringify(after && after.geometry));
}

await runBrowserAudit({ audit: 'browser-contract', group: 'runtime', title: 'B5.2/B5.3/B5.4/O1 浏览器合同' }, async (audit, ctx) => {
  const snapshot = () => ctx.evaluateJson('window.FSApp.getSnapshot()');
  const scene = () => ctx.evaluateJson('window.FSApp.getSceneProbe()');

  const { before, requested, after, afterScene } = await (async () => {
    const initial = await snapshot();
    const request = await ctx.evaluateJson("window.FSApp.setState({ wheelbase: 3.90 }, { rebuild: false })");
    const deadline = Date.now() + 20000;
    let current = null;
    while (Date.now() < deadline) {
      current = await snapshot();
      const geometry = current.geometry || {};
      if (geometry.pending === false && geometry.commitCount > initial.geometry.commitCount &&
          Math.abs(current.state.wheelbase - 3.90) < 1e-9) {
        return { before: initial, requested: request, after: current, afterScene: await scene() };
      }
      await sleep(50);
    }
    throw new Error('geometry rebuild did not commit 3.90 m: ' + JSON.stringify(current && current.geometry));
  })();
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
  const geometry = after.geometry || {};
  const actualWheelbase = sceneWheelbase(afterScene);
  const geometryCommitted = requested.geometry && requested.geometry.pending === true &&
    requested.geometry.policy === 'geometry-forced' &&
    requested.geometry.commitCount === before.geometry.commitCount &&
    geometry.pending === false && after.pendingRebuild === false && geometry.mismatch === false &&
    geometry.commitCount === before.geometry.commitCount + 1 &&
    Number.isFinite(geometry.sceneRevision) && geometry.sceneRevision === geometry.physicsRevision &&
    afterScene.geometryRevision === geometry.sceneRevision && afterScene.physicsRevision === geometry.physicsRevision &&
    afterScene.geometryMismatch === false && Math.abs(after.state.wheelbase - 3.90) < 1e-9 &&
    Math.abs(actualWheelbase - 3.90) <= 1e-4;
  audit.check(
    'B5.2/geometry-generation',
    Boolean(geometryCommitted) && wheelGapMax <= 1e-6 && linkStretchMm <= 0.001 && (diagStretchMm === null || diagStretchMm <= 0.001),
    {
      wheelGapMaxMm: wheelGapMax * 1000,
      linkStretchMm,
      diagStretchMm,
      stretch,
      beforeWheelbase: before.state.wheelbase,
      afterWheelbase: after.state.wheelbase,
      actualWheelbase,
      pending: geometry.pending,
      sceneRevision: geometry.sceneRevision,
      physicsRevision: geometry.physicsRevision,
      commitBefore: before.geometry.commitCount,
      commitAfter: geometry.commitCount,
      requestedPending: requested.geometry && requested.geometry.pending,
      policy: requested.geometry && requested.geometry.policy,
      sceneWheel0: afterScene.wheelPos[0],
      solvedWheel0: after.solved && after.solved[0] ? after.solved[0].wheelPos : null
    },
    'pending=false, matching revisions, commit +1, actual wheelbase, wheel gap <= 1e-6 m, link stretch <= 0.001 mm',
    'setState with rebuild=false must not mix geometry generations'
  );

  await changeWheelbase(ctx, 3.55);

  const observer = await ctx.evaluate("(function () { window.__auditNodeRebuilds = 0; window.__auditTextMutations = 0; if (window.__auditObserver) window.__auditObserver.disconnect(); if (window.__auditTextObserver) window.__auditTextObserver.disconnect(); var list = document.getElementById('checkList'); if (!list) return false; window.__auditObserver = new MutationObserver(function (records) { window.__auditNodeRebuilds += records.length; }); window.__auditObserver.observe(list, { childList: true, subtree: true }); window.__auditTextObserver = new MutationObserver(function (records) { window.__auditTextMutations += records.length; }); window.__auditTextObserver.observe(list, { subtree: true, characterData: true }); return true; })()");
  await sleep(1000);
  const mutationCounts = await ctx.evaluateJson('({ nodeRebuilds: window.__auditNodeRebuilds, textMutations: window.__auditTextMutations })');
  await ctx.evaluate('if (window.__auditObserver) window.__auditObserver.disconnect(); if (window.__auditTextObserver) window.__auditTextObserver.disconnect();');
  audit.check(
    'B5.3/telemetry-dom',
    observer === true && mutationCounts.nodeRebuilds === 0,
    { listPresent: observer, nodeRebuilds: mutationCounts.nodeRebuilds, textMutations: mutationCounts.textMutations },
    'childList rebuild count === 0 over 1 s idle; characterData is auxiliary only',
    'periodic telemetry must not rebuild the check list nodes'
  );

  const threePresent = await ctx.evaluate("Boolean(window.THREE && window.THREE.Material && window.THREE.BufferGeometry)");
  if (threePresent) {
    await ctx.evaluate("(function () { if (window.__auditHooked) return; window.__auditMatDispose = 0; window.__auditGeomDispose = 0; var mp = THREE.Material.prototype; var md = mp.dispose; mp.dispose = function () { window.__auditMatDispose += 1; return md.call(this); }; var gp = THREE.BufferGeometry.prototype; var gd = gp.dispose; gp.dispose = function () { window.__auditGeomDispose += 1; return gd.call(this); }; window.__auditHooked = true; })()");
    await changeWheelbase(ctx, 3.70);
    const counts = await ctx.evaluateJson('({ material: window.__auditMatDispose, geometry: window.__auditGeomDispose })');
    audit.check(
      'B5.4/material-release',
      counts.material >= 3 && counts.geometry > 0,
      { materialDisposed: counts.material, geometryDisposed: counts.geometry },
      'materialDisposed >= 3 and geometryDisposed > 0',
      'rebuild must dispose owned materials as well as geometry'
    );
    await changeWheelbase(ctx, 3.55);
  } else {
    audit.check(
      'B5.4/material-release',
      false,
      { threePresent: false },
      'THREE.Material.prototype.dispose observable',
      'cannot observe material disposal without global THREE'
    );
  }

  await ctx.evaluate("(function () { window.FSApp.resetDynamics({ settle: 1 }); window.FSApp.impulse('pitch'); window.FSApp.setSimRunning(false); })()");
  await ctx.evaluate("window.FSApp.advanceSimulation(0.06)");
  const oneShot = await snapshot();

  await ctx.evaluate("(function () { window.FSApp.resetDynamics({ settle: 1 }); window.FSApp.impulse('pitch'); window.FSApp.setSimRunning(false); })()");
  for (let index = 0; index < 4; index += 1) {
    await ctx.evaluate("window.FSApp.advanceSimulation(0.015)");
  }
  const chunked = await snapshot();
  await ctx.evaluate("window.FSApp.setSimRunning(true)");

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
    { bodyPosDelta, quatDelta, dampingDelta, travelDelta, oneShotTime: oneShot.sim ? oneShot.sim.time : null, chunkedTime: chunked.sim ? chunked.sim.time : null },
    'body/quaternion delta <= 1e-9 and damping/travel delta <= 1e-6',
    'rendering between simulation chunks must not change the physical result'
  );
});
