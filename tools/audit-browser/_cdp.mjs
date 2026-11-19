import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../audit/_harness.mjs';
import { findChrome, launchBrowser, requiredChrome } from '../browser-runner.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function runBrowserAudit(meta, fn) {
  await runAudit(meta, async (audit) => {
    const explicitSkip = process.env.FS_SKIP_BROWSER === '1' || process.env.FS_SKIP_BROWSER === 'true';
    if (explicitSkip) {
      if (requiredChrome()) throw new Error('FS_SKIP_BROWSER conflicts with required Chrome');
      audit.skip('browser/chrome', 'FS_SKIP_BROWSER is set');
      return;
    }
    const chromePath = findChrome();
    if (!chromePath) {
      if (requiredChrome()) throw new Error('Chrome/Chromium is required but not found');
      audit.skip('browser/chrome', 'Chrome/Chromium not found; set CHROME_PATH to enable');
      return;
    }
    const context = await launchBrowser({ chromePath, pagePath: join(ROOT, 'index.html') });
    try {
      await fn(audit, context);
      audit.check(
        meta.audit + '/page-errors',
        context.pageErrors.length === 0,
        { pageErrors: context.pageErrors.slice(0, 10) },
        'pageErrors.length === 0',
        'uncaught exceptions and console errors'
      );
    } finally {
      await context.close();
    }
  });
}

export { ROOT };
