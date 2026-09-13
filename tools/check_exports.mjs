/* Every subpath this package advertises must resolve to a file that exists.
 *
 * 🔴 THIS GATE EXISTS BECAUSE THE OBVIOUS SPELLING IS WRONG. The first cut of
 * the per-element export was `"./ov-*": "./src/ov-*.js"`, which looks right
 * and is not: for the request `overscan/ov-radar.js` the star captures
 * `radar.js`, so the target expands to `src/ov-radar.js.js` and every
 * per-element import in the kit 404s. The correct key is `"./ov-*.js"`.
 * Nothing in the repo could have caught that, because nothing in the repo
 * imports the package by name.
 *
 * 🔴 AND THE SHORT SPELLING NEEDS TWO PATTERNS, NOT ONE. `overscan/radar`
 * and `overscan/radar.js` both have to land on src/ov-radar.js, and a single
 * `"./*"` cannot do it: for `./radar.js` the star captures `radar.js` and the
 * target expands to src/ov-radar.js.js, the same bug as above wearing a
 * different key. So `"./*.js"` carries the extension case and `"./*"` the
 * bare one. Node picks between two patterns with the same prefix by the
 * LONGER KEY (PATTERN_KEY_COMPARE), which is why `./*.js` wins for a request
 * ending in .js, and why resolve() below has to implement that tiebreak
 * rather than taking the first match: without it this gate disagrees with
 * Node about which pattern applies, and a gate that models the algorithm
 * wrongly is worse than no gate.
 *
 * Run: node tools/check_exports.mjs
 * Exits non-zero, naming each subpath that does not resolve.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* The subset of the exports algorithm this package uses: exact keys, and
 * patterns with ONE star. Longest matching prefix wins, as Node does it. */
function resolve(subpath) {
  const exp = pkg.exports;
  if (typeof exp !== 'object') return null;
  const pick = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      // Conditions, in the order a bundler would try them.
      for (const c of ['types', 'svelte', 'import', 'module', 'default']) {
        if (c in value) return pick(value[c]);
      }
    }
    return null;
  };
  if (Object.hasOwn(exp, subpath)) return pick(exp[subpath]);
  let best = null;
  for (const key of Object.keys(exp)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const before = key.slice(0, star);
    const after = key.slice(star + 1);
    if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue;
    if (subpath.length < before.length + after.length) continue;
    // Node's PATTERN_KEY_COMPARE: longest prefix first, then longest key.
    if (best && (before.length < best.before.length
                 || (before.length === best.before.length
                     && key.length <= best.key.length))) continue;
    best = { key, before, after };
  }
  if (!best) return null;
  const captured = subpath.slice(best.before.length, subpath.length - best.after.length);
  const target = pick(pkg.exports[best.key]);
  return target === null ? null : target.replace('*', captured);
}

const checks = [];

// 1. The fixed entry points.
const FIXED = ['.', './overscan.css', './custom-elements.json', './react', './vue', './svelte'];
for (const sub of FIXED) {
  checks.push([sub, resolve(sub)]);
}

// 2. Every element, in ALL THREE SPELLINGS a consumer may write. The short
//    one is what the home page advertises; the other two stay valid because
//    people type what they see in a file listing.
const elements = readdirSync(join(root, 'src'))
  .filter((f) => f.startsWith('ov-') && f.endsWith('.js'))
  .sort();
for (const file of elements) {
  const bare = file.slice(3, -3);                 // ov-radar.js -> radar
  for (const sub of [`./${file}`, `./${bare}.js`, `./${bare}`]) {
    checks.push([sub, resolve(sub)]);
  }
}

// 2b. ⚠️ THE SHORT SPELLING SHARES A NAMESPACE WITH THE FIXED ENTRY POINTS.
//     `"./*"` matches everything, so a future src/ov-react.js would be
//     unreachable as `overscan/react`: the exact key wins and the consumer
//     silently gets the React wrapper instead of the element. Exact keys are
//     right to win, so the answer is to refuse the NAME, here, at build time,
//     rather than ship an import that resolves to the wrong file.
const reserved = new Set(FIXED.map((s) => s.replace(/^\.\/?/, '')).filter(Boolean));
const shadowed = elements
  .map((f) => f.slice(3, -3))
  .filter((bare) => reserved.has(bare) || reserved.has(`${bare}.js`));

// 3. The escape hatch, which must keep working.
checks.push(['./src/ov-chart.js', resolve('./src/ov-chart.js')]);

const bad = [];
for (const bare of shadowed) {
  bad.push(`./${bare}  ->  src/ov-${bare}.js is unreachable as "overscan/${bare}": `
           + `the exact export key "./${bare}" shadows it. Rename the module.`);
}
for (const [sub, target] of checks) {
  if (!target) { bad.push(`${sub}  ->  NO EXPORT MATCHES`); continue; }
  if (!existsSync(join(root, target))) bad.push(`${sub}  ->  ${target}  (MISSING FILE)`);
}

// 4. Anything shipped must be inside the files list, or npm will not pack it.
const files = pkg.files || [];
const covered = (target) => files.some((f) => target.slice(2).startsWith(f.replace(/\/$/, '')));
for (const [sub, target] of checks) {
  if (target && !covered(target) && !bad.some((b) => b.startsWith(sub + ' '))) {
    bad.push(`${sub}  ->  ${target}  (NOT IN package.json files: it would not ship)`);
  }
}

if (bad.length) {
  console.error(`FAIL  ${bad.length} of ${checks.length} subpaths do not resolve:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK  ${checks.length} subpaths resolve and all ship (${elements.length} elements)`);
