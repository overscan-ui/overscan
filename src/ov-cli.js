/* <ov-cli> - a command line.
 *
 * The default theme is called `terminal` and until now you could not type into
 * it. <ov-log> appends; this accepts.
 *
 * ⭐ THE LINE THAT MATTERS IS CURSOR ADDRESSING. The distinction: a
 * program that only appends is a different thing from one that paints a screen.
 * This is the appending half, deliberately, and it says so. Painting a screen
 * is what <ov-grid> is for, and nothing here drives it yet.
 *
 * Three behaviours, and the third is the one this kit exists for:
 *
 * 1. It echoes WHAT WAS RUN, not what was typed. If input is normalised, the
 *    echo shows the normalised form, because an echo that shows your typing
 *    while running something else is a display disagreeing with its machine.
 * 2. A failure says WHY. "error" is not a message.
 * 3. TAB COMPLETION DOES NOT GUESS. Ambiguous input completes only as far as
 *    the common prefix and then lists the candidates. Silently picking the
 *    first match is the same invention as a readout drawing a number it does
 *    not have.
 */

import { define } from './ov-core.js';

/* ⚠️ WRAPPED IN AN IIFE, and every file in this kit should be.
 *
 * These load as CLASSIC scripts, not modules, which means every top-level
 * `const`, `let`, `class` and `function` lands in ONE shared global lexical
 * scope. Two files declaring the same name is a SyntaxError that kills the
 * second file outright: no custom element defined, no error at the element,
 * just a tag that never upgrades and renders as an empty box.
 *
 * That is exactly how this was found. `const LINES` here collided with
 * `const LINES` in demo/fixtures.js, ov-waterfall.js never executed, and the
 * symptom was a transparent panel with the page's field showing through it.
 * Nothing pointed at the real cause until an error listener was added to the
 * page by hand.
 *
 * `customElements.define` works perfectly well from inside a closure, so
 * there is no cost to this. tools/collisions.py checks for it.
 */
(() => {


/* When the theme names a per-character effect, a line is rendered through
 * <ov-text> so its characters resolve individually, instead of the line-level
 * mask in .ov-out. cyber decodes: the letters cycle and settle rather than the
 * line simply appearing. */
function ovLineInto(host, row, text) {
  const fx = getComputedStyle(host).getPropertyValue('--ov-text-char').trim();
  if (fx && fx !== 'none' && customElements.get('ov-text')) {
    const t = document.createElement('ov-text');
    t.setAttribute('effect', fx);
    t.setAttribute('text', text);
    row.append(t);
    return;
  }
  row.classList.add('ov-out');
  const inner = document.createElement('span');
  inner.textContent = text;
  row.append(inner);
}

class OvCli extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.history = [];
    this.at = 0;
    this.commands = (this.getAttribute('commands') || '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    this.out = document.createElement('div');
    this.out.className = 'ov-cli__out';
    this.out.setAttribute('role', 'log');
    this.out.setAttribute('aria-live', 'polite');

    const line = document.createElement('div');
    line.className = 'ov-cli__line';
    const prompt = document.createElement('span');
    prompt.className = 'ov-cli__prompt';
    prompt.textContent = this.getAttribute('prompt') || '>';
    prompt.setAttribute('aria-hidden', 'true');
    this.input = document.createElement('input');
    this.input.className = 'ov-cli__input';
    /* ⚠️ A NAME AS WELL AS A LABEL. The accessible name was always there, but
     * a form field with neither `id` nor `name` is flagged by the browser
     * itself, and autofill has nothing to key on. `name` costs nothing here
     * and the element may legitimately appear more than once on a page, so it
     * is a name rather than a document-unique id. */
    this.input.name = this.getAttribute('label') || 'command';
    this.input.setAttribute('aria-label', this.getAttribute('label') || 'command');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    line.append(prompt, this.input);

    this.append(this.out, line);
    this.input.addEventListener('keydown', (e) => this.key(e));

    // A shell that opens empty is a shell that has not booted. The banner is
    // the session you walked in on.
    const banner = (this.getAttribute('banner') || '').split('|').filter(Boolean);
    banner.forEach((text, i) => {
      const kind = text.startsWith('!') ? 'bad' : text.startsWith('.') ? 'dim' : null;
      setTimeout(() => this.say(text.replace(/^[!.]/, ''), kind),
        i * Number(this.getAttribute('banner-step') || 220));
    });
    this.addEventListener('pointerdown', (e) => {
      if (e.target === this) this.input.focus();
    });
  }

  key(e) {
    if (e.key === 'Enter') { this.run(this.input.value); this.input.value = ''; return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.history.length) return;
      this.at = Math.max(0, this.at - 1);
      this.input.value = this.history[this.at];
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.at = Math.min(this.history.length, this.at + 1);
      this.input.value = this.history[this.at] ?? '';
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); this.complete(); }
  }

  complete() {
    const typed = this.input.value;
    const head = typed.split(/\s+/)[0] ?? '';
    const hits = this.commands.filter((c) => c.startsWith(head));
    if (!hits.length) { this.say(`no command starts with "${head}"`, 'bad'); return; }
    if (hits.length === 1) { this.input.value = `${hits[0]} `; return; }

    // Ambiguous. Complete only as far as everything agrees, then show the
    // candidates rather than picking one.
    let prefix = hits[0];
    for (const h of hits) {
      while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    this.input.value = prefix;
    this.say(hits.join('   '), 'dim');
  }

  run(raw) {
    // Normalised once, and the echo shows the normalised form, because that is
    // what will actually run.
    const cmd = raw.trim().replace(/\s+/g, ' ');
    if (!cmd) return;
    this.history.push(cmd);
    this.at = this.history.length;
    this.say(`${this.getAttribute('prompt') || '>'} ${cmd}`, 'echo');

    const name = cmd.split(' ')[0];
    if (this.commands.length && !this.commands.includes(name)) {
      // Says why, and what would have worked.
      const near = this.commands.filter((c) => c.startsWith(name[0] ?? ''));
      this.say(`unknown command "${name}"`
        + (near.length ? `. did you mean ${near.join(' or ')}?` : ''), 'bad');
      return;
    }
    this.dispatchEvent(new CustomEvent('ov:command', {
      detail: { command: cmd, say: (t, k) => this.say(t, k) },
      bubbles: true,
    }));
  }

  /* Every line runs the theme's own arrival, so a terminal types its output and
   * an Esper scan reads it across. The inner span is required: .ov-out clips
   * its child, and clipping the row itself would take the row out of the flow
   * of the scroller. */
  say(text, kind) {
    const row = document.createElement('div');
    row.className = `ov-cli__row${kind ? ` is-${kind}` : ''}`;
    ovLineInto(this, row, text);
    this.out.append(row);
    this.out.scrollTop = this.out.scrollHeight;
  }
}

define('ov-cli', OvCli);
})();
