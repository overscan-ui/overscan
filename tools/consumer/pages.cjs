// Load each URL in a real headless Chrome and print the page's own verdict
// from <pre id="out">. Exit code = pages that did not say "GATE: PASS", so
// silence and "running..." both count as failures.
//
//   node tools/consumer/pages.cjs <url> [<url> ...]
//
// 🔴 NOT `chrome --dump-dom --virtual-time-budget`, which the no-build pages
// above it in consumer-test.sh still use because they draw no WebGL. Virtual
// time never ticks rAF, and ov-gl's context pool lends canvases through an
// IntersectionObserver, so under it the broken kit and the fixed kit BOTH
// reported "no canvas" while a real renderer showed both lending at once
// (2026-09-12). A gate that cannot tell working from broken is not a gate.
const path = require('path');
const { launch, sleep } = require(path.join(__dirname, 'browser.cjs'));

(async () => {
  const urls = process.argv.slice(2);
  if (!urls.length) { console.error('usage: node tools/consumer/pages.cjs <url> [<url> ...]'); process.exit(2); }
  const browser = await launch();
  let failing = 0;
  try {
    for (const url of urls) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1000, height: 800 });
      let text = 'NO OUTPUT: the page did not run';
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        // Vite dev can reload once after optimizing dependencies, so poll the
        // current document rather than hold a handle to the first one.
        for (let i = 0; i < 200; i++) {
          text = await page.evaluate(() => document.getElementById('out')?.textContent ?? 'NO OUTPUT')
            .catch(() => 'running...');
          if (!/running\.\.\.|NO OUTPUT/.test(text)) break;
          await sleep(100);
        }
      } catch (e) {
        text = `LOAD FAILED: ${e.message}`;
      }
      console.log(`--- ${url}\n${text}\n`);
      if (!/GATE: PASS/.test(text)) failing++;
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.exit(failing);
})();
