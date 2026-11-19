#!/usr/bin/env node
import { runBrowserAudit } from './_cdp.mjs';
import { sleep } from '../audit/_harness.mjs';

function rectScript(selector) {
  return "(function () { var el = document.querySelector('" + selector + "'); if (!el) return null; var r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; })()";
}

async function spaceKey(ctx) {
  await ctx.evaluate('window.FSApp.setSimRunning(true)');
  await ctx.evaluate("document.getElementById('btnHelp').focus()");
  const before = await ctx.evaluateJson('window.FSApp.getSnapshot()');
  await ctx.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32
  });
  await ctx.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32
  });
  await sleep(250);
  const after = await ctx.evaluateJson('window.FSApp.getSnapshot()');
  const modalOpen = await ctx.evaluate("!document.getElementById('modelModal').hidden");
  const focused = await ctx.evaluate("document.activeElement ? document.activeElement.id : ''");
  if (modalOpen) await ctx.evaluate('window.FSApp.closeModel()');
  await ctx.evaluate('window.FSApp.setSimRunning(true)');
  return {
    focused,
    modalOpen,
    beforeRunning: before.sim && before.sim.running,
    afterRunning: after.sim && after.sim.running
  };
}

await runBrowserAudit({ audit: 'ui', group: 'ui', title: 'U1-U4 界面与可访问性' }, async (audit, ctx) => {
  await ctx.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(450);
  const topbar = await ctx.evaluateJson(rectScript('.topbar'));
  const bottomBar = await ctx.evaluateJson(rectScript('.bottom-bar'));
  const viewport = await ctx.evaluateJson('({ width: innerWidth, height: innerHeight })');
  const inView = (rect) => Boolean(rect) && rect.top >= -1 && rect.bottom <= viewport.height + 1 && rect.height > 0;
  audit.check(
    'U1/landscape',
    inView(topbar) && inView(bottomBar),
    { viewport, topbar, bottomBar },
    'topbar and bottom-bar inside 844x390 viewport',
    'low-height landscape must not push the toolbar off-screen'
  );
  await ctx.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  const space = await spaceKey(ctx);
  audit.check(
    'U2/space-key',
    space.modalOpen === true && space.beforeRunning === space.afterRunning,
    space,
    'Space opens the help modal and does not toggle simulation',
    'focused button keeps its native Space behaviour'
  );

  await ctx.evaluate("document.querySelectorAll('[data-close-panel]')[0].click()");
  await sleep(200);
  const panel = await ctx.evaluateJson("(function () { var p = document.getElementById('panelControls'); var focusable = p.querySelectorAll('button, [href], input, select, textarea, [tabindex]'); return { open: p.classList.contains('is-open'), inert: p.inert === true, ariaHidden: p.getAttribute('aria-hidden'), focusable: focusable.length }; })()");
  audit.check(
    'U3/panel-focus',
    panel.open === false && panel.inert === true && panel.ariaHidden === 'true',
    panel,
    'closed panel is inert and aria-hidden',
    'closed panel must not be reachable with Tab'
  );

  await ctx.evaluate('window.FSApp.setSimRunning(true)');
  await ctx.evaluate("document.getElementById('btnSimToggle').click()");
  await sleep(500);
  const detail = await ctx.evaluate("document.getElementById('simDetail').textContent || ''");
  const running = await ctx.evaluateJson('window.FSApp.getSnapshot().sim.running');
  audit.check(
    'U4/pause-text',
    detail.includes('暂停') && !detail.startsWith('运行') && running === false,
    { detail, running },
    'simDetail contains pause and does not start with running',
    'all simulation status fields update from one render path'
  );
  await ctx.evaluate('window.FSApp.setSimRunning(true)');
});
