import { createApp, h, ref } from 'vue';
import { OvChart, OvGauge, OvSegment, OvTransport } from '../../src/vue/index.js';

const results = {};
createApp({
  render() {
    return h('div', null, [
      h(OvChart, { id: 'c', mode: 'line', min: '0', max: '100', values: [10, null, 30] }),
      h(OvGauge, { id: 'g', min: '0', max: '100', value: null }),
      h(OvSegment, { id: 's', digits: '4', value: '01.50' }),
      h(OvTransport, { id: 't', duration: '10', onPlay: () => { results.playFired = true; } }),
    ]);
  },
}).mount('#app');

setTimeout(() => {
  const c = document.getElementById('c'), g = document.getElementById('g'),
        s = document.getElementById('s'), t = document.getElementById('t');
  results.chartPropIsArray = Array.isArray(c.values);
  results.chartRawProp = c._prop_values;
  results.chartLabel = c.getAttribute('aria-label');
  results.chartAttrAbsent = !c.hasAttribute('values');
  results.segDigitsAttr = s.getAttribute('digits');
  results.gaugeLabel = g.getAttribute('aria-label');
  results.segLabel = s.getAttribute('aria-label');
  t.dispatchEvent(new CustomEvent('ov:play'));
  setTimeout(() => { window.__RESULTS__ = results; }, 20);
}, 300);
