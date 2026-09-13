import { createRoot } from 'react-dom/client';
import { createElement as h, useState } from 'react';
import { OvChart, OvGauge, OvSegment, OvTransport } from '../../src/react/index.js';

const results = {};
const root = document.getElementById('app');

function App() {
  return h('div', null,
    h(OvChart, { id: 'c', mode: 'line', min: '0', max: '100', values: [10, null, 30] }),
    h(OvGauge, { id: 'g', min: '0', max: '100', value: null }),
    h(OvSegment, { id: 's', digits: '4', value: '01.50' }),
    h(OvTransport, { id: 't', duration: '10', onPlay: () => { results.playFired = true; } }),
  );
}

createRoot(root).render(h(App));

setTimeout(() => {
  const c = document.getElementById('c');
  const g = document.getElementById('g');
  const s = document.getElementById('s');
  const t = document.getElementById('t');
  results.chartPropIsArray = Array.isArray(c.values);
  results.chartRawProp = c._prop_values;
  results.chartLabel = c.getAttribute('aria-label');
  results.chartAttrAbsent = !c.hasAttribute('values');
  results.gaugeLabel = g.getAttribute('aria-label');
  results.segLabel = s.getAttribute('aria-label');
  t.dispatchEvent(new CustomEvent('ov:play'));
  setTimeout(() => {
    window.__RESULTS__ = results;
    document.title = 'done';
  }, 20);
}, 300);
