## Context

See proposal.md — Why. The pieces that shape the approach:

- Catalog candidates reach the sky view as `{name, ra, dec, magnitude,
  object_type}`; `object_type` is the readable label the astro backend
  derives from the SIMBAD code (`_OTYPE_LABELS` in `catalog.py`), not
  the code. The code is not stored anywhere on the Go side. The
  frontend's `categories.js` maps code → label for the 70 offered
  categories, and the project already requires the two label tables to
  agree word for word.
- The astro backend also labels codes the picker does not offer ("Low-mass
  X-ray binary", "Galaxy in pair", "Seyfert galaxy", "Emission object",
  "Region"…), appends " (candidate)" for `?`-suffixed codes, and falls
  back to "Star", "Galaxy" or the raw code for anything else. Messier and
  names sets produce these freely.
- Markers are drawn on a react-konva canvas. `FixedMarker` in `obs.jsx`
  today picks one of three shapes from a regexp classification of the
  label; its footprint is a 12-pixel-diameter star or circle. Every
  marker sits in a `Group` that owns the hover, click and tap handlers,
  so any Konva shape inside it takes part in hit testing.
- The canvas paints the sky light blue (`#87CEEB`) at every hour — time
  of day shows in the paths' colors, not the background — and the ground
  below the horizon brown (`#D69847`); an object below the horizon is
  drawn over the ground. An icon has to read on both, and the existing
  black outline on a colored fill does.
- The UI has no test runner. `npm run build` is the whole automated check;
  everything else is eyeballed in the dev stack.

## Goals / Non-Goals

**Goals:**
- One place that defines an icon per category code, close enough to
  `categories.js` that adding a category makes the missing icon obvious.
- A drawing model small enough that all 70 icons are parameters of six
  base-shape components rather than 70 hand-drawn shapes.
- Same hit-testing footprint and layer order as today.

**Non-Goals:**
- A user-facing legend, icons in the category picker, or icons in the
  candidate table of the searches dialog.
- Changing any label, the picker's grouping, or anything that crosses the
  network.
- Distinguishing "(candidate)" types visually.

## Decisions

**Key icons on the label, not the code.** The candidates carry only the
label, so the lookup goes label → code (via `categories.js`) → icon. The
alternative — adding the code to the astro response, the Go `TargetObject`
model and the stored candidates — would touch three tiers and a migration
for what is a display concern, and the label agreement rule already
exists and is checked by the astro test suite. Cost: a label rename
must happen in both tables, as it already must.

**One module, `obs-ui/src/icons.jsx`, three layers.** (1) Six base-shape
components, each taking the variation parameters it understands. (2) An
`ICONS` table keyed by category code: `{base, ...params}`. (3)
`CategoryIcon({x, y, objectType})`, the drop-in for `FixedMarker`, which
resolves the label to a table entry or a fallback and renders the base
with the parameters. `categories.js` stays pure data — it is imported by
the searches dialog, which must not pull in react-konva.

**Group base shapes and variations.** Sizes are Konva units on the
1000×500 virtual scene; every icon stays inside a 16-unit square, the
same as today's 12-unit star plus the room a letter tag needs. Letters
are drawn as a 7-unit black text on a small white rounded tag anchored to
the shape's lower right, so they read on the sky and on the ground
alike. "Halo" means a thin black ring at radius 8 around the shape; "dot"
means a white disc of radius 1.2 with a black outline.

*Stars* — base: four-point star, inner radius 0.3 × outer, black
outline. Size classes: dwarf 4, normal 6, giant 7, supergiant 8.

| code | size | fill | variation |
|---|---|---|---|
| `*` | 6 | white | — |
| `MS*` | 6 | white | letters MS |
| `RG*` | 7 | orangered | — |
| `s*b` | 8 | dodgerblue | — |
| `s*r` | 8 | red | — |
| `s*y` | 8 | gold | — |
| `AB*` | 7 | orange | halo (dust shell) |
| `HB*` | 6 | white | letters HB |
| `WD*` | 4 | white | — |
| `BD*` | 4 | saddlebrown | — |
| `HS*` | 4 | deepskyblue | — |
| `C*` | 7 | darkred | letter C |
| `S*` | 7 | orangered | letter S |
| `Em*` | 6 | white | halo |
| `Be*` | 6 | deepskyblue | halo |
| `WR*` | 7 | mediumpurple | halo |
| `TT*` | 5 | orange | flat ellipse under the star (the disc) |
| `pr*` | 5 | white | flat ellipse under the star |
| `YSO` | 5 | white | translucent grey disc behind (the envelope) |
| `PM*` | 6 | white | short arrow pointing right |
| `N*` | 4 | slategray | — |
| `Psr` | 4 | slategray | two short beam lines on one diagonal, past the points |
| `BH` | — | black disc r=4 | orange ring r=6 in place of the black outline; the one star icon that is not a star shape, since a black hole has no photosphere to draw |

*Double and multiple stars* — base: a primary disc r=3.5 at (−2.5, 0.5)
and a secondary disc r=2.5 at (3.5, −2), both black-outlined.

| code | variation |
|---|---|
| `**` | both white |
| `EB*` | secondary dark grey and drawn in front, overlapping the primary (the eclipse) |
| `SB*` | discs merged into one overlapping pair (unresolved), primary gold and secondary deepskyblue (two spectra, one point of light) |
| `CV*` | primary orange, secondary white with a thin ring (the accretion disc) |
| `No*` | secondary replaced by a small yellow four-point star (the outburst) |
| `XB*` | primary deepskyblue, secondary black with a thin ring |
| `SyS` | primary red and r=4 (the giant), secondary white |

*Variable stars* — base: four-point star size 6 inside a second, thin
black star outline at 1.5× the size with a fatter waist (inner radius
0.55 of the outer instead of 0.3), the throb. The waist is what keeps a
visible gap between the two outlines: a same-shaped outline at 1.35×
merged with the inner star's stroke and read as a heavier outline.
Distinct from the stars' halo, which is round.

| code | size | fill | variation |
|---|---|---|---|
| `V*` | 6 | white | — |
| `Pu*` | 6 | white | letter P |
| `Ce*` | 7 | gold | — |
| `RR*` | 5 | white | letters RR |
| `Mi*` | 7 | red | — |
| `LP*` | 7 | orangered | letters LP |
| `dS*` | 5 | white | letters dS |
| `bC*` | 6 | dodgerblue | — |
| `RV*` | 7 | gold | letters RV |
| `Ro*` | 6 | white | letters Ro |
| `Er*` | 6 | orange | — |
| `Fl*` | 6 | tomato | small yellow four-point spark at the upper-right point |

*Clusters* — base: black-outlined circle r=6 holding white dots.

| code | variation |
|---|---|
| `Cl*` | three dots, no fill |
| `GlC` | translucent gold fill, five dots crowded toward the centre |
| `OpC` | dashed outline, translucent light-blue fill, four dots spread out |
| `As*` | no circle: four dots joined by thin black lines (a figure) |
| `MGr` | three dots and a short arrow to the right |

*Nebulae and interstellar matter* — base: a cloud blob, a closed smooth
curve through seven points around r≈6, black outline.

| code | variation |
|---|---|
| `Neb` | lightgray fill |
| `PN` | rounder blob, mediumturquoise fill, one central dot (the central star) |
| `SNR` | spiky outline instead of a smooth one (tension 0), coral fill |
| `HII` | hotpink fill, one dot |
| `RNe` | cornflowerblue fill, one dot |
| `DNe` | near-black fill with a grey outline — the one icon without a black outline, which would leave an undifferentiated black blot |
| `MoC` | dark grey fill with a smaller inner blob outlined (the dense core) |
| `SFR` | hotpink fill, three dots |

*Galaxies and beyond* — base: ellipse rx=7, ry=3.5 tilted −30°, wheat
fill, black outline. "Core" means a white dot at the centre.

| code | variation |
|---|---|
| `G` | — |
| `AGN` | core |
| `QSO` | smaller ellipse (rx=5, ry=2.5), deepskyblue fill, core |
| `BLL` | as `QSO` plus a short jet line from the core toward the upper right |
| `rG` | two small circles (the lobes) at both ends of the major axis |
| `Sy1` | core, letter 1 |
| `Sy2` | core, letter 2 |
| `SBG` | hotpink fill, two dots |
| `LIN` | core, letter L |
| `EmG` | hotpink fill |
| `LSB` | translucent wheat fill (alpha 0.25), dashed outline |
| `IG` | two overlapping ellipses at different tilts joined by a short bridge stroke |
| `PaG` | two small ellipses side by side, not touching |
| `GrG` | three small ellipses |
| `ClG` | black-outlined circle r=7 holding three tiny ellipses |

Colors follow the conventions an observer already knows — blue for hot,
red for cool, gold for yellow supergiants and Cepheids, pink for ionised
hydrogen — so the infill carries meaning rather than being a lookup key.
The table is the contract; the implementer may nudge coordinates for
legibility on the icon sheet but not swap a variation for another.

**Fallback for labels outside the table.** Strip a trailing
" (candidate)" and look the label up again. If still unknown, classify
the label by word into a group and draw that group's base shape with its
default parameters: `galax|quasar|seyfert|liner|bl lac` → galaxy (tested
first, since "Galaxy in cluster" must not become a cluster);
`binary|double|multiple|symbiotic` → double; `variable` → variable;
`cluster|asterism|moving group|association` → cluster;
`nebula|remnant|region|cloud|interstellar|medium|emission object` →
nebula; `star|stellar|dwarf|giant|pulsar|nova|object` → star. Anything
else, including an empty label and a raw code, is today's plain dot.
This replaces `markerKind` and its ordering caveats; the tests are
disjoint enough that only the galaxy-before-cluster order matters, and
the comment says why.

**Consistency check at module load.** `icons.jsx` compares the table's
keys with `categories.js`'s codes in both directions and reports any
difference with `console.error`. There is no test runner to fail; a
console error in the dev stack and on the icon sheet is the nearest
equivalent, and `npm run build` cannot see it. Rejected: making the
mismatch throw, which would take the sky view down for a missing icon —
the fallback already guarantees a drawable marker.

**The icon sheet lives in `ObsStage`.** While `window.location.hash` is
`#icons`, `ObsStage` returns an `IconSheet` group instead of the sky:
groups as headings, one row per category with the icon at marker scale
and its code and label as text, four columns across the 1000×500 scene,
the left half on the sky color and the right half on the ground color.
The hash is followed through `hashchange` rather than read once:
editing the fragment of an open app does not reload the page, so a
one-time read would show the sheet only after a manual reload. Rejected: a separate route or page
(the app has no router) and a hidden dialog (the icons are canvas
shapes, so they need a Konva stage anyway).

## Risks / Trade-offs

- [70 icons at 12–16 units are hard to tell apart on a phone] → the
  base shapes carry the group at a glance and the tooltip still names
  the type; the variations are for a desktop-sized sky and the icon
  sheet is where legibility is judged.
- [The sheet's "night" half was planned against a dark sky that does not
  exist] → the canvas is light blue at every hour; the sheet's second
  background is the ground color instead, the other surface a marker is
  drawn on.
- [A letter tag sits outside the shape and enlarges the hit area a
  little] → the Group's handlers already fire for any child; a slightly
  larger target only makes the marker easier to hit. Overlap between
  neighbouring markers is no worse than two adjacent stars today.
- [Labels renamed on the astro side silently drop to the fallback]
  → the existing rule that `categories.js` and `_OTYPE_LABELS` agree
  is what keeps this from happening, and the fallback still draws the
  right group for most such labels.
- [Konva shape count grows: a Messier search with 110 matches goes from
  110 shapes to perhaps 300] → still far below what the paths already
  draw (48 segments each); no performance work planned.
- [Dark-nebula icon's grey outline breaks the "black outline" rule] →
  deliberate and documented in the table; a black outline on a
  near-black fill would merge into one blot.
