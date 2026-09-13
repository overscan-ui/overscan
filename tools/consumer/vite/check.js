// Imported FIRST by every page, so it sees console.error from modules that
// evaluate after it. No bare specifiers: the no-build control loads it raw.
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a); };
// An async connectedCallback that throws is an unhandled rejection, not a
// console.error, so it would otherwise pass for silence.
addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.stack || e.reason}`));
addEventListener('error', (e) => errors.push(`error: ${e.message}`));

const results = [];
const ok = (name, cond, got) => results.push({ name, pass: !!cond, got });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function report(label) {
  const failed = results.filter((x) => !x.pass).length;
  document.getElementById('out').textContent = [
    `[${label}]`,
    ...results.map((x) => `${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : '  got ' + JSON.stringify(x.got)}`),
    '',
    `GATE: ${failed ? 'FAIL' : 'PASS'}`,
  ].join('\n');
}

// Shader element: the verdict is what ov-gl says about its own source and
// program, plus the network, never just "a canvas exists".
export async function checkField(label) {
  await customElements.whenDefined('ov-field');
  const f = document.getElementById('f');
  ok('ov-field upgraded', f.constructor !== HTMLElement, f.constructor.name);

  // setTimeout, not rAF: headless virtual time never ticks rAF.
  for (let i = 0; i < 60 && !f.hasAttribute('data-ov-shader'); i++) await wait(100);
  // The pool lends a context after the source arrives AND the page's arrival
  // hold ends; poll for the canvas instead of guessing how long that takes.
  const t0 = performance.now();
  for (let i = 0; i < 80 && !(f.querySelector('canvas') && f.prog); i++) await wait(100);
  ok(`timing: canvas+program after ${Math.round(performance.now() - t0)}ms`, true, null);

  // HOW the shader arrives is not the contract (a fetch once, a module now,
  // inlined text in a bundle). What must hold: it arrived, it linked, it has
  // a canvas to draw into, and nothing shader-shaped failed on the network.
  const state = f.getAttribute('data-ov-shader');
  ok('data-ov-shader is ok', state === 'ok', state);
  ok('a context was lent: the canvas is inside the element', !!f.querySelector('canvas'), f.innerHTML.slice(0, 60));
  ok('the program linked', !!f.prog, f.prog);
  const badShaderRequests = performance.getEntriesByType('resource')
    .filter((e) => /shader|\.glsl/.test(e.name) && e.responseStatus && e.responseStatus !== 200)
    .map((e) => [e.name.replace(location.origin, ''), e.responseStatus]);
  ok('no shader request failed', badShaderRequests.length === 0, badShaderRequests);
  ok('no errors or unhandled rejections at all', errors.length === 0, errors);
  report(label);
}

// Wrapper cost: importing ONE React component should register that element
// and not the other seventy-eight.
export async function checkReact(label) {
  for (let i = 0; i < 30 && !customElements.get('ov-radar'); i++) await wait(100);
  await wait(300);
  ok('ov-radar registered', !!customElements.get('ov-radar'), null);
  const others = ['ov-field', 'ov-chart', 'ov-verifier', 'ov-quorum', 'ov-segment'].filter((n) => customElements.get(n));
  // ⚠️ A DEV SERVER NEVER TREE-SHAKES. Vite dev pre-bundles the whole wrapper
  // index, so every element registers there whatever the package does; the
  // one-component cost is a production-build property and is asserted there.
  if (/dev/.test(label)) {
    ok(`unused elements: not asserted in dev, which never tree-shakes (${others.length} of 5 registered)`, true, others);
  } else {
    ok('unused elements NOT registered (only OvRadar imported)', others.length === 0, others);
  }
  const scripts = performance.getEntriesByType('resource').filter((e) => /\.js(\?|$)/.test(e.name));
  ok('script transfer recorded', true, null);
  results[results.length - 1].name = `scripts loaded: ${scripts.length}, encoded bytes ${scripts.reduce((s, e) => s + (e.encodedBodySize || 0), 0)}`;
  report(label);
}
