// A private headless Chrome for the gates that need a real renderer.
//
// It never drives a tab in the desktop browser: a shared tab measures every
// other page on the machine as well, and an occluded one runs animation frames
// at a fraction of the display rate.
const fs = require('fs');
const os = require('os');
const path = require('path');

// OVERSCAN_CHROME is the one name the gates share (CI sets it); CHROME still works.
const CHROME = process.env.OVERSCAN_CHROME || process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* puppeteer-core is not a dependency of the kit. Take it from PUPPETEER_CORE,
 * a local install, or a copy npx has cached. */
function puppeteer() {
  for (const p of [process.env.PUPPETEER_CORE, 'puppeteer-core']) {
    if (!p) continue;
    try { return require(p); } catch { /* next */ }
  }
  const npx = path.join(os.homedir(), '.npm/_npx');
  if (fs.existsSync(npx)) {
    for (const d of fs.readdirSync(npx)) {
      const p = path.join(npx, d, 'node_modules/puppeteer-core');
      if (fs.existsSync(p)) return require(p);
    }
  }
  throw new Error('puppeteer-core not found: set PUPPETEER_CORE, or npm i --no-save puppeteer-core');
}

async function launch() {
  return puppeteer().launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'overscan-perf-')),
    args: ['--no-first-run', '--no-default-browser-check', '--enable-gpu', '--use-angle=metal',
      '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { CHROME, launch, sleep };
