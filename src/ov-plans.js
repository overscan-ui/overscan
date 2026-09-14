/* Stock plans for <ov-schematic>: a body, a head, a vehicle and a ship.
 *
 *   import plans from 'overscan/plans';
 *   OvSchematic.plans = plans;                        then  <ov-schematic stock="body">
 *   <ov-schematic stock="ship" plans="…/ov-plans.js">  or name the module on the element
 *
 * 🔴 DATA, NOT A MODULE THE KIT RUNS. It registers nothing, and `import
 * 'overscan'` does not load it: a page that draws only its own plans pays
 * nothing for these.
 *
 * Every plan is the same shape ov-schematic already takes (rooms, parts,
 * pipes), plus three things a drawing needs and a floor plan did not:
 *
 *   room.d        a path, for a region that is not a rectangle. Its label goes
 *                 at lx, ly (anchor start | middle | end), and a region too
 *                 small to hold its own name gets a `lead` line out to it.
 *   outline       paths drawn as a plain line under everything: a skull, a
 *                 car body, a hull. An outline is NOT A PART. It is never lit,
 *                 never hatched and never counted, because nothing reports it.
 *   orient        which way the drawing faces, printed on it. ⭐ A stock
 *                 drawing that does not say so invites exactly the error a
 *                 reader cannot see: left and right. L and R are always the
 *                 SUBJECT'S, the way a chart or a driver names them.
 *
 * The ids are the contract: a report for `forearm_l` lights the subject's
 * left forearm. A report naming an id the plan does not have is counted by
 * the schematic, never matched to the nearest name.
 */

const r1 = (n) => +n.toFixed(1);

/* Flip a path left to right inside a plan `w` wide. Absolute M, L, C and Z
 * only, so every even number in a command is an x. The two sides of the body
 * are then the same shape by construction, not by two hands. */
const mirror = (d, w) => {
  let i = 0;
  return d.replace(/[A-Za-z]|\d*\.?\d+/g, (t) => {
    if (/[A-Za-z]/.test(t)) { i = 0; return t; }
    const n = Number(t);
    const out = i % 2 === 0 ? r1(w - n) : n;
    i += 1;
    return String(out);
  });
};

/* ── body ─────────────────────────────────────────────────────────────── */

/* ⭐ MEASURED, NOT DRAWN BY EYE. Every landmark below is in HEAD UNITS (top of
 * head 0, chin 1) from ANSUR II, the 2012 US Army anthropometric survey,
 * averaged between its men and women so the figure claims no sex:
 *
 *   sole 7.50   ankle 7.20   knee 5.43   fingertip 4.69   crotch 3.89
 *   wrist 3.86  trochanter 3.63   navel 2.99   elbow 2.90   nipples 2.04
 *   shoulder line and pit of the neck 1.35
 *   widths: head 0.67, neck 0.51, across the acromions 1.73, hips at the
 *   trochanters 1.55, waist at the navel 1.39, thigh 0.88 at the top and 0.57
 *   above the knee, knee 0.5, calf 0.54, ankle 0.31, forearm 0.40 at its
 *   widest and 0.23 at the wrist, hand 0.37.
 *
 * A first draft placed these by eye and was a box with short legs: crotch at
 * 4.31, knee at 5.91, a head 0.81 wide and shoulders wider than any survey.
 * tools/schematic-test measures the drawn figure against these numbers.
 *
 * Coordinates here are (x, y) in head units, x outward from the midline. The
 * arms hang about ten degrees from the body, so hand and thigh stay apart. */
const BODY_W = 360;
const BODY_MID = 180;
const HEAD = 56;
const BODY_TOP = 14;
const bx = (x) => r1(BODY_MID + x * HEAD);
const by = (y) => r1(BODY_TOP + y * HEAD);

/* A path from commands in head units: ['M', p] | ['L', p] | ['C', c1, c2, p].
 * `side` is -1 for the subject's right, which a front view draws on the
 * viewer's left. */
const bodyPath = (cmds, side = 1) => cmds
  .map(([op, ...ps]) => op + ps.map(([x, y]) => `${bx(side * x)} ${by(y)}`).join(' '))
  .join('') + 'Z';

/* A region symmetric about the midline: the right half as cubic segments
 * [c1x, c1y, c2x, c2y, x, y] from (0, top) down, closed by its own mirror. */
function bodySym(top, segs) {
  const pts = [[0, top], ...segs.map((s) => [s[4], s[5]])];
  let d = `M${bx(0)} ${by(top)}`;
  for (const s of segs) d += `C${bx(s[0])} ${by(s[1])} ${bx(s[2])} ${by(s[3])} ${bx(s[4])} ${by(s[5])}`;
  const [lx, ly] = pts[pts.length - 1];
  d += `L${bx(-lx)} ${by(ly)}`;
  for (let i = segs.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = segs[i];
    const [px, py] = pts[i];
    d += `C${bx(-c2x)} ${by(c2y)} ${bx(-c1x)} ${by(c1y)} ${bx(-px)} ${by(py)}`;
  }
  return `${d}Z`;
}
/* A straight cubic, so a straight edge can sit in a run of curves. */
const straight = (x0, y0, x, y) => [x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (2 * (x - x0)) / 3, y0 + (2 * (y - y0)) / 3, x, y];

/* Shared edges are written once and walked both ways, so two regions that
 * meet have exactly one line between them: no gap, no overlap. */
const ARMPIT = [[0.80, 1.50], [0.70, 1.75], [0.66, 1.88]];   /* from the acromion (0.865, 1.35) */

/* The subject's RIGHT side: [id, word, commands, label y, lead target]. */
const LIMBS = [
  ['arm', 'ARM', [
    ['M', [0.865, 1.35]], ['C', [1.02, 1.36], [1.10, 1.50], [1.08, 1.75]], ['C', [1.10, 2.20], [1.28, 2.50], [1.29, 2.90]],
    ['L', [0.95, 2.90]], ['C', [0.90, 2.50], [0.72, 2.15], ARMPIT[2]], ['C', ARMPIT[1], ARMPIT[0], [0.865, 1.35]],
  ], 2.15, [1.0, 2.3]],
  ['forearm', 'FOREARM', [
    ['M', [0.95, 2.90]], ['L', [1.29, 2.90]], ['C', [1.36, 3.10], [1.44, 3.45], [1.415, 3.86]],
    ['L', [1.185, 3.86]], ['C', [1.12, 3.45], [0.92, 3.15], [0.95, 2.90]],
  ], 3.3, [1.18, 3.35]],
  ['hand', 'HAND', [
    ['M', [1.185, 3.86]], ['L', [1.415, 3.86]], ['C', [1.49, 4.02], [1.53, 4.30], [1.48, 4.55]],
    ['C', [1.45, 4.68], [1.34, 4.72], [1.30, 4.60]], ['C', [1.24, 4.40], [1.14, 4.10], [1.185, 3.86]],
  ], 4.05, [1.34, 4.3]],
  ['thigh', 'THIGH', [
    ['M', [0.03, 3.92]], ['L', [0.775, 3.63]], ['C', [0.86, 4.0], [0.70, 4.9], [0.57, 5.43]],
    ['L', [0.07, 5.43]], ['C', [0.08, 5.0], [0.05, 4.4], [0.03, 3.92]],
  ], 5.0, [0.42, 4.6]],
  ['leg', 'LEG', [
    ['M', [0.07, 5.43]], ['L', [0.57, 5.43]], ['C', [0.62, 5.80], [0.60, 6.40], [0.415, 7.20]],
    ['L', [0.105, 7.20]], ['C', [0.06, 6.5], [0.03, 5.9], [0.07, 5.43]],
  ], 6.25, [0.33, 6.3]],
  ['foot', 'FOOT', [
    ['M', [0.105, 7.20]], ['L', [0.415, 7.20]], ['C', [0.45, 7.32], [0.52, 7.44], [0.52, 7.50]],
    ['L', [0.06, 7.50]], ['C', [0.07, 7.42], [0.09, 7.30], [0.105, 7.20]],
  ], 7.15, [0.28, 7.38]],
];

/* Labels sit in a column outside the figure, a lead line in to each. */
const LEAD_X = 78;
const sides = [];
for (const [id, word, cmds, yl, [px, py]] of LIMBS) {
  const d = bodyPath(cmds, -1);
  const ly = by(yl);
  const lead = [LEAD_X, ly, bx(-px), by(py)];
  sides.push({ id: `${id}_r`, label: `R ${word}`, d, lx: 8, ly: r1(ly + 3), anchor: 'start', lead });
  sides.push({
    id: `${id}_l`, label: `L ${word}`, d: mirror(d, BODY_W), lx: BODY_W - 8, ly: r1(ly + 3), anchor: 'end',
    lead: [BODY_W - lead[0], lead[1], r1(BODY_W - lead[2]), lead[3]],
  });
}

export const body = {
  name: 'body',
  width: BODY_W,
  height: 452,
  orient: "FRONT VIEW · SUBJECT'S RIGHT ON THE LEFT",
  rooms: [
    // An egg widest at 0.42, 0.67 wide, narrowing through the jaw to the chin.
    { id: 'head', label: 'HEAD', d: bodySym(0, [[0.19, 0, 0.335, 0.16, 0.335, 0.42], [0.335, 0.62, 0.30, 0.78, 0.23, 0.88], [0.17, 0.96, 0.09, 1.0, 0, 1.0]]), lx: bx(0), ly: by(0.55), anchor: 'middle' },
    // Under the jaw line to the pit of the neck: 0.51 wide at its base.
    {
      id: 'neck', label: 'NECK',
      d: bodyPath([['M', [-0.23, 0.88]], ['C', [-0.17, 0.96], [-0.09, 1.0], [0, 1.0]], ['C', [0.09, 1.0], [0.17, 0.96], [0.23, 0.88]],
        ['C', [0.24, 1.0], [0.25, 1.1], [0.26, 1.20]], ['L', [-0.26, 1.20]], ['C', [-0.25, 1.1], [-0.24, 1.0], [-0.23, 0.88]]]),
      lx: BODY_W - 8, ly: r1(by(1.05) + 3), anchor: 'end', lead: [BODY_W - LEAD_X, by(1.05), bx(0.15), by(1.05)],
    },
    // Trapezius out to the acromion at 1.35, the armpit, the ribs to 2.45.
    { id: 'chest', label: 'CHEST', d: bodySym(1.20, [straight(0, 1.20, 0.26, 1.20), [0.45, 1.24, 0.70, 1.28, 0.865, 1.35], [...ARMPIT[0], ...ARMPIT[1], ...ARMPIT[2]], [0.64, 2.05, 0.62, 2.30, 0.60, 2.45]]), lx: bx(0), ly: by(1.85), anchor: 'middle' },
    // In at the waist, out to 1.39 at the navel's level and on to the iliac crest.
    { id: 'abdomen', label: 'ABDOMEN', d: bodySym(2.45, [straight(0, 2.45, 0.60, 2.45), [0.57, 2.70, 0.62, 3.00, 0.70, 3.30]]), lx: bx(0), ly: by(2.85), anchor: 'middle' },
    // Out to the trochanters (1.55 wide at 3.63), then the groin line to the crotch.
    { id: 'pelvis', label: 'PELVIS', d: bodySym(3.30, [straight(0, 3.30, 0.70, 3.30), [0.76, 3.45, 0.79, 3.55, 0.775, 3.63], straight(0.775, 3.63, 0.03, 3.92)]), lx: bx(0), ly: by(3.52), anchor: 'middle' },
    ...sides,
  ],
  parts: [],
  pipes: [],
};

/* ── head ─────────────────────────────────────────────────────────────── */

/* The brain seen from the left, face to the left, inside the head.
 *
 * ⭐ MEASURED TOO, with the sources' own uncertainty kept. Positions are
 * fractions of the cerebrum: u along its length from the frontal pole, v down
 * its height from the top to the temporal lobe's lower edge.
 *
 *   length : height 1.5. A 167 x 93 mm brain gives 1.8, but that height
 *     leaves out the temporal lobe's lower edge; lateral drawings and scans
 *     read nearer 1.5, and that is what is drawn.
 *   central sulcus: meets the top about 10 mm behind the middle (u 0.56) and
 *     runs down and FORWARD to just above the lateral fissure (u 0.42).
 *   lateral fissure: from behind the temporal pole, rising gently backward,
 *     turning up at its end.
 *   preoccipital notch u 0.70, the low end of the occipital boundary.
 *   cerebellum under the occipital lobe, about a third of the length.
 *   brainstem 70-75 mm long, about 30 mm wide at the pons, narrower at the
 *     medulla. Its angle is set by where it has to go: down through the skull
 *     base into the spinal canal, which runs down the neck behind the airway.
 *     Drawn about 8 degrees back from vertical, so carried on down it meets
 *     the base of the neck two thirds of the way from the throat to the nape.
 *   head: taller than long (about 0.87 with the face), with about 13 mm of
 *     scalp and skull around the brain and the face below the front third.
 *
 * The first draft had a head 1.2 times longer than tall, a brainstem hanging
 * straight down and the central sulcus in front of the middle. The second
 * leaned the brainstem 30 degrees back, which carried it out through the back
 * of the neck. */
const BRAIN_X = 70;
const BRAIN_Y = 34;
const BRAIN_L = 230;
const BRAIN_H = 153;
const ux = (u) => r1(BRAIN_X + u * BRAIN_L);
const vy = (v) => r1(BRAIN_Y + v * BRAIN_H);

const B = {
  F: [0, 0.45], C0: [0.56, 0.01], P0: [0.82, 0.07], O: [1.0, 0.55], K: [0.95, 0.78], N: [0.70, 0.92],
  M: [0.60, 0.975], Q: [0.47, 1.0], T: [0.19, 0.82], S0: [0.24, 0.62], C1: [0.42, 0.56], S1: [0.60, 0.50],
  J: [0.76, 0.55], G: [0.64, 1.18], Cb: [0.84, 1.24], Bb: [0.652, 1.608], Bf: [0.539, 1.621],
};
/* Every boundary once, as a cubic [from, c1, c2, to]. A region walks them,
 * some backward, so neighbours share one line. */
const EDGE = {
  top: [B.F, [0, 0.16], [0.22, 0], B.C0],              // frontal pole over the top to the central sulcus
  crown: [B.C0, [0.68, 0.015], [0.76, 0.04], B.P0],
  back: [B.P0, [0.94, 0.16], [1.01, 0.36], B.O],       // to the occipital pole
  occLow: [B.O, [1.0, 0.66], [0.98, 0.73], B.K],
  tentorium: [B.K, [0.88, 0.86], [0.78, 0.90], B.N],   // occipital lobe over the cerebellum
  notch: [B.N, [0.66, 0.95], [0.63, 0.965], B.M],
  stemTop: [B.M, [0.56, 0.99], [0.51, 1.0], B.Q],
  temporalLow: [B.Q, [0.34, 1.0], [0.23, 0.97], B.T],  // to the temporal pole
  pole: [B.T, [0.15, 0.72], [0.18, 0.64], B.S0],
  orbital: [B.S0, [0.14, 0.66], [0.03, 0.62], B.F],    // under the frontal lobe
  central: [B.C0, [0.53, 0.20], [0.47, 0.36], B.C1],
  fissureFront: [B.S0, [0.30, 0.60], [0.36, 0.58], B.C1],
  fissureBack: [B.C1, [0.48, 0.54], [0.54, 0.52], B.S1],
  parietoTemporal: [B.S1, [0.65, 0.52], [0.71, 0.54], B.J],
  parietoOccipital: [B.P0, [0.80, 0.25], [0.78, 0.42], B.J],
  occipitoTemporal: [B.J, [0.74, 0.70], [0.72, 0.82], B.N],
  stemBack: [B.M, [0.58, 1.06], [0.60, 1.14], B.G],
  cerebellumLow: [B.G, [0.70, 1.23], [0.76, 1.25], B.Cb],
  cerebellumBack: [B.Cb, [0.96, 1.22], [1.01, 0.98], B.K],
  stemLow: [B.G, [0.655, 1.32], [0.66, 1.47], B.Bb],
  stemEnd: [B.Bb, [0.65, 1.64], [0.56, 1.65], B.Bf],
  stemFront: [B.Bf, [0.51, 1.40], [0.43, 1.17], B.Q],   // the pons bulges forward
};
const back = (e) => [e[3], e[2], e[1], e[0]];
const brainPath = (edges) => {
  const p = ([u, v]) => `${ux(u)} ${vy(v)}`;
  return `M${p(edges[0][0])}` + edges.map((e) => `C${p(e[1])} ${p(e[2])} ${p(e[3])}`).join('') + 'Z';
};

/* A smooth open line through points (Catmull-Rom), for the head's outline. */
function through(points) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b, c, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${r1(b[0] + (c[0] - a[0]) / 6)} ${r1(b[1] + (c[1] - a[1]) / 6)} ${r1(c[0] - (e[0] - b[0]) / 6)} ${r1(c[1] - (e[1] - b[1]) / 6)} ${c[0]} ${c[1]}`;
  }
  return d;
}

/* From the throat up the face, over the vertex and down the back of the
 * skull to the nape. About 18 px, 13 mm at this scale, clear of the brain at
 * the forehead, the top and the back.
 *
 * The face is spaced by the usual profile proportions, from the bridge of the
 * nose (y 176) to the underside of the chin (y 331): the base of the nose
 * about 43% of the way down, the mouth a third of the way through what is
 * left, the chin the rest. Going up from the throat: under the chin, the chin
 * forward, the dip under the lower lip, the LOWER LIP out, the mouth line in,
 * the upper lip out, the base of the nose, the tip, the bridge, the brow. */
const HEAD_OUTLINE = through([
  [110, 350], [88, 339], [60, 333], [46, 324], [42, 312], [46, 297], [42, 284], [44, 273], [41, 260],
  [45, 244], [27, 226], [48, 176], [44, 154], [50, 110], [76, 50], [150, 16], [240, 24], [304, 70],
  [324, 150], [312, 216], [288, 248], [270, 272], [266, 350],
]);

const OUT_X = 412;      /* the right-hand label column, clear of the skull */
const OUT_LEAD = 338;

export const head = {
  name: 'head',
  width: 420,
  height: 372,
  orient: 'LEFT SIDE VIEW · FACE TO THE LEFT',
  outline: [HEAD_OUTLINE],
  rooms: [
    { id: 'frontal', label: 'FRONTAL', d: brainPath([EDGE.top, EDGE.central, back(EDGE.fissureFront), EDGE.orbital]), lx: ux(0.25), ly: vy(0.30), anchor: 'middle' },
    { id: 'parietal', label: 'PARIETAL', d: brainPath([EDGE.crown, EDGE.parietoOccipital, back(EDGE.parietoTemporal), back(EDGE.fissureBack), back(EDGE.central)]), lx: ux(0.66), ly: vy(0.25), anchor: 'middle' },
    { id: 'occipital', label: 'OCCIPITAL', d: brainPath([EDGE.back, EDGE.occLow, EDGE.tentorium, back(EDGE.occipitoTemporal), back(EDGE.parietoOccipital)]), lx: OUT_X, ly: 100, anchor: 'end', lead: [OUT_LEAD, 96, ux(0.88), vy(0.45)] },
    { id: 'temporal', label: 'TEMPORAL', d: brainPath([EDGE.fissureFront, EDGE.fissureBack, EDGE.parietoTemporal, EDGE.occipitoTemporal, EDGE.notch, EDGE.stemTop, EDGE.temporalLow, EDGE.pole]), lx: ux(0.46), ly: vy(0.80), anchor: 'middle' },
    { id: 'cerebellum', label: 'CEREBELLUM', d: brainPath([EDGE.tentorium, EDGE.notch, EDGE.stemBack, EDGE.cerebellumLow, EDGE.cerebellumBack]), lx: OUT_X, ly: 200, anchor: 'end', lead: [OUT_LEAD, 196, ux(0.82), vy(1.08)] },
    { id: 'brainstem', label: 'BRAINSTEM', d: brainPath([back(EDGE.stemTop), EDGE.stemBack, EDGE.stemLow, EDGE.stemEnd, EDGE.stemFront]), lx: OUT_X, ly: 300, anchor: 'end', lead: [OUT_LEAD, 296, ux(0.60), vy(1.40)] },
  ],
  parts: [],
  pipes: [],
};

/* ── vehicle ──────────────────────────────────────────────────────────── */

/* A car from above, front to the right, so the subject's left side is at the
 * top of the drawing. The fuel line is a real flow path: tank, pump, shutoff,
 * injectors. A wheel is too small to hold its name and its note, so the left
 * wheels are named above the car and the right wheels below it. */
const wheel = (id, label, x, left) => (left
  ? { id, label, x, y: 40, w: 62, h: 18, lx: x, ly: 20, anchor: 'start' }
  : { id, label, x, y: 198, w: 62, h: 18, lx: x, ly: 230, anchor: 'start' });

export const vehicle = {
  name: 'vehicle',
  width: 440,
  height: 262,
  orient: 'TOP VIEW · FRONT TO THE RIGHT, LEFT SIDE AT THE TOP',
  outline: [
    'M62 62L360 62C400 62 420 90 420 128C420 166 400 194 360 194L62 194C46 194 38 174 38 128C38 82 46 62 62 62Z',
  ],
  rooms: [
    { id: 'trunk', label: 'TRUNK', d: 'M140 70L64 70C52 72 46 90 46 128C46 166 52 184 64 186L140 186Z', lx: 60, ly: 88, anchor: 'start' },
    { id: 'cabin', label: 'CABIN', x: 146, y: 70, w: 164, h: 116 },
    { id: 'engine', label: 'ENGINE', d: 'M316 70L360 70C392 72 410 96 412 128C410 160 392 184 360 186L316 186Z', lx: 322, ly: 88, anchor: 'start' },
    wheel('wheel_lr', 'L REAR', 66, true),
    wheel('wheel_lf', 'L FRONT', 314, true),
    wheel('wheel_rr', 'R REAR', 66, false),
    wheel('wheel_rf', 'R FRONT', 314, false),
  ],
  parts: [
    { id: 'fuel_tank', label: 'TANK', kind: 'tank', x: 92, y: 150, source: true },
    { id: 'fuel_pump', label: 'PUMP', kind: 'pump', x: 196, y: 150 },
    { id: 'fuel_shutoff', label: 'SHUTOFF', kind: 'valve', x: 262, y: 150 },
    { id: 'injectors', label: 'INJ', kind: 'node', x: 356, y: 150 },
  ],
  pipes: [
    { from: 'fuel_tank', to: 'fuel_pump' },
    { from: 'fuel_pump', to: 'fuel_shutoff' },
    { from: 'fuel_shutoff', to: 'injectors' },
  ],
};

/* ── ship ─────────────────────────────────────────────────────────────── */

/* One deck, bow to the right. The rooms are cut from the hull's own taper, so
 * no room reaches past the hull or stops short of it. */
const top = (x) => +(72 - (22 * (x - 40)) / 340).toFixed(1);
const bot = (x) => +(198 + (22 * (x - 40)) / 340).toFixed(1);

export const ship = {
  name: 'ship',
  width: 560,
  height: 244,
  orient: 'DECK PLAN · BOW TO THE RIGHT',
  outline: [
    'M40 72L380 50C470 50 540 100 552 135C540 170 470 220 380 220L40 198Z',
    'M40 90L22 86L22 110L40 106Z',
    'M40 164L22 160L22 184L40 180Z',
  ],
  rooms: [
    { id: 'engines', label: 'ENGINES', d: `M40 72L120 ${top(120)}L120 ${bot(120)}L40 198Z`, lx: 48, ly: 92, anchor: 'start' },
    { id: 'reactor', label: 'REACTOR', d: `M120 ${top(120)}L200 ${top(200)}L200 ${bot(200)}L120 ${bot(120)}Z`, lx: 128, ly: 88, anchor: 'start' },
    { id: 'engineering', label: 'ENGINEERING', d: `M200 ${top(200)}L290 ${top(290)}L290 133L200 133Z`, lx: 206, ly: 82, anchor: 'start' },
    { id: 'cargo', label: 'CARGO', d: `M200 137L290 137L290 ${bot(290)}L200 ${bot(200)}Z`, lx: 206, ly: 152, anchor: 'start' },
    { id: 'quarters', label: 'QUARTERS', d: `M290 ${top(290)}L380 50L380 133L290 133Z`, lx: 296, ly: 76, anchor: 'start' },
    { id: 'medbay', label: 'MEDBAY', d: `M290 137L380 137L380 220L290 ${bot(290)}Z`, lx: 296, ly: 152, anchor: 'start' },
    { id: 'bridge', label: 'BRIDGE', d: 'M380 50C470 50 540 100 552 135C540 170 470 220 380 220Z', lx: 392, ly: 132, anchor: 'start' },
  ],
  parts: [],
  pipes: [],
};

const plans = { body, head, vehicle, ship };
export default plans;
