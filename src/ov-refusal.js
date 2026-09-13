/* The refusal protocol, shared by every widget. See REFUSAL.md.
 *
 * This is one file rather than a copy per widget on purpose: the failure the
 * protocol exists to prevent is each readout inventing its own idea of what to
 * do with a value it cannot draw. Load it before any widget.
 */
window.OverscanRefusal = (() => {
  /* Two kinds of state, and the split is the useful part.
   *
   * A REFUSAL withholds the number, because showing one would be a lie.
   * A QUALIFIER shows the number and says something true about it, because
   * withholding would also be a lie.
   *
   * A study of degraded screens found five states and this protocol had five
   * reasons, and they were not the same five. These are the three that were
   * missing, and
   * all three are qualifiers: the reading is real, and something about its
   * provenance is not what the reader would otherwise assume.
   */
  const REASONS = {
    unrepresentable: 'cannot be shown on this display',
    overflow: 'too many cells for this display',
    'out-of-range': 'outside the instrument range',
    unknown: 'no reading',
    // Made on a different frame than the one it would be drawn on. Added for
    // ov-plate: a detection box from an earlier (or later) frame sits where
    // the target was then, so it is withheld rather than shown marked. Not
    // `out-of-range`, which would make "off the edge" and "wrong moment" one
    // answer to two questions.
    'other-frame': 'belongs to a different frame',
    // 🔴 NOT "no reading": no INSTRUMENT. The sensor cannot detect this class
    // of thing at all, so there is nothing here to have a reading about, and
    // the absence is a fact about the equipment rather than about the world.
    // METAR writes it "///" and keeps it apart from a sensor that looked and
    // found nothing (FAA JO 7900.5E §13.57-58). Ruled 2026-09-11.
    incapable: 'no sensor for this here',
  };

  const QUALIFIERS = {
    stale: (r) => (r.series
      ? `stale, nothing new for ${r.age} seconds`
      : `stale, ${r.age} seconds old`),
    // Reading, and fresh, and not moving: a value that has not left its
    // deadband for a stated time is SUSPECT, not steady. A stuck transmitter
    // sends a perfectly fresh copy of the same number (NASA display standard
    // F.4.3.1(3); SCADA stale detection). Opt-in: see frozenness().
    frozen: (r) => `frozen, unchanged for ${r.held} seconds`,
    // Entered by hand, not measured. Always marked, whatever else is true:
    // an operator's override is a claim, and the display must not let it
    // pass for a reading.
    substituted: (r) => (r.note ? `substituted by hand: ${r.note}` : 'substituted by hand'),
    // Reading, but never calibrated. The number is what the instrument says,
    // which is not the same as what is true.
    uncal: () => 'uncalibrated',
    // Limited before the display ever saw it. The display is not the one
    // clamping, so it must not present the limit as the measurement.
    clamped: (r) => `clamped upstream at ${r.limit ?? 'a limit'}`,
    // Two sources disagree. The display is not entitled to pick one, so it
    // shows that they differ rather than choosing a winner.
    //
    // ⭐ A threshold alone is not a dispute. A pair of readings that differ for
    // an instant is noise; what makes it a disagreement is that it LASTED. So
    // a disputed reading declares and PRINTS its persistence as well as its
    // threshold (Lion Air 610, KNKT §1.6.5: AOA DISAGREE at 10 degrees "for 10
    // continuous seconds"). `for` is seconds; without it the qualifier still
    // reads, because an element may know the threshold and not the dwell.
    disputed: (r) => `disputed, other source reads ${r.other}`
      + (r.for ? `, for ${r.for} seconds` : ''),

    /* ── HOW THE VALUE WAS PRODUCED ──────────────────────────────────────
     * The four above say something about a reading's CONDITION: old, stuck,
     * hand-entered, contradicted. These four say something about its
     * PROVENANCE - what kind of number it is at all - and a reader who assumes
     * "measured" is wrong in a different way each time. Added 2026-09-11.
     */

    // No check has run. NOT a claim that the value is wrong, and NOT a
    // refusal: the number is shown, marked unchecked. NUREG-0700 14.3-5
    // calls this "unvalidated"; WMO's QC flags call it "Not checked".
    // ⚠️ This is the state ov-dose used to draw as a REFUSAL while still
    // showing the number, which broke REFUSAL.md's own rule that a refusal
    // withholds it. ov-coverage's "a rule nobody ever tested" is the same
    // state, and so is a balance whose window has not yet elapsed.
    unchecked: (r) => (r.why ? `unchecked: ${r.why}` : 'unchecked, no check has run'),

    // Computed by a model rather than measured, WITH ITS CAUSE - and the
    // cause is required, because "estimated" alone invites the reader to
    // supply their own. Dead reckoning (IMO), a coasted radar track (ASTERIX
    // CST), a state estimator (NERC), WMO "Estimated".
    // 🔴 UNLIKE `stale`, AN ESTIMATE MOVES. That is what makes it dangerous
    // and what neither `stale` nor `frozen` can express: the Royal Majesty's
    // receiver dead reckoned for hours, fresh and updating the whole way
    // (NTSB MAR-97/01). Distinct from `provisional` (will be revised) and
    // from `substituted` (entered by a person).
    estimated: (r) => (r.by ? `estimated: ${r.by}` : 'estimated, computed rather than measured'),

    // A consolidation of several sources, not a reading from any of them.
    // BEA XL888T §1.6.11 on the vote that killed the aircraft: "This vote is
    // not apparent for the pilots". So the rule and the members are named.
    voted: (r) => `voted, ${r.rule || 'by an undeclared rule'}`
      + (r.members ? ` of ${r.members}` : ''),

    // A default or look-up value sitting in a slot the reader takes for
    // measured (ASTERIX SRC "default height" and its speed look-up table;
    // ECDIS's default safety contour).
    defaulted: (r) => (r.why ? `defaulted: ${r.why}` : 'defaulted, not measured'),

    // Drawn finer than the data it came from was compiled for. The picture
    // gets sharper and the survey does not (IMO ECDIS §6.1, IHO S-52 §3.1.8).
    overscale: (r) => `overscale, compiled for ${r.compiled || 'a coarser scale'}`,

    /* ── AND ONE THAT IS A REFUSAL, NOT A QUALIFIER ──────────────────────
     * `incapable` lives in REASONS below, not here: a sensor that cannot
     * detect this class of thing at all has no number to qualify. METAR
     * writes it "///" and the distinction it protects is DETECTED NONE
     * against UNABLE TO DETECT - the difference between "no thunderstorm"
     * and "no thunderstorm sensor".
     */
  };

  /* Everything a widget needs to decide BEFORE it looks at its own glyph set.
   * Returns a reason, or null when the value is the widget's to draw. */
  /* Staleness on its own, because not every readout can use common().
   *
   * ⚠️ A GAUGE CANNOT. For a segment readout `min`/`max` declare a VALIDITY
   * RANGE and a value outside it is a refusal; for a gauge they declare the
   * AXIS, and a value past the end is over-range, which the gauge shows with
   * data-ov-over rather than by withholding the number. Calling common() from
   * a gauge would therefore convert every over-range reading into a refusal.
   *
   * So the staleness rule lives here, on its own, and common() calls it too.
   * One definition, two callers, and no widget inventing a second idea of what
   * "old" means - which is the whole reason this file exists. */
  function staleness(el, raw) {
    /* 🔴 SUBSTITUTED FIRST. A hand-entered value was never measured, so
     * whether it is old or still says less than that it is not a reading at
     * all; and a hand value never moves, so without this order every one of
     * them would turn "frozen" and hide the fact that matters. Lives here,
     * not in common(), so a gauge (which calls staleness() directly) marks it
     * too. The attribute's value, if any, is the note: who or why. */
    if (el.hasAttribute('substituted')) {
      const note = (el.getAttribute('substituted') || '').trim();
      return { text: raw, qualifier: 'substituted', note: note || null };
    }
    const maxAge = el.getAttribute('max-age');
    const age = el.getAttribute('age');
    if (maxAge && age && Number(age) > Number(maxAge)) {
      return { text: raw, qualifier: 'stale', age: Number(age) };
    }
    // Old first, then stuck: a stale value is already not current, so
    // calling it frozen as well would say less, not more.
    return frozenness(el, raw);
  }

  /* 🔴 OPT-IN, and only on a readout that declares BOTH `deadband` and
   * `frozen-after`. A kit that marked every quiet value suspect would be
   * inventing a fault; a readout that is told what "moving" means for its
   * instrument, and for how long stillness is plausible, can say when that
   * has run out.
   *
   * The clock is the READING clock: time between readings that stayed
   * inside the deadband of the value they started from. A slow creep that
   * adds up past the band counts as movement and restarts it. Evaluated on
   * each reading, so a readout that is never re-read cannot turn frozen;
   * that is a stale reading's job, and max-age already does it. */
  function frozenness(el, raw) {
    const bandRaw = el.getAttribute('deadband');
    const afterRaw = el.getAttribute('frozen-after');
    if (bandRaw === null || afterRaw === null) return null;
    const band = Number(bandRaw), after = Number(afterRaw);
    const n = Number(raw);
    if (!Number.isFinite(band) || band < 0 || !Number.isFinite(after) || after <= 0 || !Number.isFinite(n)) return null;
    const now = performance.now();
    const st = el._ovFrozen;
    if (!st || Math.abs(n - st.ref) > band) {
      el._ovFrozen = { ref: n, since: now };
      return null;
    }
    const held = (now - st.since) / 1000;
    return held >= after ? { text: raw, qualifier: 'frozen', held: Math.floor(held) } : null;
  }

  function common(el, raw, cells) {
    if (raw === null || raw === '' || raw === 'null') return { reason: 'unknown' };

    const stale = staleness(el, raw);
    if (stale) return stale;

    const n = Number(raw);
    if (Number.isFinite(n)) {
      const min = el.getAttribute('min');
      const max = el.getAttribute('max');
      if ((min !== null && n < Number(min)) || (max !== null && n > Number(max))) {
        return { reason: 'out-of-range' };
      }
    }

    if (cells > Number(el.getAttribute('digits') || cells)) {
      return { reason: 'overflow' };
    }

    // Qualifiers, checked after the refusals: a value that cannot be drawn at
    // all is not improved by saying it was uncalibrated.
    if (el.hasAttribute('uncal')) return { text: raw, qualifier: 'uncal' };
    if (el.hasAttribute('clamped')) {
      return { text: raw, qualifier: 'clamped', limit: el.getAttribute('clamped') || null };
    }
    const other = el.getAttribute('disputed');
    if (other !== null && other !== raw) {
      return { text: raw, qualifier: 'disputed', other };
    }
    return null;
  }

  /* Marks the element and names it. The accessible name states the reason and
   * never the value: a display that announces a number it is refusing to show
   * is worse than one that is merely unreadable. */
  function apply(el, r, unit) {
    el.removeAttribute('data-ov-refusal');
    el.removeAttribute('data-ov-qualified');
    el.removeAttribute('data-ov-qualifier-text');
    let label;
    if (r.reason) {
      el.setAttribute('data-ov-refusal', r.reason);
      label = REASONS[r.reason];
    } else if (r.qualifier) {
      const say = QUALIFIERS[r.qualifier](r);
      el.setAttribute('data-ov-qualified', r.qualifier);
      el.setAttribute('data-ov-qualifier-text', say);
      label = `${r.text}${unit ? ' ' + unit : ''}, ${say}`;
    } else {
      label = `${r.text}${unit ? ' ' + unit : ''}`;
    }
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  }

  /* ---- READINGS HANDED IN AS PROPERTIES ---------------------------------
   *
   * An attribute is a string, so a framework cannot pass an array or a null
   * through one: `values="1,2,3"` round-trips through text and `null` arrives
   * as the four-letter word "null". Every widget that takes data therefore
   * also takes it as a PROPERTY, and this is the one place that says what a
   * property is allowed to be. Per-widget parsing is exactly the failure this
   * file exists to prevent.
   *
   * 🔴 `undefined` AND `null` ARE NOT THE SAME ANSWER, and the whole protocol
   * turns on the difference:
   *
   *     undefined  the property was never set. Fall through to `source`, then
   *                to the attribute. This widget is not being driven by props.
   *     null       the property was set, deliberately, to nothing. That is a
   *                DROPOUT and it renders a refusal.
   *
   * Collapsing the two would make `value={maybeMissing}` silently fall back to
   * a stale attribute the moment the feed dropped, which is a readout showing
   * a number nobody measured. That is the one thing this kit does not do.
   */
  function reading(r) {
    if (r === null || r === undefined) return null;
    if (typeof r === 'object' && !Array.isArray(r)) {
      const n = Number(r.value);
      return Number.isFinite(n) ? { value: n, age: r.age ?? null } : null;
    }
    const n = Number(r);
    return Number.isFinite(n) ? { value: n, age: null } : null;
  }

  /* Install a property that holds a reading (or an array of them) and
   * re-renders on write. Stored under a private name so `undefined` stays
   * distinguishable from an explicit `null`. */
  function prop(cls, name) {
    const key = '_prop_' + name;
    Object.defineProperty(cls.prototype, name, {
      get() { return this[key]; },
      set(v) {
        this[key] = v;
        /* {value, age} reflects its age onto the attribute common() already
         * reads, so the staleness qualifier works identically whether a
         * reading arrived from a source, an attribute or a property. One
         * mechanism, three doors. */
        if (v && typeof v === 'object' && !Array.isArray(v) && v.age !== undefined
            && v.age !== null) {
          this.setAttribute('age', String(v.age));
        }
        /* ⚠️ NOT EVERY WIDGET CALLS ITS REDRAW `render`. ov-flap has update(),
         * ov-table has paint(), and a setter that only knew about render()
         * stored the value on those two and redrew NOTHING: the property
         * appeared to work, the display never changed, and no error said so.
         * Ask for the first one the element actually has. */
        if (this.isConnected) {
          const redraw = this.render || this.update || this.paint;
          if (typeof redraw === 'function') redraw.call(this);
        }
      },
      configurable: true,
    });
  }

  /* 🔴 A PROPERTY SET BEFORE THE ELEMENT UPGRADES SHADOWS THE ACCESSOR.
   *
   * React, Vue and Svelte all set properties as soon as they create the node,
   * which can happen before the module defining the element has run. The
   * assignment then lands as an OWN property on the instance, and when the
   * upgrade finally installs the prototype accessor it is masked forever: the
   * setter never fires, nothing re-renders, and the widget shows the attribute
   * value while the app believes it passed data. It looks like a stale widget
   * rather than a broken one, which is why it is worth handling up front.
   *
   * Delete the own property and re-assign it so it goes through the setter. */
  /* Same as prop(), and the ONLY difference is that it declares the property
   * takes a SERIES of readings rather than one.
   *
   * ⚠️ It exists because arity could not be derived honestly. Reading the
   * class body missed ov-spark, whose reader is a shared module-level helper;
   * widening to a proximity window then called ov-cellbar a series because
   * some other property's Array.isArray sat nearby. And `values` vs `value` is
   * a naming habit, not a contract. Two heuristics, two wrong answers, so the
   * fact is stated at the install site where it is unambiguous and greppable.
   */
  function series(cls, name) { prop(cls, name); }

  function upgrade(el, names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(el, name)) {
        const v = el[name];
        delete el[name];
        el[name] = v;
      }
    }
  }

  /* The effective raw value for a widget that reads a STRING.
   *
   * ⚠️ Deliberately does NOT round-trip a string through Number. A segment
   * readout is handed "01.50" and must see "01.50": normalising it to 1.5
   * would be the display quietly rewriting its input, which is the exact
   * failure this protocol exists to refuse. Numbers are stringified, strings
   * pass through. */
  function rawOf(el, name) {
    const v = el['_prop_' + name];
    if (v === undefined) return el.getAttribute(name);
    if (v === null) return null;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const r = reading(v);
      return r === null ? null : String(r.value);
    }
    return String(v);
  }

  /* ── STALENESS FOR A SERIES ───────────────────────────────────────────
   *
   * 🔴 A SERIES MEASURES ARRIVAL, NOT AGE, and that is what separates it from
   * every scalar readout above. A gauge is TOLD its reading's age, because
   * only the source knows when the sample was taken. A chart is handed a whole
   * series at once and cannot know when any of it was measured - but it does
   * know when it last heard anything, and a feed that has DIED is exactly what
   * that catches. ov-chart and ov-spark had no stale state at all until
   * 2026-09-12: a stopped feed left its last trace on screen, perfectly drawn,
   * aging silently. That is the 2003 blackout's flat-lined pens.
   *
   * Here rather than in each element for this file's founding reason: two
   * readouts inventing their own idea of what "old" means is the drift the
   * protocol exists to end. The elements keep their own timers, because when
   * to look is theirs; what it means is this file's.
   *
   * An explicit `age` attribute still wins, for an author who knows better.
   * 🔴 AND THE RULE IS NEVER DEFAULTED: with no `max-age` a series makes no
   * claim about currency at all, rather than inventing a window and calling a
   * slow feed dead.
   */
  function arrived(el, at) { el._ovArrivedAt = at; }

  /* Seconds past `max-age`'s patience, or null for "not stale" and for "no
   * rule declared". */
  function seriesStale(el, now) {
    const max = Number(el.getAttribute('max-age'));
    if (!el.hasAttribute('max-age') || !Number.isFinite(max) || max < 0) return null;
    const age = el.hasAttribute('age')
      ? Number(el.getAttribute('age'))
      : (el._ovArrivedAt === undefined ? null : (now - el._ovArrivedAt) / 1000);
    if (age === null || !Number.isFinite(age)) return null;
    return age > max ? age : null;
  }

  /* The words and the attributes, so a stale chart and a stale strip say the
   * same thing in the same place. Returns the phrase, or null. */
  function markSeriesStale(el, held) {
    if (held === null) {
      el.removeAttribute('data-ov-qualified');
      el.removeAttribute('data-ov-qualifier-text');
      return null;
    }
    const say = QUALIFIERS.stale({ age: Math.floor(held), series: true });
    el.setAttribute('data-ov-qualified', 'stale');
    el.setAttribute('data-ov-qualifier-text', say);
    return say;
  }

  return { REASONS, common, staleness, frozenness, apply, reading, prop, series, upgrade, rawOf,
           arrived, seriesStale, markSeriesStale };
})();

export const { REASONS, common, staleness, frozenness, apply, reading, prop, series, upgrade, rawOf,
  arrived, seriesStale, markSeriesStale } = window.OverscanRefusal;
export default window.OverscanRefusal;
