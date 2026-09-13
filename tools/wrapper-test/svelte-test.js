import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app') });

setTimeout(() => {
  const c = document.getElementById('c'), g = document.getElementById('g'),
        s = document.getElementById('s'), t = document.getElementById('t');
  const results = {
    chartPropIsArray: Array.isArray(c.values),
    chartRawProp: c._prop_values,
    chartLabel: c.getAttribute('aria-label'),
    chartAttrAbsent: !c.hasAttribute('values'),
    segDigitsAttr: s.getAttribute('digits'),
    gaugeLabel: g.getAttribute('aria-label'),
    segLabel: s.getAttribute('aria-label'),
  };
  t.dispatchEvent(new CustomEvent('ov:play'));
  setTimeout(() => { results.playFired = !!window.__PLAY__; window.__RESULTS__ = results; }, 20);
}, 300);
