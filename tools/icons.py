#!/usr/bin/env python3
"""THE REGISTER. Every Overscan symbol, its number, and what it means.

🔴 AUTHORED HERE, NOT SHIPPED FROM ANYWHERE. The precedent is
Ron Cobb's Semiotic Standard, and the precedent is all that
transfers: the vectorisations circulating are CC BY 4.0 but upstream is
explicit that it does NOT relicense Cobb's original artwork, the film material,
the names or the trademarks. What is worth taking is the idea, and the idea is
the valuable half - a set where every mark has a NUMBER and a STATED MEANING,
published as a specification, rather than a bag of glyphs.

⭐ THE RULE, WHICH IS `decoration needs a rule` APPLIED TO ICONOGRAPHY:
THE FRAME IS THE CATEGORY AND THE MARK IS THE MEANING.

Every symbol sits in a frame that says what KIND of thing it is, and carries a
mark that says which one. That gives the set a property almost no icon font
has: an unfamiliar symbol is still half-readable, because the triangle tells
you it is a hazard before you have worked out what the mark inside it is. It
also makes the set checkable rather than merely consistent - `check()` asserts
that every symbol carries its category's frame, so a symbol cannot quietly
drift out of its family.

⭐ AND YOU CAN ASK WHAT ONE MEANS. Every symbol answers with a sentence that
is not "it looks like a gear", because the sentence is the source and the
drawing implements it.

## The eight families

The first five report on a MACHINE: what it is doing (state), what will hurt
you (hazard), which part of it you are looking at (system), what is moving
through it (flow), and what you may do to it (action).

The last three are about the SHIP AND THE PEOPLE IN IT, which is the half of
the precedent a console-only set leaves out and the half that is actually
painted on bulkheads: where you are and how you get out (wayfinding), what is
required of the person standing here (crew), and what the hardware needs from
whoever services it (maintenance).

## Construction

24x24 grid. Stroke 2, butt caps, miter joins, `currentColor` throughout so a
symbol takes the theme like everything else. Coordinates on whole units where
they can be; diagonals at 45 degrees; arcs only where an arc is the meaning.
Nothing is filled except where filling IS the distinction.

⚠️ A FRAME THAT TAPERS HAS A WEDGE FOR AN INTERIOR, NOT A BOX. Two passes were
lost to this on the triangle: marks too small to read at 30px, then marks sized
for a box that came out as a bowtie, a bolt crossing its own frame, and spokes
leaving the bottom edge. Hazard marks are two or three bold strokes, sat low
where the wedge is wide. THE SHIELD HAS THE SAME PROBLEM UPSIDE DOWN - its
bottom third narrows to a point, so crew marks live between y=6 and y=17 and
nothing reaches the tip.

⭐ AND A MARK NEVER CROWDS ITS FRAME. The frame is what carries the category,
so it has to survive being looked at quickly, and a mark run up against the
frame edge fuses with it. `tools/clearance.py` measures the visible gap on
every symbol and refuses if any is tight. The margin is NOT one number, because
the frames are not the same size inside: THE MARGIN IS ONE NINTH OF THE ROOM
THE FRAME HAS. The state circle holds an inscribed disc of 9.00 and the hazard
triangle holds 5.40, so a single figure generous enough for the circle would
shrink hazard marks back to the size that already failed a pass. Every frame
gives up the same PROPORTION of its interior instead.

⚠️ AND CHECK EVERY NEW MARK AGAINST ITS NEIGHBOURS AT 30px, NOT IN ISOLATION.
41 intake and 44 blocked were near-indistinguishable until the slash was added,
which is a real failure in a set whose whole claim is that you can read it.
The pairs that had to be pulled apart deliberately in this pass: 61 airlock
against 63 ladder, 62 hatch against 66 muster station, 57 reset against 31
power, 19 projected against 14 offline, and 51 engage against 59 step, which
differ by one stroke and are only safe because the transport idiom is already
learned everywhere.

⚠️ AND A MARK CAN READ AS A LETTER, OR AS A BOWTIE. Both happened in this pass:
39 structure was an X between two rails, which collapses to an hourglass, and
37 navigation was a notched arrowhead, which is a capital A no matter how deep
the notch is cut. The fixes generalise and are worth knowing - a beam section
cannot collapse, and a SOLID shape cannot be a letterform, because letterforms
are strokes.

## Modifiers

There are EXACTLY TWO, and a third would have to be argued for. Both are
cross-family: they mean the same thing in every frame, which is what makes
them worth learning once.

⭐ **A diagonal slash negates the symbol it crosses**, in any category. `14
offline` is a state negated, `44 blocked` is a flow negated, `69 restricted`
is a doorway negated and `76 unmanned` is a crew figure negated - and none of
them has to be learned separately once the slash is.

⭐ **A horizontal dash inside a frame means absence**, for the same reason.
`15 no reading` is a state with nothing in it and `25 vacuum` is a space with
nothing in it. That is not a collision: the frame already said which kind of
absence, which is the entire point of the frame saying the category.

## Sub-rules, which are not modifiers

A modifier means one thing everywhere. These two mean something only INSIDE
their family, so they are written down separately rather than smuggled in as
a third and fourth modifier.

⭐ **In the state circle, how much of the dot is filled is how much of the
thing is working.** Filled is `11 nominal`, half is `17 degraded`, hollow is
`16 standby`. Three symbols, one gradient, nothing to memorise.

⭐ **In the flow channel, the line and the chevrons carry the rate.** A dashed
line is `49 trickle`, a single chevron is the ordinary case, and a doubled
chevron is `48 surge`. Rate is drawn, not labelled.

## Numbering

Two digits. The tens digit is the category, so the number carries the same
information the frame does and a symbol referred to by number alone is still
half-understood. 00 is reserved and is not a symbol.

🔴 THAT CEILS THE SET AT NINE FAMILIES AND NINE MARKS EACH. Eight families are
spent. The ninth tens digit is deliberately left unspent - a register that
fills its own numbering the moment it can has no room to be wrong about a
category later - and a TENTH family is not a new row in this file, it is a
different numbering scheme. `check()` refuses rather than letting that happen
quietly.
"""

FRAMES = {
    'state':  '<circle cx="12" cy="12" r="9"/>',
    'hazard': '<path d="M12 3 21 20 3 20Z"/>',
    'system': '<rect x="3.5" y="3.5" width="17" height="17"/>',
    'flow':   '<path d="M3 5h18M3 19h18"/>',
    'action': '<path d="M12 3 21 12 12 21 3 12Z"/>',
    # An arch is the only frame you walk THROUGH, which is why wayfinding gets
    # it: it is open at the bottom, and the opening is the meaning.
    'wayfinding': '<path d="M4 21V11a8 8 0 0 1 16 0v10"/>',
    # A shield is a badge, and a badge is worn by a person. Flat top so it is
    # not read as the hazard triangle, which points the other way.
    'crew': '<path d="M4.5 3.5h15v8.5c0 4.4-3.6 6.8-7.5 8.4-3.9-1.6-7.5-4-7.5'
            '-8.4Z"/>',
    # A hexagon is a fastener head seen face on. It says "this comes apart, and
    # there is a correct tool for it".
    'maintenance': '<path d="M7.5 3.5h9l4.5 8.5-4.5 8.5h-9L3 12Z"/>',
}

CATEGORY_MEANS = {
    'state':  'a condition of the thing being reported on',
    'hazard': 'a danger present at this location',
    'system': 'a subsystem, named rather than described',
    'flow':   'something moving through a channel',
    'action': 'an operation the reader can perform',
    'wayfinding': 'a place, and the way into or out of it',
    'crew': 'something required of the person standing here',
    'maintenance': 'hardware, and the servicing it expects',
}

# (number, name, category, meaning, mark)
REGISTER = [
    (0, 'unregistered', None,
     'reserved. no symbol is defined for the name that was asked for, and one '
     'is not invented',
     '<path d="M4 4h16v16H4Z"/><path d="M4 4 20 20M20 4 4 20"/>'),

    # ---- 1x state --------------------------------------------------------
    (11, 'nominal', 'state', 'reading is within its declared range and current',
     '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'),
    (12, 'caution', 'state', 'reading is real and outside its comfortable band',
     '<path d="M12 7v6"/><path d="M12 15.5v2"/>'),
    (13, 'fault', 'state', 'the thing reporting is broken, not the reading',
     '<path d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"/>'),
    (14, 'offline', 'state', 'nothing is reporting and nothing is expected to',
     '<path d="M7.8 16.2 16.2 7.8"/>'),
    (15, 'no reading', 'state',
     'no value has arrived. deliberately a dash, which is the refusal idiom '
     'the segment readouts use, and deliberately not a zero',
     '<path d="M7 12h10"/>'),
    (16, 'standby', 'state',
     'powered, correct, and doing nothing. the hollow dot is the empty end of '
     'the fill ladder that 11 fills and 17 half-fills',
     '<circle cx="12" cy="12" r="4"/>'),
    (17, 'degraded', 'state',
     'running, and not at full capability. ⭐ the half-filled dot is the '
     'middle of the ladder, so the three states are one gradient rather than '
     'three unrelated marks',
     '<circle cx="12" cy="12" r="4"/>'
     '<path d="M12 8a4 4 0 0 0 0 8Z" fill="currentColor" stroke="none"/>'),
    (18, 'stale', 'state',
     'a value did arrive and is too old to be trusted. ⭐ NOT the same as 15: '
     'this one has a number to show you and is telling you not to believe it',
     '<path d="M12 12V7.5M12 12h3.6"/>'),
    (19, 'projected', 'state',
     'this value was computed forward, not measured. ⭐ the solid dot is the '
     'last real reading and the dashes are what comes after it, because a '
     'readout that refuses to invent still has to be allowed to extrapolate '
     'OUT LOUD. ⚠️ the first drawing was a solid line going dashed as it rose, '
     'and a diagonal inside the state circle is 14 offline - a mark cannot '
     'borrow the negation slash to mean something that is not negation',
     '<circle cx="8.8" cy="12" r="2.2" fill="currentColor" stroke="none"/>'
     '<path d="M12.6 12h1.8M16 12h1.8"/>'),

    # ---- 2x hazard -------------------------------------------------------
    (21, 'pressure', 'hazard', 'pressure differential across this boundary',
     '<path d="M12 9.5v4"/><path d="M10.2 12.5 12 14.3l1.8-1.8"/>'
     '<path d="M8 17h8"/>'),
    (22, 'thermal', 'hazard', 'surface or medium at a harmful temperature',
     '<path d="M9.5 17v-3.5M12 17v-7M14.5 17v-3.5"/>'),
    (23, 'electrical', 'hazard', 'live conductor present',
     '<path d="M13 11.5 10.3 15h3.4L11.5 17.2"/>'),
    (24, 'radiation', 'hazard', 'ionising source',
     '<circle cx="12" cy="14.6" r="1.9" fill="currentColor" stroke="none"/>'
     '<path d="M12 14.6V10M12 14.6 9.7 17.4M12 14.6 14.3 17.4"/>'),
    (25, 'vacuum', 'hazard',
     'this space is or may become unpressurised. the dash is the same '
     'absence mark 15 carries, and the frame is what says which kind',
     '<circle cx="12" cy="14.4" r="2.6"/><path d="M9.9 14.4h4.2"/>'),
    (26, 'corrosive', 'hazard',
     'a substance here attacks what it touches, including you',
     '<path d="M12 9.4 10.2 12.4a2.4 2.4 0 1 0 3.6 0Z"/><path d="M8 17h8"/>'),
    (27, 'contaminated', 'hazard',
     'the atmosphere here is present and must not be breathed. ⭐ the mark is '
     '34 atmosphere wearing the slash, which is the whole system working: a '
     'borrowed mark and a known modifier, read in the frame that says danger',
     '<path d="M10.5 11.5h3M9.5 14h5M8 16.5h8"/><path d="M9.5 17.2 13 11.5"/>'),

    # ---- 3x system -------------------------------------------------------
    (31, 'power', 'system', 'electrical supply',
     '<path d="M12 7v5.5"/><path d="M9.1 9.6a4.4 4.4 0 1 0 5.8 0"/>'),
    (32, 'comms', 'system', 'signal link to somewhere else',
     '<path d="M12 17.5v-2.2"/>'
     '<path d="M9.2 13.4a4 4 0 0 1 5.6 0"/><path d="M6.9 10.6a8 8 0 0 1 10.2 0"/>'),
    (33, 'coolant', 'system', 'heat transfer loop',
     '<path d="M12 7.5 8.8 12.4 12 17.3 15.2 12.4Z"/>'),
    (34, 'atmosphere', 'system', 'breathable supply and its handling',
     '<path d="M7 9.5h10M9.5 13h7.5M7 16.5h10"/>'),
    (35, 'storage', 'system', 'held material or held data',
     '<path d="M8 7.5h8v9.5H8Z"/><path d="M8 10.7h8M8 13.9h8"/>'),
    (36, 'propulsion', 'system', 'thrust, and the machinery that makes it',
     '<path d="M9.5 7h5l2.5 5h-10Z"/><path d="M10 13.5v2.8M12 13.5v3.8'
     'M14 13.5v2.8"/>'),
    (37, 'navigation', 'system',
     'where the vehicle is and where it is pointed. ⚠️ drawn as an outline '
     'this is a capital A, and deepening the notch does not help because the '
     'SILHOUETTE is what reads as the letter. filling it does: letterforms are '
     'strokes, so a solid shape cannot be one. same class of mistake as the '
     'bowtie 39 had to be redrawn out of',
     '<path d="M12 6.5 15.6 17.4 12 12.6 8.4 17.4Z" fill="currentColor" '
     'stroke="none"/>'),
    (38, 'compute', 'system',
     'processing, and the machine that does it. the mark is a clock because a '
     'clock is the part of a computer you can actually point at',
     '<path d="M6.5 15.5v-6h4v6h4v-6h3"/>'),
    (39, 'structure', 'system',
     'hull, frame, and whatever everything else is bolted to. ⚠️ drawn first '
     'as a braced bay, which is an X between two rails and therefore a BOWTIE '
     'at size - the same mistake the hazard marks already cost a pass. a beam '
     'section is the thing itself and cannot collapse',
     '<path d="M7 8h10M7 16h10M12 8v8"/>'),

    # ---- 4x flow ---------------------------------------------------------
    (41, 'intake', 'flow', 'flow entering the system here',
     '<path d="M5 12h8"/><path d="M10.5 9 13.5 12l-3 3"/><path d="M17.5 8v8"/>'),
    (42, 'exhaust', 'flow', 'flow leaving the system here',
     '<path d="M6.5 8v8"/><path d="M10 12h8"/><path d="M15.5 9l3 3-3 3"/>'),
    (43, 'circulate', 'flow', 'flow returning to where it came from',
     '<path d="M7.5 10.3h9"/><path d="M14 7.8 16.5 10.3 14 12.8"/>'
     '<path d="M16.5 13.7h-9"/><path d="M10 16.2 7.5 13.7 10 11.2"/>'),
    (44, 'blocked', 'flow',
     'flow that cannot pass. ⚠️ the first drawing was 41 with the wall '
     'doubled, and at 30px the two were indistinguishable - which is a real '
     'failure in a set whose whole claim is that you can read it. it now '
     'carries the slash, the same negation 14 carries',
     '<path d="M5 12h8"/><path d="M10.5 9 13.5 12l-3 3"/><path d="M17.5 8v8"/>'
     '<path d="M7.8 16.2 16.2 7.8"/>'),
    (45, 'vent', 'flow', 'flow released to the outside, on purpose',
     '<path d="M12 15.8v-3.8"/><path d="M9.6 10.4 12 8l2.4 2.4"/>'
     '<path d="M7.5 13 9.2 11.3M16.5 13 14.8 11.3"/>'),
    (46, 'leak', 'flow',
     'flow leaving the channel where nothing was meant to leave. ⭐ 45 is the '
     'same event authorised, and keeping them apart is most of why this '
     'register exists',
     '<path d="M4.5 9.5h15"/>'
     '<path d="M14.5 10.8 13.2 13a1.8 1.8 0 1 0 2.6 0Z"/>'),
    (47, 'filtered', 'flow',
     'flow passes, and something is taken out of it on the way',
     '<path d="M4 12h4"/><path d="M10 8v8M12.5 8v8"/>'
     '<path d="M14.5 12h4.5"/><path d="M16.5 9.5 19 12l-2.5 2.5"/>'),
    (48, 'surge', 'flow',
     'flow above its rated rate. the doubled chevron is the fast end of the '
     'rate ladder 49 sits at the slow end of',
     '<path d="M4.5 12h8"/><path d="M11 8.5 14.5 12 11 15.5"/>'
     '<path d="M15 8.5 18.5 12 15 15.5"/>'),
    (49, 'trickle', 'flow',
     'flow present and below its rated rate. ⭐ the broken line is the rate, '
     'drawn rather than labelled - which is the same argument as the fill '
     'ladder in the state circle',
     '<path d="M4.5 12h2M8.5 12h2M12.5 12h2"/><path d="M16 9.5 18.5 12 16 14.5"/>'),

    # ---- 5x action -------------------------------------------------------
    (51, 'engage', 'action', 'start, and keep running',
     '<path d="M9.5 8 16 12l-6.5 4Z" fill="currentColor" stroke="none"/>'),
    (52, 'hold', 'action', 'suspend without releasing the state',
     '<path d="M10 9.4v5.2M14 9.4v5.2"/>'),
    (53, 'purge', 'action', 'empty this, discarding what is in it',
     '<path d="M12 7.5v3.6"/><path d="M10 10 12 12l2-2"/><path d="M8.9 14h6.2"/>'),
    (54, 'isolate', 'action', 'break the connection and leave both sides intact',
     '<path d="M6.9 12h2.6M14.5 12h2.6"/><path d="M12 7.2v9.6"/>'),
    (55, 'override', 'action',
     'proceed past a refusal. the only symbol in the set for doing something '
     'the system has already declined, so it is deliberately not comfortable',
     '<path d="M8.8 10.3v3.4"/><path d="M10 12h4.6"/>'
     '<path d="M13.2 10.6 14.6 12l-1.4 1.4"/>'),
    (56, 'abort', 'action',
     'stop now and do not resume. 52 keeps the state and this one does not',
     '<path d="M9 9h6v6H9Z" fill="currentColor" stroke="none"/>'),
    (57, 'reset', 'action',
     'return to the declared starting state. ⚠️ the head is solid because a '
     'stroked one left a ring with a nub, and a ring with a nub is 31 power',
     '<path d="M9.6 10.2a3.3 3.3 0 1 0 4.8 0"/>'
     '<path d="M13.4 8.4 15.6 10.6 13.2 11.8Z" fill="currentColor" '
     'stroke="none"/>'),
    (58, 'acknowledge', 'action',
     'you have seen it, and it stops asking. ⭐ it does not stop being true, '
     'which is why this is not the same control as 56',
     '<path d="M9.2 12.4 11.3 14.5 15 10.3"/>'),
    (59, 'step', 'action',
     'advance exactly one increment and stop. ⚠️ 51 with a wall added, which '
     'is the 41-against-44 shape of mistake - it survives only because the '
     'transport idiom is already learned everywhere, and it was checked '
     'against 51 at 30px before it was kept',
     '<path d="M9.6 9.4 13.6 12l-4 2.6Z" fill="currentColor" stroke="none"/>'
     '<path d="M14.8 9.9v4.2"/>'),

    # ---- 6x wayfinding ---------------------------------------------------
    (61, 'airlock', 'wayfinding',
     'a chamber with a door at each end, to be passed one at a time',
     '<path d="M7 19.5V10.5h10v9"/><path d="M10.2 19.5V13.2h3.6v6.3"/>'),
    (62, 'hatch', 'wayfinding',
     'a single closure that can be dogged shut against pressure',
     '<circle cx="12" cy="13.5" r="4"/>'
     '<path d="M12 9.9v7.2M8.4 13.5h7.2"/>'),
    (63, 'ladder', 'wayfinding', 'a route between decks, climbed',
     '<path d="M9 8.5v11M15 8.5v11"/><path d="M9 11.5h6M9 15h6M9 18.5h6"/>'),
    (64, 'corridor', 'wayfinding', 'a route along this deck, walked',
     '<path d="M9.5 10.5h5v3.5h-5Z"/><path d="M9.5 14 7 20M14.5 14 17 20"/>'),
    (65, 'deck', 'wayfinding',
     'a level. the long stroke is the one you are standing on',
     '<path d="M9 9h6M7 14h10M9 19h6"/>'),
    (66, 'muster station', 'wayfinding',
     'where people gather when something has gone wrong. ⭐ it is 71 crew '
     'present, twice, read in the frame that means A PLACE - which is the '
     'clearest case in the set of the frame doing the work',
     '<circle cx="9.6" cy="11" r="1.8"/>'
     '<path d="M6.9 17.4a2.7 2.7 0 0 1 5.4 0"/>'
     '<circle cx="14.4" cy="11" r="1.8"/>'
     '<path d="M11.7 17.4a2.7 2.7 0 0 1 5.4 0"/>'),
    (67, 'exit', 'wayfinding', 'the way out of this space, in an emergency',
     '<path d="M13.6 10.5h3.4v9h-3.4"/><path d="M7.2 14h5.2"/>'
     '<path d="M10.2 11.6 12.8 14 10.2 16.4"/>'),
    (68, 'position', 'wayfinding',
     'you are here. the only symbol in the set that means something different '
     'depending on where it is printed, which is why it is a pin and not a dot',
     '<circle cx="12" cy="11" r="3.4"/>'
     '<circle cx="12" cy="11" r="1.1" fill="currentColor" stroke="none"/>'
     '<path d="M12 14.4v5"/>'),
    (69, 'restricted', 'wayfinding',
     'a doorway you may not go through. the slash is the same negation 14, 44 '
     'and 76 carry',
     '<path d="M8.5 19.5V9.5h7v10"/><path d="M7.5 18.5 16 9.5"/>'),

    # ---- 7x crew ---------------------------------------------------------
    (71, 'crew present', 'crew', 'this space is occupied',
     '<circle cx="12" cy="8.6" r="2"/><path d="M9 14.2a3 3 0 0 1 6 0"/>'),
    (72, 'suit required', 'crew',
     'do not be here without a pressure suit. ⚠️ the visor was first a chord '
     'across a circle, which is the 15 absence dash wearing a different frame '
     'and therefore already spoken for',
     '<path d="M9.2 12a2.8 2.8 0 0 1 5.6 0v2.2H9.2Z"/><path d="M9.2 12h5.6"/>'),
    (73, 'eye protection', 'crew', 'do not be here without eye protection',
     '<circle cx="9.6" cy="11.3" r="2"/><circle cx="14.4" cy="11.3" r="2"/>'
     '<path d="M11.6 11.3h0.8"/>'),
    (74, 'hearing protection', 'crew',
     'do not be here without hearing protection',
     '<path d="M9.7 11.8v-1a2.3 2.3 0 0 1 4.6 0v1"/>'
     '<path d="M8.8 11.8h1.8v2.6H8.8Z"/><path d="M13.4 11.8h1.8v2.6h-1.8Z"/>'),
    (75, 'medical', 'crew', 'treatment, and the people qualified to give it',
     '<path d="M12 7.5v9M7.5 12h9"/>'),
    (76, 'unmanned', 'crew',
     'nobody is meant to be in here. ⭐ it is the crew figure negated, so a '
     'person in this space is the anomaly rather than the default',
     '<circle cx="12" cy="8.6" r="2"/><path d="M9 14.2a3 3 0 0 1 6 0"/>'
     '<path d="M9.4 14.8 15.6 7.8"/>'),

    # ---- 8x maintenance --------------------------------------------------
    (81, 'fastener', 'maintenance',
     'a bolted joint. ⭐ a bolt says THIS FACE IS FIXED, which is exactly what '
     'stops the bolts on a rack faceplate being decoration',
     '<path d="M8.9 7.6h6.2v3.2H8.9Z"/><path d="M12 10.8v6.2"/>'
     '<path d="M10 12.9h4M10 15h4"/>'),
    (82, 'seal', 'maintenance',
     'a gasket or ring that is consumed by being opened, and is replaced '
     'rather than reused',
     '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2.4"/>'),
    (83, 'filter element', 'maintenance',
     'a consumable that gets dirty on purpose so nothing downstream does',
     '<path d="M8.4 9h7.2v6H8.4Z"/><path d="M10.8 9v6M13.2 9v6"/>'),
    (84, 'fuse', 'maintenance',
     'a part that is meant to fail, so that the expensive part does not',
     '<path d="M6.8 12h1.6M15.6 12h1.6"/><path d="M8.4 9.4h7.2v5.2H8.4Z"/>'),
    (85, 'calibration point', 'maintenance',
     'where an instrument is told what true is. ⭐ every readout in this kit '
     'that refuses to invent a value is relying on somebody having come here',
     '<path d="M12 6.9v10.2M6.9 12h10.2"/><circle cx="12" cy="12" r="3"/>'),
    (86, 'lockout', 'maintenance',
     'deliberately dead for servicing, and not to be re-energised by anyone '
     'who did not kill it. the most important mark in this family',
     '<path d="M9.9 11.4V9.9a2.1 2.1 0 0 1 4.2 0v1.5"/><path d="M8.8 11.4h6.4v4.8H8.8Z"/>'),
]

# 🔴 The two-digit scheme cannot number a tenth family, and the ones digit
# cannot be 0 without colliding with the reserved 00.
MAX_CATEGORIES = 9


def check():
    """The rules, enforced. A symbol that has drifted out of its family, or a
    number whose tens digit disagrees with its category, is a set that has
    stopped being a standard."""
    bad = []
    cats = list(CATEGORY_MEANS)
    seen = set()
    marks = {}

    # 🔴 The numbering is the constraint, not a convention. A tenth family is
    # not another row in this file, it is a different scheme, and it should be
    # a decision somebody makes rather than something that happens.
    if len(cats) > MAX_CATEGORIES:
        bad.append(f'{len(cats)} categories: the two-digit scheme numbers at '
                   f'most {MAX_CATEGORIES}, so a tenth family needs a new one')
    if set(cats) != set(FRAMES):
        bad.append('CATEGORY_MEANS and FRAMES disagree about which families '
                   'exist')
    # Two families wearing the same frame would break the entire claim, since
    # the frame is what carries the category.
    for cat, frame in FRAMES.items():
        twin = [c for c, f in FRAMES.items() if f == frame and c != cat]
        if twin:
            bad.append(f'{cat}: shares its frame with {twin[0]}')

    for num, name, cat, means, mark in REGISTER:
        if num in seen:
            bad.append(f'{num:02d} {name}: number used twice')
        seen.add(num)
        if not means or len(means) < 12:
            bad.append(f'{num:02d} {name}: no stated meaning')
        # ⚠️ Two symbols drawn identically is the failure 41-against-44 nearly
        # was, caught at its most extreme. The frame legitimately makes the
        # SAME modifier mean different things, but the whole mark repeating is
        # a copy-paste, not a system.
        if mark in marks:
            bad.append(f'{num:02d} {name}: drawn identically to '
                       f'{marks[mark]}')
        marks[mark] = f'{num:02d} {name}'
        if cat is None:
            continue
        if cat not in FRAMES:
            bad.append(f'{num:02d} {name}: category {cat} has no frame')
            continue
        # 🔴 The number carries the same information the frame does, so they
        # have to agree or one of them is lying.
        want = cats.index(cat) + 1
        if num // 10 != want:
            bad.append(f'{num:02d} {name}: number says category '
                       f'{num // 10}, register says {want} ({cat})')
        if num % 10 == 0:
            bad.append(f'{num:02d} {name}: ones digit 0 is reserved')

    for cat in cats:
        if not any(c == cat for _n, _nm, c, _m, _k in REGISTER):
            bad.append(f'{cat}: a family with a frame and no symbols')
    return bad


def symbols():
    """Frame plus mark, per symbol."""
    for num, name, cat, means, mark in REGISTER:
        frame = FRAMES[cat] if cat else ''
        yield num, name, cat, means, frame + mark


if __name__ == '__main__':
    import sys
    # 🔴 THIS FILE HAD NO __main__, the same gap chrome.py had, so
    # `python3 tools/icons.py` exited 0 having checked nothing. The rules did
    # fail the BUILD, through gen_icons.py, but could not be run on their own.
    # Now they can, and a failure exits non-zero.
    bad = check()
    if bad:
        print('icons.py check FAILED:', *bad, sep='\n  ')
        sys.exit(1)
    print('icons.py check ok')
