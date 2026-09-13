/* Does every subpath the package advertises resolve FROM OUTSIDE the package?
 *
 * tools/check_exports.mjs expands the exports map by hand, inside the repo.
 * This asks Node itself, from a project that has `overscan` installed as a
 * dependency, which is the only authoritative answer: Node applies the real
 * exports algorithm, and `files` decides what is there to resolve to.
 *
 * Run by tools/consumer-test.sh from tmp/consumer/. Exits non-zero.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = new URL('./node_modules/overscan/src/', import.meta.url);

/* ⚠️ THESE ARE MODULES, NOT ELEMENTS, and the difference is not pedantry:
 * ov-core, ov-source, ov-refusal, ov-gl, ov-reveal and ov-flip are ov-*.js
 * files that define no custom element, so this count runs ahead of the kit's
 * element count (72 at the time of writing). Reporting it as "elements" would
 * be this tool inventing a number, which is the one thing the kit refuses. */
let modules;
try {
  modules = readdirSync(fileURLToPath(srcDir))
    .filter((f) => f.startsWith('ov-') && f.endsWith('.js'))
    .sort();
} catch (e) {
  console.error(`FAIL  the installed package has no src/ directory: ${e.message}`);
  process.exit(1);
}

const specs = [
  'overscan',
  'overscan/overscan.css',
  'overscan/custom-elements.json',
  'overscan/react',
  'overscan/vue',
  'overscan/svelte',
  /* ⭐ ALL THREE SPELLINGS, because the home page advertises the shortest one
   * and check_exports.mjs only expands the map by hand. Node applying its own
   * PATTERN_KEY_COMPARE to `./ov-*.js`, `./*.js` and `./*` is the only thing
   * that settles which pattern really wins for `overscan/radar.js`. */
  ...modules.map((f) => `overscan/${f}`),
  ...modules.map((f) => `overscan/${f.slice(3)}`),
  ...modules.map((f) => `overscan/${f.slice(3, -3)}`),
];

const bad = [];
const got = new Map();
for (const spec of specs) {
  try {
    const url = import.meta.resolve(spec);
    if (!url) bad.push(`${spec}: resolved to nothing`);
    else got.set(spec, url);
  } catch (e) {
    bad.push(`${spec}: ${e.code || e.message}`);
  }
}

/* 🔴 RESOLVING IS NOT ENOUGH: the three spellings must land on ONE file.
 * A pattern that resolves `overscan/radar` to some other module would pass
 * the loop above and hand a consumer the wrong element, which is the failure
 * this whole exercise exists to prevent. */
for (const f of modules) {
  const want = got.get(`overscan/${f}`);
  for (const alias of [`overscan/${f.slice(3)}`, `overscan/${f.slice(3, -3)}`]) {
    if (got.has(alias) && got.get(alias) !== want) {
      bad.push(`${alias}: resolves to ${got.get(alias)}, not ${want}`);
    }
  }
}

if (bad.length) {
  console.error(`FAIL  ${bad.length} of ${specs.length} specifiers do not resolve from a consumer:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK  ${specs.length} specifiers resolve from a consumer (${modules.length} ov-*.js modules)`);
