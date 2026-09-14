#!/usr/bin/env python3
"""Extract the element API from src/*.js into a Custom Elements Manifest.

The wrappers and the reference pages both generate from this file, so neither
can drift from the code or from each other. That is the whole reason it exists:
a hand-written API table is a claim about src/ that rots the moment src/ moves.

🔴 THE CONTRACT, and tools/gen_reference.py enforces it:

    key ABSENT     "I could not read this." The element is NAMED and the
                   build FAILS. Nothing is written.
    key PRESENT []  "This element genuinely has none." Renders as "None."

Defaulting to [] for something unread would turn a refusal into a manual
asserting "no events" about an element that has three. That is an invented reading
moved into the documentation, so this never emits [] as a fallback.

⚠️ FOUR EXTRACTION TRAPS, each of which yields a wrong-but-not-empty manifest.
They are written up in FRAMEWORKS.md and enforced by selftest() below.
"""
import json
import pathlib
import re
import sys

SRC = pathlib.Path('src')

# A registration, anchored so it cannot match `Overscan.sound.define(...)`,
# whose effect registry uses the same verb and would otherwise contribute six
# phantom elements: press, key, commit, refuse, alarm, vent.
DEFINE_RE = re.compile(r"""(?<![.\w])define\(\s*['"]([a-z][\w-]*)['"]\s*,\s*(\w+)""")
OBSERVED_RE = re.compile(r'static\s+observedAttributes\s*=\s*\[([^\]]*)\]')
STRINGS_RE = re.compile(r"""['"]([^'"]*)['"]""")
# `OverscanRefusal.prop(OvChart, 'values')`
PROP_RE = re.compile(r"""(?:OverscanRefusal\.)?prop\(\s*(\w+)\s*,\s*['"]([\w-]+)['"]\s*\)""")
SERIES_RE = re.compile(r"""(?:OverscanRefusal\.)?series\(\s*(\w+)\s*,\s*['"]([\w-]+)['"]\s*\)""")
# plain accessors in a class body: `set rows(v) {`
ACCESSOR_RE = re.compile(r'^\s{2}set\s+([A-Za-z_$][\w$]*)\s*\(', re.M)
CLASS_RE = re.compile(r'^\s*class\s+([A-Za-z_$][\w$]*)', re.M)

# ── attributes an element READS but never declares ──────────────────────────
#
# 🔴 `observedAttributes` ALONE UNDERCOUNTED 13 OF 35 ELEMENTS, and the
# reference printed the shortfall as a confident `0`. ov-cli reads prompt,
# banner, commands and label; ov-window reads x, y, w, h and snap; ov-fault
# reads burn, column, stuck and dead. Every one of them rendered a row saying
# it had no attributes at all.
#
# ⭐ observedAttributes is a REACTIVITY declaration, not an API one. It says
# "re-render when this changes", so an element that reads an attribute once at
# connect has no reason to list it and is not doing anything wrong. Reading it
# as the attribute list was the bug: two different questions, one answer.
#
# 🔴 AND THIS IS EXACTLY THE FAILURE THE KIT EXISTS TO REFUSE. `0` is a number
# nobody measured, printed by the page that documents a protocol whose first
# rule is that a readout never invents a value it was not given.
# 🔴 `this.` IS THE WHOLE RULE. Without it OvGraph claimed seven attributes
# that belong to its CHILDREN, because it reads `node.getAttribute('x')` and
# `l.getAttribute('from')` off them, and ov-link stayed at zero while genuinely
# taking `from` and `to` in markup. Of 121 literal reads in src/, 118 are off
# `this`; every other receiver is a different element. An attribute of mine is
# one I read off myself.
ATTR_READ_RE = re.compile(
    r"""\bthis\.(?:get|has)Attribute\(\s*['"]([\w-]+)['"]\s*\)""")
# The same read off any other receiver. Cannot be attributed by reading alone,
# which is what attributes_complete() below exists to say out loud.
ATTR_FOREIGN_RE = re.compile(
    r"""(?<!this)\.(?:get|has)Attribute\(\s*['"]([\w-]+)['"]\s*\)""")
# A non-literal read: `this.getAttribute(name)`. Cannot be resolved by reading,
# so it is REFUSED below unless a forwarding helper explains it.
ATTR_DYNAMIC_RE = re.compile(r'\.(?:get|has)Attribute\(\s*(?!["\'])')
# ⚠️ ONE elemenT indirects, and it is worth resolving rather than refusing:
# ov-fault.js declares `const num = (name, fallback) => parseFloat(
# this.getAttribute(name))` and then calls num('burn', 0). The helper forwards
# its OWN PARAMETER, so the literals at the call sites are the attribute names.
# Matched narrowly: the parameter has to be the thing handed to getAttribute.
ATTR_HELPER_RE = re.compile(
    r"""(?:const|let)\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>"""
    r"""[^;]*?\.(?:get|has)Attribute\(\s*\2\s*\)""", re.S)

# Not author-facing API. `data-ov-*` is the refusal protocol's own plumbing,
# written BY the kit and read back by it; `aria-*` is state the element manages
# for the accessibility tree. Neither is something a caller sets in markup, and
# listing them would pad the count with things no reader can use.
ATTR_SKIP = re.compile(r'^(?:data-ov-|aria-|role$)')


def attributes_read(scope, whole):
    """Attribute names this scope actually reads, by literal or via a helper.

    `scope` is one class body; `whole` is the module, because a helper may be
    declared outside the body that calls it.
    """
    names = set(ATTR_READ_RE.findall(scope))
    for helper, _param in ATTR_HELPER_RE.findall(whole):
        for m in re.finditer(rf"""\b{re.escape(helper)}\(\s*['"]([\w-]+)['"]""",
                             scope):
            names.add(m.group(1))
    return {n for n in names if not ATTR_SKIP.match(n)}


def attributes_complete(body, code, attrs, siblings):
    """Can this attribute list be trusted as the WHOLE list?

    🔴 NOT WHEN A PARENT READS THEM. ov-link takes `from` and `to` in markup
    and its own class never touches either: OvGraph reads them off the link
    element. So the honest answer for ov-link is empty AND incomplete, which
    are two different claims, and collapsing them into one is exactly what
    printing `0` did.

    A module's foreign reads are forgiven three ways. When this class is the
    one doing the reading, they are somebody else's attributes and say nothing
    about mine. When the class already declares them, the foreign read is a
    shared helper reaching back in. And when a SIBLING in the same module
    declares them, the read is accounted for by that sibling: ov-ascii.js reads
    `el.getAttribute('values')` in a module-level function, which is ov-spark's
    attribute, and flagging ov-cellbar for it would be the tool doubting itself
    about something it can plainly see.

    ⚠️ What survives all three is the real case: a name nobody in the module
    declares, read off an element that is not `this`. That is ov-link's `from`
    and `to`, and its two siblings, which is a true "cannot tell from here".
    """
    foreign = {n for n in ATTR_FOREIGN_RE.findall(code) if not ATTR_SKIP.match(n)}
    if not foreign:
        return True
    if ATTR_FOREIGN_RE.search(body):
        return True
    return foreign <= set(attrs) | set(siblings)


def unresolved_reads(scope):
    """Is there a non-literal getAttribute this tool cannot account for?

    ⭐ THE GATE, and the reason this extractor is allowed to state a count at
    all. A forwarding helper is resolved above, so its own `getAttribute(name)`
    is struck out first; anything dynamic still standing is a read whose name
    lives in a variable, and no amount of regex will recover it. The build
    fails rather than publishing a number that is short by an unknown amount,
    which is the whole complaint against the old `0`.
    """
    rest = ATTR_HELPER_RE.sub('', scope)
    return bool(ATTR_DYNAMIC_RE.search(rest))


def strip_comments(text):
    """Remove comments and string bodies' comment-lookalikes.

    🔴 NOT OPTIONAL. `customElements.define` appears as PROSE in five element
    files ("customElements.define works perfectly well from inside a
    closure..."), so an extractor that reads comments is reading English.
    """
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            i = n if j == -1 else j
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            i = n if j == -1 else j + 2
            continue
        if c in '"\'`':
            q, j = c, i + 1
            while j < n and text[j] != q:
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1])
            i = j + 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def dispatchers(code):
    """Functions that dispatch an event whose NAME IS A PARAMETER.

    🔴 ov-keys.js does `function announce(type, detail) { ... new
    CustomEvent(type ...) }`, so the event names live at the CALL SITES, not at
    the dispatch. Refusing here would be correct but useless, and accepting the
    dispatch as unreadable would have lost `ov:chord` and `ov:key` entirely.
    Neither event appears as a literal anywhere near a CustomEvent, so both
    extractors that looked only at dispatch sites missed them.

    Returns (names found at call sites, parameter names that are explained).
    """
    names, explained = set(), set()
    for m in re.finditer(r'function\s+(\w+)\s*\(([^)]*)\)\s*\{', code):
        fname, params = m.group(1), [a.strip() for a in m.group(2).split(',') if a.strip()]
        if not params:
            continue
        depth, j = 0, m.end() - 1
        while j < len(code):
            if code[j] == '{':
                depth += 1
            elif code[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = code[m.end():j]
        first = params[0]
        if re.search(r'new CustomEvent\(\s*' + re.escape(first) + r'\b', body):
            explained.add(first)
            for call in re.finditer(re.escape(fname) + r"\(\s*['\"]([^'\"]+)['\"]", code):
                names.add(call.group(1))
    return names, explained


def events_in(code, path, refusals, explained=()):
    """Every event an element dispatches.

    🔴 ov-transport.js is why this scans the whole first argument for literals
    instead of matching one: `new CustomEvent(on ? 'ov:pause' : 'ov:play')`.
    `ov:play` and `ov:pause` appear as literals NOWHERE else in the kit, so a
    matcher that only accepts `CustomEvent('literal'` does not fail here. It
    silently returns a manifest missing two events, which is exactly the
    failure this project exists to refuse.
    """
    found, i = [], 0
    needle = 'new CustomEvent('
    while True:
        i = code.find(needle, i)
        if i == -1:
            break
        j, depth, start = i + len(needle), 1, i + len(needle)
        while j < len(code) and depth:
            if code[j] == '(':
                depth += 1
            elif code[j] == ')':
                depth -= 1
            elif code[j] == ',' and depth == 1:
                break
            j += 1
        arg = code[start:j]
        lits = [s for s in STRINGS_RE.findall(arg) if s]
        if not lits and arg.strip() in explained:
            i = j
            continue
        if not lits:
            refusals.append(
                f'{path.name}: new CustomEvent() with no string literal in its '
                f'name argument ({arg.strip()[:40]!r}). Cannot be read.')
        found += lits
        i = j
    return sorted(set(found))


GETTER_RE = re.compile(r'^\s*get\s+([A-Za-z_$][\w$]*)\s*\(', re.M)
SETTER_RE = re.compile(r'^\s*set\s+([A-Za-z_$][\w$]*)\s*\(', re.M)


def getters_only(body):
    """Properties with a getter and no setter.

    🔴 WHY THIS IS IN THE MANIFEST. All three frameworks set a prop as a
    PROPERTY when the name exists on the element, else as an attribute. A
    getter-only property therefore THROWS on assignment, and in React it does
    not degrade: it takes down the whole tree. Derived the way marksStale is,
    so a reader on ov-segment is told which names on THAT element are affected
    rather than a general warning, and so it cannot rot against the class.
    """
    return sorted(set(GETTER_RE.findall(body)) - set(SETTER_RE.findall(body)))


def react_event(event):
    """ov:commit -> onCommit"""
    return 'on' + ''.join(w.capitalize() for w in event.split(':', 1)[1].split('-'))


def vue_event(event):
    """ov:commit -> commit (bound as @commit)"""
    parts = event.split(':', 1)[1].split('-')
    return parts[0] + ''.join(w.capitalize() for w in parts[1:])


def svelte_event(event):
    """ov:commit -> oncommit. Svelte 5 has no on: directive and `onov:commit`
    is not an identifier, so the colon is dropped along with the namespace."""
    return 'on' + vue_event(event).lower()


def component_name(tag):
    return ''.join(w.capitalize() for w in tag.split('-'))


def class_bodies(code):
    """Source of each class body, by brace matching.

    ⚠️ Per-FILE derivation is too coarse and was wrong twice: ov-ascii.js holds
    two classes with different attribute lists, and a file-level `common(` test
    marked both alike. Everything below is scoped to one class body.
    """
    out = {}
    for m in re.finditer(r'\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{', code):
        i = m.end() - 1
        depth, j = 0, i
        while j < len(code):
            if code[j] == '{':
                depth += 1
            elif code[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out[m.group(1)] = code[i:j + 1]
    return out


def extract():
    refusals, elements = [], {}
    for path in sorted(SRC.glob('ov-*.js')):
        code = strip_comments(path.read_text())
        defines = DEFINE_RE.findall(code)
        if not defines:
            continue

        bodies = class_bodies(code)
        # `prop(OvChart, 'values')` is called at module level, not in the body
        props, series_of = {}, {}
        bodies_seen = {}
        for cls, name in PROP_RE.findall(code):
            props.setdefault(cls, []).append(name)
        for cls, name in SERIES_RE.findall(code):
            props.setdefault(cls, []).append(name)
            series_of.setdefault(cls, set()).add(name)

        for tag, cls in defines:
            body = bodies.get(cls)
            if body is None:
                refusals.append(
                    f'{path.name}: {tag} registers class {cls}, whose body '
                    f'could not be located. Cannot read its API.')
                continue

            dnames, expl = dispatchers(code)
            observed = OBSERVED_RE.findall(body)
            if len(observed) > 1:
                refusals.append(
                    f'{path.name}: {cls} has {len(observed)} observedAttributes '
                    f'blocks; cannot say which applies.')
                continue

            # 🔴 REFUSE rather than undercount. If this class reads an
            # attribute whose name is in a variable, the list below would be
            # short by an amount nobody can see, and short-and-confident is the
            # exact shape of the `0` this replaced.
            if unresolved_reads(body):
                refusals.append(
                    f'{path.name}: {cls} calls getAttribute with a non-literal '
                    f'name that no forwarding helper explains, so its attribute '
                    f'list cannot be read. Give the read a literal name, or a '
                    f'helper of the form `const f = (name) => '
                    f'this.getAttribute(name)` called with literals.')
                continue

            # ⭐ DERIVED per class, never asserted. A readout that calls neither
            # common() nor staleness() HAS no staleness path and cannot mark a
            # reading stale. If one gains a call later this flips on its own.
            marks_stale = ('common(' in body) or ('staleness(' in body)

            # Two shapes of property, and missing the second is what made
            # ov-table claim it had none: OverscanRefusal.prop(Cls, 'x') at
            # module level, and a plain `set x(v)` accessor in the class body.
            # ⭐ KIND IS DERIVED FROM HOW THE PROPERTY IS INSTALLED, not asserted.
            # OverscanRefusal.prop() installs the reading protocol: null is a
            # dropout that renders a refusal. A plain `set x(v)` accessor is
            # structured data and carries no such promise. ov-table is the case
            # that proves it matters: `set rows(v)` does
            # `Array.isArray(v) ? v : []`, so a null is COERCED TO EMPTY, not
            # refused. Labelling those "reading" made the reference assert the
            # one behaviour FRAMEWORKS.md calls non-negotiable about the single
            # element that violates it.
            readings = set(props.get(cls, []))
            structured = set(ACCESSOR_RE.findall(body)) - readings

            events_here = events_in(body, path, refusals, expl)
            entry = {
                'name': tag,
                'class': cls,
                'module': f'src/{path.name}',
                'events': events_here,
                'marksStale': marks_stale,
                # 🔴 ALWAYS PRESENT. Absent is reserved for "could not read",
                # and an element with no reading properties is a real claim of
                # none, not a failure to look.
                #
                # ⭐ TWO SOURCES, UNIONED. observedAttributes says what the
                # element re-renders on; attributes_read() says what it
                # actually reads. Neither alone is the API: the first misses
                # every read-once-at-connect attribute (13 elements), and the
                # second would miss an attribute that is only ever handled in
                # attributeChangedCallback. See the note above ATTR_READ_RE.
                'attributes': sorted(
                    ({a for a in STRINGS_RE.findall(observed[0]) if a}
                     if observed else set())
                    | attributes_read(body, code)),
                # ⭐ The three spellings, carried as DATA. The reference
                # renders them and tools/gen_wrappers.py generates from them,
                # so a rule stated in prose cannot drift from the code that
                # implements it. `component` is the export name in all three.
                'wrappers': {
                    'component': component_name(tag),
                    'react': {react_event(x): x for x in events_here},
                    'vue': {vue_event(x): x for x in events_here},
                    'svelte': {svelte_event(x): x for x in events_here},
                },
                # Getter-only names, and the subset that also names an
                # ATTRIBUTE. That subset is the actually dangerous one: those
                # are the props a reader would naturally pass in markup.
                'gettersOnly': getters_only(body),
                'attributeCollisions': sorted(
                    set(getters_only(body))
                    & {a for a in (STRINGS_RE.findall(observed[0]) if observed else [])}),
                'members': [
                    # ⭐ Derived, not guessed from the plural: a reader that
                    # does `Array.isArray(v) ? v : [v]` takes a series, one
                    # that goes through rawOf() takes a single reading.
                    {'name': m, 'kind': 'reading', 'marksStale': marks_stale,
                     'series': m in series_of.get(cls, set()),
                     # One type string, read by the .d.ts generator AND by the
                     # reference pages, so neither composes its own.
                     'type': ('Reading[] | null'
                              if m in series_of.get(cls, set()) else 'Reading')}
                    for m in sorted(readings)
                ] + [
                    # No marksStale: staleness is a reading-protocol idea and
                    # claiming either value about structured data would be a
                    # claim nobody checked.
                    {'name': m, 'kind': 'structured', 'type': 'Structured'}
                    for m in sorted(structured)
                ],
            }
            # 🔴 A SEPARATE CLAIM FROM THE LIST ITSELF. Empty-and-complete
            # means "this element takes no attributes"; empty-and-incomplete
            # means "something else handles them and this tool cannot see
            # which". The old `0` said the first while meaning the second.
            bodies_seen[tag] = body
            elements[tag] = entry

        # ⭐ Completeness is a MODULE question, so it is answered once the
        # module's classes have all been read: a foreign read may belong to a
        # sibling, and that is only knowable after the siblings exist.
        here = [t for t, _ in defines if t in elements]
        for tag in here:
            sibs = set()
            for other in here:
                if other != tag:
                    sibs |= set(elements[other]['attributes'])
            elements[tag]['attributesComplete'] = attributes_complete(
                bodies_seen[tag], code, elements[tag]['attributes'], sibs)

    return elements, refusals


def global_events():
    """Events dispatched by module-level services rather than by an element.

    🔴 SCANNING ONLY CLASS BODIES SILENTLY LOST TWO OF THE EIGHT EVENTS.
    `ov:sound` is dispatched on `window` by ov-sound.js and `ov:tab` on a
    tablist row by ov-tabs.js, and neither file defines a custom element, so an
    element-keyed extractor skips both files entirely and reports six events
    with no error. That is the same shape as the ov-transport ternary: not a
    crash, just a manual quietly missing something real.
    """
    out, refusals = [], []
    for path in sorted(SRC.glob('ov-*.js')):
        code = strip_comments(path.read_text())
        bodies = class_bodies(code)
        outside = code
        for body in bodies.values():
            outside = outside.replace(body, '')
        dnames, expl = dispatchers(outside)
        for name in sorted(set(events_in(outside, path, refusals, expl)) | dnames):
            target = ('window' if 'window.dispatchEvent' in outside
                      else 'document' if 'document.dispatchEvent' in outside
                      else 'element')
            out.append({'name': name, 'module': f'src/{path.name}', 'target': target})
    return out, refusals


def imports_block():
    """The four import spellings, DERIVED FROM package.json.

    ⚠️ Not written here as strings. The package layout is asserted in exactly
    one file, and if api.py restated it, the reference would keep printing the
    old specifier on 35 pages the day an export map changed, with nothing to
    catch it. So this reads the export keys and REFUSES if the ones it needs
    are gone, which turns a packaging change into a build failure instead of a
    silent lie.
    """
    pkg = json.loads(pathlib.Path('package.json').read_text())
    name, exports = pkg['name'], pkg.get('exports', {})
    need = ['.', './overscan.css', './react', './vue', './svelte/*']
    missing = [k for k in need if k not in exports]
    if missing:
        raise SystemExit(
            'api.py REFUSED: package.json exports is missing '
            + ', '.join(missing) + '. The import lines in the reference are '
            'derived from it, so they cannot be written while it disagrees.')
    return {
        'element': [f"import '{name}'", f"import '{name}/overscan.css'"],
        'react': f"import {{ {{component}} }} from '{name}/react'",
        'vue': f"import {{ {{component}} }} from '{name}/vue'",
        'svelte': f"import {{component}} from '{name}/svelte/{{component}}.svelte'",
        'note': 'The CSS is a separate import in every framework. A single '
                'element can be imported on its own instead of the whole kit: '
                f"import '{name}/src/ov-chart.js'",
    }


def wrapper_notes(elements):
    """Why the wrappers are more than a re-export. Counts are DERIVED."""
    affected = {t: e['attributeCollisions'] for t, e in elements.items()
                if e['attributeCollisions']}
    total = sum(len(e['gettersOnly']) for e in elements.values())
    with_any = sum(1 for e in elements.values() if e['gettersOnly'])
    names = sorted({n for v in affected.values() for n in v})
    return [
        'A reading is set as a PROPERTY, never an attribute. An attribute is a '
        'string, so an array cannot survive one and a null arrives as the word '
        '"null", which the protocol would read as a value rather than a dropout.',

        'Every ov: event is bound with addEventListener. The colon has no '
        'declarative spelling in Svelte 5, where the on: directive is gone and '
        '"onov:commit" is not an identifier, nor in JSX. Vue can bind it.',

        f'The wrapper applies attributes ITSELF and hands the framework nothing '
        f'but a ref. All three frameworks set a prop as a property when the name '
        f'exists on the element, and this kit has {total} getter-only properties '
        f'across {with_any} elements. Assigning one throws, and in React it does '
        f'not degrade: the whole tree fails to render. '
        f'{len(affected)} elements have a getter-only name that is also a real '
        f'attribute ({", ".join(names)}), which are the ones a reader would '
        f'naturally pass in markup.',
    ]


def manifest():
    elements, refusals = extract()
    globals_, grefs = global_events()
    refusals = refusals + grefs
    if refusals:
        raise SystemExit('api.py REFUSED rather than guessing:\n'
                         + '\n'.join('  ' + r for r in refusals))
    return {
        'schemaVersion': '2.1.0',
        'readme': 'FRAMEWORKS.md',
        'imports': imports_block(),
        'readingProtocol': {
            'undefined': 'property never set; falls through to source, then attribute',
            'null': 'set deliberately to nothing. A dropout, renders a refusal',
            'number': 'drawn',
            '{value, age}': 'drawn, and marked stale when age exceeds max-age',
            'note': 'A reading property never coerces null to 0 and never '
                    'drops it from an array. Strings are passed through '
                    'unnormalised, so "01.50" stays "01.50".',
        },
        'globalEvents': globals_,
        'wrapperNotes': wrapper_notes(elements),
        # ⚠️ The scalar block does NOT describe a series property. On a series,
        # "number: drawn" describes `.values = 42`, which nobody should write,
        # and the row that actually matters is missing: a null INSIDE the array
        # is a dropout at that sample, which is a different event from the whole
        # property being null. Both are real and they are not the same claim.
        'seriesProtocol': {
            'undefined': 'property never set; falls through to source, then attribute',
            'null': 'the whole property set to nothing. Renders a refusal and '
                    'draws nothing at all',
            'Reading[]': 'drawn in order',
            'null inside the array': 'a DROPOUT AT THAT SAMPLE, and the line is '
                                     'BROKEN across it rather than interpolated. '
                                     'Measured: [10, null, 30] draws isolated '
                                     'points and reports "1 missing", where '
                                     '[10, 30] draws a polyline joining them. A '
                                     'line drawn across a gap would be the chart '
                                     'asserting readings nobody took',
            'note': 'Neither series property marks staleness, so a per-sample '
                    'age is not read. Staleness is a whole-readout claim here.',
        },
        'modules': [
            {'kind': 'javascript-module', 'path': e['module'],
             'declarations': [e]} for e in elements.values()
        ],
    }


def selftest():
    """Refuses to report until it has watched itself catch what it must catch."""
    fails = []
    sound = SRC / 'ov-sound.js'
    if sound.exists():
        phantoms = DEFINE_RE.findall(strip_comments(sound.read_text()))
        if phantoms:
            fails.append(f'anchor failed: sound registry produced {phantoms}')

    prose = strip_comments("/* customElements.define('ov-fake', X); */\nconst a = 1;")
    if 'ov-fake' in prose:
        fails.append('comment stripping failed: prose registration survived')

    refs = []
    got = events_in("new CustomEvent(on ? 'ov:pause' : 'ov:play')",
                    pathlib.Path('t.js'), refs)
    if got != ['ov:pause', 'ov:play']:
        fails.append(f'ternary event names not both read: {got}')

    refs = []
    events_in('new CustomEvent(computed)', pathlib.Path('t.js'), refs)
    if not refs:
        fails.append('a non-literal event name was not refused')

    # ---- attributes: read off `this`, and never off anyone else -------------
    mine = "connectedCallback() { this.getAttribute('prompt'); }"
    if attributes_read(mine, mine) != {'prompt'}:
        fails.append('an attribute read off `this` was not picked up')
    theirs = "schedule() { node.getAttribute('x'); l.getAttribute('from'); }"
    if attributes_read(theirs, theirs):
        fails.append('attributes read off ANOTHER element were claimed as mine')
    # 🔴 The pair that matters: the same name, two receivers, opposite answers.
    both = "f() { this.getAttribute('a'); other.getAttribute('b'); }"
    if attributes_read(both, both) != {'a'}:
        fails.append(f'receiver not distinguished: {attributes_read(both, both)}')

    # The forwarding helper, which is the only indirection in src/.
    helper = ("uniforms() { const num = (name, fb) => "
              "parseFloat(this.getAttribute(name));\n"
              "num('burn', 0); num('stuck', 0); }")
    if attributes_read(helper, helper) != {'burn', 'stuck'}:
        fails.append(f'the forwarding helper did not resolve: '
                     f'{attributes_read(helper, helper)}')
    if unresolved_reads(helper):
        fails.append('a helper-explained dynamic read was refused anyway')
    # 🔴 And an indirection nothing explains MUST refuse, or the count ships short.
    if not unresolved_reads("f() { this.getAttribute(whatever); }"):
        fails.append('an unreadable dynamic attribute read was not refused')

    # Protocol plumbing is not author API and must not pad the count.
    proto = ("f() { this.getAttribute('data-ov-refusal'); "
             "this.getAttribute('aria-expanded'); this.getAttribute('real'); }")
    if attributes_read(proto, proto) != {'real'}:
        fails.append('data-ov-/aria- plumbing was counted as author API')

    # Complete vs incomplete are DIFFERENT CLAIMS about the same empty list.
    reader = "schedule() { l.getAttribute('from'); }"
    if not attributes_complete(reader, reader, [], set()):
        fails.append('the class doing the reading was marked incomplete')
    if attributes_complete('connectedCallback() {}', reader, [], set()):
        fails.append('a sibling whose attributes a parent reads was called complete')
    if not attributes_complete('connectedCallback() {}', reader, [], {'from'}):
        fails.append('a foreign read a sibling declares was not forgiven')

    els, _ = extract()
    # 40 since ov-countdown (2026-09-11).
    # 43 since ov-track (2026-09-11).
    # 48 since ov-downlink (2026-09-11).
    # 53 since ov-orbit (2026-09-11).
    # 79 since ov-player.
    # 81 since ov-geomap and ov-tactical.
    # 82 since ov-watchdog.
    # 83 since ov-authority.
    # 84 since ov-solid.
    # 85 since ov-datablock.
    if len(els) != 85:
        fails.append(f'expected 85 elements, extracted {len(els)}')
    # ov-gauge gained a staleness() call, so it must now derive True. This
    # assertion was False until that landed and is left pointing at the gauge
    # deliberately: it is the element the derivation was built to get right.
    if els.get('ov-gauge', {}).get('marksStale') is not True:
        fails.append('ov-gauge should derive marksStale=True (it calls staleness())')
    if els.get('ov-segment', {}).get('marksStale') is not True:
        fails.append('ov-segment should derive marksStale=True')

    # 🔴 ov-table's properties are plain get/set accessors, not
    # OverscanRefusal.prop(), and missing that shape made the manifest assert
    # this element had NO properties, which is a false claim about code.
    tmem = {m['name']: m for m in els.get('ov-table', {}).get('members', [])}
    if not {'cols', 'rows'} <= set(tmem):
        fails.append(f'ov-table must expose cols and rows; got {sorted(tmem)}')
    # 🔴 BOTH DIRECTIONS. Presence alone passed while the kind was wrong, which
    # is how the reference came within one step of asserting a refusal protocol
    # on an element that coerces null to an empty list.
    for name in ('cols', 'rows'):
        if tmem.get(name, {}).get('kind') == 'reading':
            fails.append(f'ov-table.{name} is structured data, not a reading')
    # Arity is DECLARED via series() vs prop(), because two attempts to derive
    # it both produced confident wrong answers (ov-spark scalar, then
    # ov-cellbar a series). Assert the five that are scalar and the two that
    # are not, so a mis-declaration at the install site is caught here.
    # ov-countdown.clock (2026-09-11) is one reading per heartbeat: scalar.
    arity = {(t, m['name']): m.get('series')
             for t, e in els.items() for m in e['members'] if m['kind'] == 'reading'}
    want = {('ov-chart', 'values'): True, ('ov-spark', 'values'): True,
            ('ov-gauge', 'value'): False, ('ov-segment', 'value'): False,
            ('ov-flap', 'value'): False, ('ov-cellbar', 'value'): False,
            ('ov-countdown', 'clock'): False}
    if arity != want:
        fails.append(f'reading arity wrong: {sorted(k for k in want if arity.get(k) != want[k])}')

    # The getter-only trap is the strongest argument for the wrappers existing,
    # so assert it is actually being derived. ov-segment.digits is the exact
    # property that took down a React tree.
    seg = els.get('ov-segment', {})
    if 'digits' not in seg.get('gettersOnly', []):
        fails.append('ov-segment.digits should be derived as getter-only')
    if 'digits' not in seg.get('attributeCollisions', []):
        fails.append('ov-segment.digits is also an attribute; collision not derived')
    if not any(e['attributeCollisions'] for e in els.values()):
        fails.append('no attribute collisions found at all; detector is inert')

    readings = {(t, m['name']) for t, e in els.items() for m in e['members']
                if m['kind'] == 'reading'}
    # 7 since ov-countdown.clock (2026-09-11).
    if len(readings) != 7:
        fails.append(f'expected 7 reading properties, got {len(readings)}: '
                     f'{sorted(readings)}')

    # 🔴 THE CONTRACT. Absent means unread; an element with none must say so
    # with an empty list. Emitting neither is how a manual comes to assert
    # "no events" about an element that has three.
    for tag, e in els.items():
        for key in ('attributes', 'members', 'events'):
            if key not in e:
                fails.append(f'{tag}: {key} key absent; absent is reserved for unread')
    # 🔴 The riskiest case, and the one a filename-keyed extractor gets wrong:
    # ov-ascii.js holds TWO elements with two different attribute lists. Pairing
    # them by source order is an assumption, so assert the result rather than
    # trusting it. spark takes `values`/`window`, cellbar takes `value`/`unit`,
    # and a mis-pairing swaps them silently while still producing a full,
    # plausible manifest.
    spark = els.get('ov-spark', {}).get('attributes', [])
    cellbar = els.get('ov-cellbar', {}).get('attributes', [])
    if 'values' not in spark or 'window' not in spark:
        fails.append(f'ov-spark attributes mis-paired: {spark}')
    if 'value' not in cellbar or 'unit' not in cellbar:
        fails.append(f'ov-cellbar attributes mis-paired: {cellbar}')

    # And the contract itself: absent must be reachable, or the distinction
    # between "none" and "unread" is decorative.
    # 🔴 `document.currentScript` IS ALWAYS NULL IN A MODULE. It is only set
    # for classic scripts, so any use of it in src/ is dead code with a
    # fallback that silently resolves against the PAGE. That broke every shader
    # on every page off the repo root, and would have shipped 404s to every
    # consumer of the package. Static, because the failure is silent and the
    # root pages keep passing.
    for p in SRC.glob('*.js'):
        if 'document.currentScript' in strip_comments(p.read_text()):
            fails.append(f'{p.name} uses document.currentScript, which is null '
                         f'in a module; use import.meta.url')

    # 🔴 A COMPONENT MAY NOT KEEP STATE ON A NATIVE REFLECTED PROPERTY. These
    # names already exist on HTMLElement, where they reflect a global content
    # attribute and coerce to a fixed set of strings. `ov-table` kept its sort
    # direction on `this.dir`: the assignment wrote dir="1" onto the host, the
    # read came back "", `-this.dir` was 0, the comparator was multiplied by
    # zero, and Array.sort being stable meant the table NEVER SORTED. aria-sort
    # had the same hole and could only ever say "descending". Nothing threw,
    # nothing logged, and both demos looked plausible for as long as nobody
    # clicked a header and watched a row.
    # ⚠️ `id` is deliberately NOT here. It reflects a string, ov-graph assigns a
    # string to it on purpose, and that is what it is for.
    RESERVED = ('dir', 'lang', 'title', 'slot', 'translate', 'draggable',
                'spellcheck', 'autocapitalize', 'hidden', 'className', 'style')
    for p_ in SRC.glob('*.js'):
        body = strip_comments(p_.read_text())
        for prop in RESERVED:
            if re.search(rf'\bthis\.{prop}\s*=(?!=)', body):
                fails.append(f'{p_.name} assigns this.{prop}, a native reflected '
                             f'property; keep component state on _{prop}')
            # ⚠️ AND AS A METHOD, which is how `style` got in. `ov-gl.js`
            # declared `style() { ... }` on the base class, so `el.style` was a
            # FUNCTION on all five GL elements and `el.style.setProperty()`
            # threw on every one of them. An assignment-only check saw nothing:
            # a class method is a property too.
            if re.search(rf'^\s{{2,4}}(static\s+)?{prop}\s*\(', body, re.M):
                fails.append(f'{p_.name} defines a {prop}() method, which shadows '
                             f'the native property of that name on every instance')

    # 🔴 AN OBSERVED ATTRIBUTE WITH NO CALLBACK IS A DECLARATION NOBODY READS.
    # The browser watches the attribute and tells nobody, so it is inert, and
    # the manifest below is generated FROM this list, which means the docs
    # publish an attribute that does nothing. `ov-table` shipped three that way:
    # `rows`, which an array of row objects can have no attribute spelling for,
    # `sort`, which was never read anywhere, and `row-height`, which paint()
    # honoured while table.css sized rows from a variable nothing set, so any
    # value but the default laid a script grid over differently-sized rows.
    # ⚠️ Per CLASS, not per file: ov-ascii declares two, and a file-level check
    # would pass a file where only one of them was wired.
    for p_ in SRC.glob('*.js'):
        body = strip_comments(p_.read_text())
        chunks = re.split(r'\bclass\s+\w+\s+extends\b', body)
        for chunk in chunks[1:]:
            if 'observedAttributes' in chunk and 'attributeChangedCallback' not in chunk:
                fails.append(f'{p_.name} declares observedAttributes with no '
                             f'attributeChangedCallback; the attributes are inert')

    # 🔴 AN OBSERVED ATTRIBUTE NOBODY READS IS A PUBLISHED PROMISE. The manifest
    # is generated from these lists, so the reference documents every name here
    # whether or not anything acts on it. `ov-table` published `rows`, which an
    # array of row objects can have no attribute spelling for, and `ov-grid`
    # published `cols`, which render() never read: `cols="4"` and `cols="200"`
    # gave byte-identical output.
    #
    # ⚠️ THE CENTRAL READS ARE DERIVED, NOT LISTED. Six readouts get `value`,
    # `min`, `max` and friends through OverscanRefusal.rawOf() rather than
    # touching getAttribute themselves, so a naive version of this check called
    # all six broken. The set comes out of ov-refusal.js so it cannot drift
    # from what that file actually reads.
    refusal = strip_comments((SRC / 'ov-refusal.js').read_text())
    central = set(re.findall(r"getAttribute\(\s*['\"]([\w-]+)['\"]", refusal))
    for p_ in SRC.glob('*.js'):
        body = strip_comments(p_.read_text())
        for decl in re.findall(r'static observedAttributes\s*=\s*\[([^\]]*)\]', body):
            for a in [x.strip().strip('\'"') for x in decl.split(',') if x.strip()]:
                if a in central:
                    continue
                if re.search(rf"(getAttribute|hasAttribute)\(\s*['\"]{re.escape(a)}['\"]", body):
                    continue
                # ⚠️ The protocol hands the NAME to ov-refusal.js, which reads
                # it with `el.getAttribute(name)` through a variable. So `value`
                # appears as a literal nowhere in that file, and deriving the
                # central set from its literals alone called four working
                # readouts broken. The literal lives at the CALL, here.
                if re.search(rf"(rawOf|prop|reading|series)\([^)]*['\"]{re.escape(a)}['\"]",
                             body):
                    continue
                if re.search(rf"['\"]{re.escape(a)}['\"]\s*:", body):
                    continue
                fails.append(f'{p_.name} observes "{a}" and never reads it; the '
                             f'manifest would publish an attribute that does nothing')

    # 🔴 THE REVEAL'S SELECTOR LIST LIVES TWICE AND MUST NOT DRIFT. motion.css
    # hides the targets before the first paint; ov-reveal.js finds the same
    # elements to animate. If the two disagree, the CSS hides something the
    # script will never reveal, and the failure is a permanently blank element
    # that only the inline script's 1.5s timer rescues. One is unreadable
    # without the other, so they are checked against each other here.
    js = (SRC / 'ov-reveal.js').read_text()
    m = re.search(r'const TARGETS = \[(.*?)\]\.join', js, re.S)
    in_js = re.findall(r"^\s*'([^']+)',", m.group(1), re.M) if m else []
    css = (SRC / 'motion.css').read_text()
    m2 = re.search(r'\[data-ov-arm\] :is\(\s*(.*?)\s*\)\s*\{', css, re.S)
    in_css = [x.strip() for x in m2.group(1).split(',')] if m2 else []
    if not in_js or not in_css:
        fails.append('reveal selector list not found in '
                     + ('ov-reveal.js' if not in_js else 'motion.css'))
    elif in_js != in_css:
        only_js = [x for x in in_js if x not in in_css]
        only_css = [x for x in in_css if x not in in_js]
        fails.append(f'reveal targets drifted. only in ov-reveal.js={only_js}, '
                     f'only in motion.css={only_css}')

    if not any('attributes' in e for e in els.values()):
        fails.append('no element reported attributes at all; extractor is inert')

    # 🔴 Every event the kit dispatches must land somewhere. FOURTEEN as of
    # ov-table and ov-tree announcing their reorders; the gate caught ov:flip
    # the day it appeared and ov:reorder the day a component finally dispatched
    # one, which is what it is for. Was TWELVE, measured
    # 2026-09-09, and the count was wrong twice before this assertion existed:
    # ov:sound and ov:tab belong to no element, and ov:chord and ov:key are
    # dispatched through a function whose first PARAMETER is the event name, so
    # they appear as literals nowhere near a CustomEvent call.
    # ⚠️ `ov:arrived` belongs to the PAGE, not to an element, like ov:sound and
    # ov:tab above: ov-reveal.js says the first screenful has stopped moving and
    # ov-core.js holds every live loop until it hears it.
    expected = {'ov:acknowledge', 'ov:allocate', 'ov:annunciate', 'ov:arrived', 'ov:baseline', 'ov:verify', 'ov:claim', 'ov:clock', 'ov:complete', 'ov:quorum', 'ov:refuse', 'ov:shelve', 'ov:signal', 'ov:solo', 'ov:station',
                'ov:arm', 'ov:safe', 'ov:vitals', 'ov:ecg', 'ov:player', 'ov:watchdog', 'ov:authority', 'ov:datablock',
                'ov:cancel', 'ov:change', 'ov:chord', 'ov:command', 'ov:commit',
                'ov:flip', 'ov:key', 'ov:pause', 'ov:play', 'ov:reorder',
                'ov:resize', 'ov:seek', 'ov:sound', 'ov:tab', 'ov:view'}
    seen = {ev for e in els.values() for ev in e['events']}
    seen |= {g['name'] for g in global_events()[0]}
    if seen != expected:
        fails.append(f'event set drifted. missing={sorted(expected - seen)} '
                     f'unexpected={sorted(seen - expected)}')
    return fails


DTS_HEAD = """/* GENERATED by tools/api.py. Do not edit; re-run the script.
 *
 * Types for consumers, derived from the same manifest the reference pages and
 * the framework wrappers come from, so all three say the same thing.
 *
 * ⚠️ NOT INFERRED FROM THE SOURCE. Pointing tsc at src/*.js produced 291
 * errors that were almost entirely undeclared instance fields and
 * `window.Overscan`, none of which is part of the public API. Inferring a
 * public contract from private implementation detail would have shipped a
 * worse answer than the manifest already holds.
 */

/** A single reading handed to a readout.
 *
 * `null` is a DROPOUT and renders a refusal. It is never coerced to 0 and
 * never dropped from an array. A string is passed through unnormalised, so
 * "01.50" stays "01.50" rather than becoming 1.5.
 */
export type Reading = number | string | null | { value: number; age?: number | null };

/** Structured data. Carries no refusal protocol: see the per-element notes.
 *  An array (rows, spans, conditions) or an object (a plan, a survey, the air
 *  data): `unknown[]` alone typed ov-wireframe's survey and ov-schematic's plan
 *  as arrays, which they are not. */
export type Structured = unknown[] | Record<string, unknown>;

export declare const Overscan: Record<string, any>;
export declare function define<T extends CustomElementConstructor>(
  name: string, cls: T): T;

"""


def emit_dts(m, path='types/overscan.d.ts'):
    """Write the consumer type surface from the manifest."""
    els = [d for mod in m['modules'] for d in mod['declarations']]
    out = [DTS_HEAD]
    tagmap = []
    for e in els:
        iface = ''.join(w.capitalize() for w in e['name'].split('-'))
        lines = [f'/** `<{e["name"]}>`' ]
        if e['members']:
            readings = [x['name'] for x in e['members'] if x['kind'] == 'reading']
            if readings:
                lines.append(f' *  Reading propert{"y" if len(readings) == 1 else "ies"}: '
                             + ', '.join(readings) + '.')
                lines.append(f' *  Marks staleness: {"yes" if e["marksStale"] else "NO"}.')
        if e['events']:
            lines.append(' *  Events: ' + ', '.join(e['events']) + '.')
        lines.append(' */')
        out.append('\n'.join(lines))
        body = [f'export interface {iface} extends HTMLElement {{']
        for mem in e['members']:
            t = mem['type']
            body.append(f'  {mem["name"]}: {t};')
        body.append('}')
        out.append('\n'.join(body) + '\n')
        tagmap.append(f"    '{e['name']}': {iface};")

    out.append('declare global {\n  interface HTMLElementTagNameMap {\n'
               + '\n'.join(tagmap) + '\n  }\n}\n')
    p = pathlib.Path(path)
    p.parent.mkdir(exist_ok=True)
    p.write_text('\n'.join(out))
    return p, len(els)


if __name__ == '__main__':
    f = selftest()
    if f:
        print('api.py SELFTEST FAILED:', *f, sep='\n  ')
        sys.exit(1)
    print('selftest ok')
    m = manifest()
    out = pathlib.Path('custom-elements.json')
    out.write_text(json.dumps(m, indent=2, sort_keys=True) + '\n')
    n = len(m['modules'])
    print(f'wrote {out} ({n} elements)')
    dts, count = emit_dts(m)
    print(f'wrote {dts} ({count} interfaces)')
