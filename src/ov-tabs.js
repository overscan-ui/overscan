/* Roving tabindex for `.ov-tabs`, applied to markup that already exists.
 *
 * The tab row was CSS-only chrome: correct ARIA roles, correct look, and no
 * keyboard model at all. Every tab was a tab stop and the arrow keys did
 * nothing, which is the exact opposite of what a tablist is supposed to do.
 * <ov-menu> and <ov-tree> already got this right; this brings the tab row up
 * to them.
 *
 * ⚠️ IT ENHANCES MARKUP RATHER THAN REPLACING IT. There is no <ov-tabs>
 * element, because the row is chrome and chrome is CSS in this kit: a custom
 * element here would mean the tab row could only exist where JavaScript ran,
 * and the profile already showed the CSS-only panel is ~100x cheaper than any
 * custom element. So this attaches to `.ov-tabs[role="tablist"]` wherever it
 * finds one, and a page that never loads it still renders and still clicks.
 *
 * The model, which is the WAI-ARIA one and not an invention:
 *
 *   Tab / Shift+Tab   move INTO and OUT of the row, one stop for the whole
 *                     row, landing on the selected tab
 *   Arrows            move between tabs, wrapping
 *   Home / End        first and last
 *   Space / Enter     select, for the case where selection does not follow
 *
 * ⭐ Selection FOLLOWS focus here, which is the right default for a tab row
 * whose panels are already in the document: it makes the row browsable with
 * one key per tab instead of two. It would be the wrong default if selecting
 * a tab were expensive or destructive, which is why `data-ov-manual` turns it
 * off rather than the other way round.
 */

import './ov-core.js';

(() => {
  const SEL = '.ov-tabs[role="tablist"]';

  function tabs(row) {
    return [...row.querySelectorAll('[role="tab"]')]
      .filter((t) => !t.disabled && t.getAttribute('aria-hidden') !== 'true');
  }

  function select(row, tab, focus = true) {
    for (const t of tabs(row)) {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      // The roving part: exactly one tab stop for the whole row.
      t.tabIndex = on ? 0 : -1;
      // A tab that controls a panel shows and hides it. If it controls
      // nothing, this does nothing, which is correct: the row is then
      // decorative and the page owns what a tab means.
      const id = t.getAttribute('aria-controls');
      if (id) {
        const panel = document.getElementById(id);
        // 🔴 [hidden] is escaped in this kit's CSS because `display` outranks
        // it. Setting the property rather than the attribute is the same fix
        // from the other side.
        if (panel) panel.hidden = !on;
      }
    }
    if (focus) tab.focus();
    row.dispatchEvent(new CustomEvent('ov:tab', {
      detail: { tab, label: (tab.textContent || '').trim() },
      bubbles: true,
    }));
  }

  function move(row, from, delta) {
    const list = tabs(row);
    if (!list.length) return;
    const i = list.indexOf(from);
    const next = list[(i + delta + list.length) % list.length];
    // Selection follows focus unless the row asks for manual activation.
    if (row.hasAttribute('data-ov-manual')) { next.tabIndex = 0; from.tabIndex = -1; next.focus(); }
    else select(row, next);
  }

  function attach(row) {
    if (row.dataset.ovKeys) return;
    row.dataset.ovKeys = '1';

    const list = tabs(row);
    if (!list.length) return;
    // Whatever the markup says is selected keeps the tab stop; failing that,
    // the first tab. Never zero stops, which would strand the row.
    const current = list.find((t) => t.getAttribute('aria-selected') === 'true') || list[0];
    for (const t of list) t.tabIndex = t === current ? 0 : -1;

    row.addEventListener('keydown', (e) => {
      const t = e.target.closest('[role="tab"]');
      if (!t || !row.contains(t)) return;
      // The row may be vertical; both axes move, which is what a reader with
      // a rotated row expects and costs nothing here.
      const map = {
        ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1,
      };
      if (e.key in map) { e.preventDefault(); move(row, t, map[e.key]); return; }
      if (e.key === 'Home') { e.preventDefault(); select(row, tabs(row)[0]); return; }
      if (e.key === 'End') {
        e.preventDefault();
        const all = tabs(row);
        select(row, all[all.length - 1]);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(row, t); }
    });

    row.addEventListener('click', (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t && row.contains(t)) select(row, t);
    });
  }

  function scan(root = document) {
    for (const row of root.querySelectorAll(SEL)) attach(row);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }

  // A row added later still works, which matters for a kit whose windows and
  // dialogs mount content after load.
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches(SEL)) attach(n);
        else if (n.querySelectorAll) scan(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  Object.assign(window.Overscan, { tabs: { attach, scan, select } });
})();

export const { tabs } = window.Overscan;
