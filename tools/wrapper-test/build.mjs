/* Build the wrapper conformance apps for React, Vue and Svelte.
 *
 * ⭐ WHY THIS EXISTS RATHER THAN A UNIT TEST. The bug that mattered most in the
 * wrappers could not be seen from the source at all: React 19 threw "Cannot set
 * property digits of #<OvSegment> which has only a getter" and took down the
 * ENTIRE tree, because all three frameworks set a prop as a PROPERTY when the
 * name exists on the element, and this kit has 47 getter-only properties whose
 * names collide with real attributes. Nothing short of really rendering in
 * really each framework would have found it.
 *
 *     node tools/wrapper-test/build.mjs
 *     python3 tools/serve.py 8137
 *     open /tmp/react.html, /tmp/vue.html, /tmp/svelte.html
 *
 * Each page leaves window.__RESULTS__ for inspection. Output goes to tmp/,
 * which is gitignored: these bundles are ~1.3MB of framework.
 */
import * as esbuild from 'esbuild';
import { compile } from 'svelte/compiler';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'tmp';
mkdirSync(OUT, { recursive: true });

const sveltePlugin = {
  name: 'svelte',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      try {
        const { js, warnings } = compile(source, { filename: args.path, generate: 'client' });
        return { contents: js.code, warnings: warnings.map((w) => ({ text: w.message })) };
      } catch (e) {
        return { errors: [{ text: `${args.path}: ${e.message}` }] };
      }
    });
  },
};

const common = {
  bundle: true, format: 'esm', conditions: ['browser'],
  define: { 'process.env.NODE_ENV': '"development"' },
};

await esbuild.build({ ...common, entryPoints: ['tools/wrapper-test/react-test.jsx'],
  outfile: `${OUT}/react.js`, loader: { '.jsx': 'jsx' } });
await esbuild.build({ ...common, entryPoints: ['tools/wrapper-test/vue-test.js'],
  outfile: `${OUT}/vue.js`,
  define: { ...common.define, __VUE_OPTIONS_API__: 'true',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } });
await esbuild.build({ ...common, entryPoints: ['tools/wrapper-test/svelte-test.js'],
  outfile: `${OUT}/svelte.js`, plugins: [sveltePlugin] });

for (const name of ['react', 'vue', 'svelte']) {
  writeFileSync(`${OUT}/${name}.html`,
    `<!doctype html><meta charset="utf-8"><title>${name} wrapper test</title>\n`
    + `<link rel="stylesheet" href="../src/overscan.css">\n`
    + `<div id="app"></div>\n<script type="module" src="${name}.js"></script>\n`);
}

/* 🔴 All 35, not just the four the apps use. They are generated, so a template
 * change breaks all of them at once or none of them. */
let ok = 0;
const bad = [];
for (const f of (await import('node:fs')).readdirSync('src/svelte')) {
  if (!f.endsWith('.svelte')) continue;
  try { compile(readFileSync(`src/svelte/${f}`, 'utf8'), { filename: f, generate: 'client' }); ok += 1; }
  catch (e) { bad.push(`${f}: ${e.message}`); }
}
if (bad.length) { console.error('svelte components failed to compile:', bad); process.exit(1); }
console.log(`built react, vue, svelte into ${OUT}/ and compiled all ${ok} svelte components`);
