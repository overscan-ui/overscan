/* <ov-ansi> - ANSI escape codes, rendered honestly.
 *
 * A log line with SGR codes renders as literal escape text today, which is the
 * smaller problem. The larger one is what a themed kit should do with colours
 * it did not choose.
 *
 * ⭐ ANSI'S PALETTE IS NOT THIS THEME'S PALETTE, AND MAPPING ONE ONTO THE OTHER
 * IS A CHOICE. The eight basic colours map to tokens, and that mapping is
 * declared in CSS rather than hidden in script. But 256-colour and truecolor
 * codes name a specific colour that a monochrome phosphor theme simply does not
 * have, and SILENTLY APPROXIMATING ONE is the same invention as a readout
 * drawing a value it cannot represent.
 *
 * So those are counted and reported: the text is shown in the nearest token and
 * the element says how many colours it could not honour, so a reader can see
 * that the colour on screen is the kit's opinion rather than the sender's.
 */

import { define } from './ov-core.js';

const BASIC = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const ESC = String.fromCharCode(27);

class OvAnsi extends HTMLElement {
  static observedAttributes = ['text'];

  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  render() {
    const src = String(this.getAttribute('text') ?? this.textContent ?? '')
      .split(ESC).join('');
    let approx = 0;
    let out = '';
    let cls = [];

    const parts = src.split(/\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (!parts[i]) continue;
        const esc = parts[i].replace(/[&<>]/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        out += cls.length ? `<span class="${cls.join(' ')}">${esc}</span>` : esc;
        continue;
      }
      const codes = parts[i].split(';').filter(Boolean).map(Number);
      if (!codes.length) { cls = []; continue; }
      for (let k = 0; k < codes.length; k++) {
        const c = codes[k];
        if (c === 0) cls = [];
        else if (c === 1) cls.push('ov-ansi--bold');
        else if (c === 2) cls.push('ov-ansi--dim');
        else if (c === 7) cls.push('ov-ansi--rev');
        else if (c >= 30 && c <= 37) cls.push(`ov-ansi--${BASIC[c - 30]}`);
        else if (c >= 90 && c <= 97) cls.push(`ov-ansi--${BASIC[c - 90]}`, 'ov-ansi--bright');
        else if (c === 38 || c === 48) {
          // 256-colour or truecolor. This theme does not have that colour.
          approx += 1;
          cls.push('ov-ansi--approx');
          k += codes[k + 1] === 5 ? 2 : codes[k + 1] === 2 ? 4 : 0;
        } else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) {
          // A background colour. These fell through every branch and were
          // DROPPED, silently, which is the one thing the header says this
          // element does not do. The theme has no background for them either,
          // so they are counted and approximated like 256-colour. Found by
          // ov-term, which shares these classes and counted them from the start.
          approx += 1;
          cls.push('ov-ansi--approx');
        }
      }
    }

    this.innerHTML = out;
    this.toggleAttribute('data-ov-approx', approx > 0);
    if (approx) {
      this.setAttribute('data-ov-approx-n',
        `${approx} colour${approx === 1 ? '' : 's'} outside this theme, approximated`);
    }
  }
}

define('ov-ansi', OvAnsi);

export { OvAnsi };
