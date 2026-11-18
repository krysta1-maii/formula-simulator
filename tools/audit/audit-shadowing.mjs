#!/usr/bin/env node
import { runAudit, loadPhysics, makeSetup } from './_harness.mjs';

const api = loadPhysics();
const SETUP = makeSetup(api, { friction: 0.2 });

await runAudit({ audit: 'shadowing', group: 'physics', title: 'A2 变量遮蔽与摩擦回退' }, (audit) => {
  const sim = api.simCreate(SETUP);
  const source = sim.reference.source;
  const sourceFriction = source && source.friction;
  const withSource = api.simEvaluate(sim);
  const capacityWithSource = withSource.capacity;

  let threw = false;
  let message = '';
  let capacityWithoutSource = null;
  delete sim.reference.source;
  try {
    const missing = api.simEvaluate(sim);
    capacityWithoutSource = missing.capacity;
  } catch (error) {
    threw = true;
    message = error && error.message ? error.message : String(error);
  }
  const ratio = capacityWithoutSource === null ? null : capacityWithoutSource / capacityWithSource;

  audit.check(
    'A2/source-contract',
    Boolean(source) && Math.abs(sourceFriction - 0.2) < 1e-12,
    { sourcePresent: Boolean(source), sourceFriction, capacityWithSource },
    'reference.source exists and carries setup friction',
    'computeStatic must expose the setup snapshot'
  );
  audit.check(
    'A2/no-silent-fallback',
    threw ? /reference\.source/.test(message) : ratio !== null && Math.abs(ratio - 1) <= 1e-9,
    {
      threw,
      message,
      capacityWithSource,
      capacityWithoutSource,
      ratio
    },
    'throw mentioning reference.source or keep capacity ratio 1',
    'missing reference.source must not silently fall back to DEFAULTS'
  );
});
