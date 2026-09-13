/* Overscan.keys - hotkeys with SCOPES and CHORDS.
 *
 * The gap, in hotkeys-js terms: "so the same key can mean two
 * things in two contexts". A kit that draws consoles and gives them one flat
 * global keymap has not built a console, it has built a picture of one.
 *
 * ── Scopes ───────────────────────────────────────────────────────────────
 *
 * A binding belongs to a scope, and only the ACTIVE scope's bindings fire.
 * Scope is resolved from the DOM, not from a variable: the innermost
 * `[data-ov-scope]` ancestor of whatever has focus wins. That matters because
 * it means the scope follows the user rather than the application's idea of
 * where the user is, and those two drift apart the moment anything is
 * focusable that the application did not expect.
 *
 *   <div data-ov-scope="map">   … g = go to grid
 *   <div data-ov-scope="log">   … g = go to bottom
 *
 * The 'global' scope is always considered, and always LAST, so a scope can
 * shadow a global binding without unbinding it.
 *
 * ── Chords ───────────────────────────────────────────────────────────────
 *
 * A chord is a sequence: `ctrl+x s`. The first key arms the chord and the
 * second completes it.
 *
 * 🔴 AN ARMED CHORD IS VISIBLE AND CANCELLABLE. A prefix that silently
 * swallows the next keystroke is a mode, and an invisible mode is the oldest
 * interface failure there is. So arming dispatches `ov:chord` with the pending
 * prefix and the candidates, Escape always cancels, and the arm times out on
 * its own. The demo renders that into a strip; any consumer can.
 *
 * ⚠️ TYPING IS NOT COMMANDING. Bindings never fire while focus is in a text
 * input, a textarea or anything contenteditable, unless the binding declares
 * `whileTyping`. A console that steals `s` from a search box is worse than a
 * console with no shortcuts.
 */

import './ov-core.js';

(() => {
  const bindings = [];          // {scope, keys:[norm], run, description, whileTyping}
  let pending = [];             // the chord prefix currently armed
  let timer = 0;
  const CHORD_MS = 1800;

  /* A key event as a comparable string. Order is fixed so `ctrl+shift+k` and
   * `shift+ctrl+k` are the same binding. */
  function norm(e) {
    let k = e.key;
    if (k === ' ') k = 'space';
    // A single letter compares lowercase, so shift+k is 'shift+k' rather than
    // depending on whether the layout produced 'K'.
    const letter = k.length === 1 && /[a-z0-9]/i.test(k);
    if (letter) k = k.toLowerCase();

    // ⚠️ PUNCTUATION ALREADY ENCODES ITS OWN SHIFT. Pressing shift and / on a
    // US layout produces the key '?', so recording it as 'shift+?' means a
    // binding for '?' can never match, and a binding for 'shift+/' can never
    // match either because '/' is not what arrived. Only letters and digits
    // keep the shift modifier; for everything else the character IS the
    // shifted form, and which physical keys produced it is the layout's
    // business rather than ours.
    const keepShift = e.shiftKey && (letter || k.length > 1);

    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (keepShift) parts.push('shift');
    parts.push(k);
    return parts.join('+');
  }

  /* ⚠️ Only the MODIFIERS are case-folded. `KeyboardEvent.key` is
   * 'Escape', 'ArrowLeft', 'Enter', 'Home' with capitals that are part of the
   * name, so lowercasing the whole spec would make `bind(..., 'Escape', ...)`
   * unmatchable against the 'Escape' that actually arrives. Single characters
   * fold, names do not. */
  function normSpec(spec) {
    const parts = spec.trim().split('+');
    let key = parts.pop();
    if (key.length === 1) key = key.toLowerCase();
    const lower = parts.map((p) => p.toLowerCase());
    const mods = ['ctrl', 'meta', 'alt', 'shift'].filter((m) => lower.includes(m));
    return [...mods, key].join('+');
  }

  function typing(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    // A checkbox is not typing. A search field is.
    return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
  }

  /* The innermost declared scope containing focus, then 'global'. Resolved
   * from the DOM so the scope follows the user. */
  function activeScopes() {
    const out = [];
    let n = document.activeElement;
    while (n && n !== document.documentElement) {
      const s = n.getAttribute && n.getAttribute('data-ov-scope');
      if (s) out.push(s);
      n = n.parentElement;
    }
    out.push('global');
    return out;
  }

  function announce(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  function disarm(reason) {
    if (!pending.length) return;
    pending = [];
    clearTimeout(timer);
    announce('ov:chord', { pending: [], candidates: [], reason });
  }

  function candidates(scopes, prefix) {
    return bindings.filter((b) =>
      scopes.includes(b.scope)
      && b.keys.length > prefix.length
      && prefix.every((k, i) => b.keys[i] === k));
  }

  function handle(e) {
    // A modifier on its own is never a binding and must not disarm a chord:
    // holding ctrl to press the second key of `ctrl+x s` would cancel it.
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

    const key = norm(e);
    if (key === 'Escape' && pending.length) {
      e.preventDefault();
      disarm('cancelled');
      return;
    }

    const scopes = activeScopes();
    const isTyping = typing(document.activeElement);
    const next = [...pending, key];

    // An exact match, innermost scope first, so a scope shadows global.
    for (const scope of scopes) {
      const hit = bindings.find((b) =>
        b.scope === scope
        && b.keys.length === next.length
        && b.keys.every((k, i) => k === next[i]));
      if (hit && (!isTyping || hit.whileTyping)) {
        e.preventDefault();
        disarm('fired');
        hit.run(e);
        announce('ov:key', { scope, keys: hit.keys, description: hit.description });
        return;
      }
    }

    // No exact match. Does this ARM a longer chord?
    const more = candidates(scopes, next);
    if (more.length && !isTyping) {
      e.preventDefault();
      pending = next;
      clearTimeout(timer);
      // 🔴 The arm times out. A prefix that waits for ever is a mode you
      // cannot leave, and the user may simply have walked away.
      timer = setTimeout(() => disarm('timeout'), CHORD_MS);
      announce('ov:chord', {
        pending: [...pending],
        candidates: more.map((b) => ({ keys: b.keys, description: b.description })),
        reason: 'armed',
      });
      return;
    }

    // A dead end after arming is a cancellation, and says so rather than
    // silently eating the keystroke.
    if (pending.length) { e.preventDefault(); disarm('no match'); }
  }

  /* bind('map', 'ctrl+x s', fn, 'save the view')
   * bind('global', '?', fn, 'show keys')
   * bind('log', 'Escape', fn, 'stop following')
   *
   * Returns an unbind function. */
  function bind(scope, spec, run, description = '', opts = {}) {
    const keys = spec.trim().split(/\s+/).map(normSpec);
    const entry = { scope, keys, run, description, whileTyping: !!opts.whileTyping };
    bindings.push(entry);
    return () => {
      const i = bindings.indexOf(entry);
      if (i >= 0) bindings.splice(i, 1);
    };
  }

  /* Everything currently bound, for a help panel that is generated rather
   * than written: a keymap documented by hand goes stale the first time
   * someone adds a binding. */
  function list(scope) {
    return bindings
      .filter((b) => !scope || b.scope === scope)
      .map((b) => ({ scope: b.scope, keys: b.keys, description: b.description }));
  }

  document.addEventListener('keydown', handle, true);

  Object.assign(window.Overscan, { keys: { bind, list, disarm } });
})();

export const { keys } = window.Overscan;
