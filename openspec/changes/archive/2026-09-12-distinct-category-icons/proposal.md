## Why

The sky view tells catalog objects apart by only three marker shapes — a
four-point star, a hollow circle and a dot — while the searches dialog
now offers 70 object categories in six groups. A globular cluster, a
planetary nebula and a galaxy all draw as the same hollow circle, and
every star-like category is the same white star, so a search that mixes
subtypes (a double-star search returns eclipsing, spectroscopic and
cataclysmic binaries) shows a sky of identical glyphs that only the
tooltip can explain (Linear OBS-17).

## What Changes

- Every category in `obs-ui/src/categories.js` gets its own canvas
  icon, in the existing simplified line-graphics style: black outline,
  colored infill, a few pixels across.
- The six groups each get a **base shape** that every category in the
  group shares, so the family is readable at a glance: a four-point star
  for stars, a pair of discs for double and multiple stars, a star with
  a second outline for variable stars, a circle of dots for clusters, a
  cloud blob for nebulae and interstellar matter, and a tilted ellipse
  for galaxies and beyond.
- Within a group, each category is a **variation** of the base shape:
  its size, its infill color, a small added marker (a ring, a disc, an
  arrow, a jet, a second body) or, where nothing graphical is natural,
  one to three letters set beside the shape. No two categories share the
  same variation.
- Objects whose type is not one of the 70 categories — a SIMBAD subtype
  the picker does not offer, a "(candidate)" type, or the catalog's
  generic fallback labels — draw with the base shape of the group they
  belong to when their label places them in one, and with the plain dot
  otherwise. Nothing draws as nothing.
- A developer-facing icon sheet, reachable only through the `#icons`
  URL fragment, draws every category's icon next to its label so the
  whole vocabulary can be checked in one screen; it is the way this
  change is verified and the way a future category's icon is checked.
- The Messier and names sets benefit unchanged: their candidates already
  carry the same object-type labels, so M13 draws as a globular cluster
  and M57 as a planetary nebula without any change to those sets.
- Solar-system markers, the Sun, paths, tooltips and hit testing are
  untouched.
- Bump `VERSION` to 0.13.1 and add the matching README Versions entry.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `observation-target-search`: the "Sky view renders the selected
  search's matches" requirement is tightened from "a marker
  distinguished by object type" to one icon per offered category, a
  shared base shape per group, and a defined fallback for types outside
  the offered list. The picker's list of categories and its labels are
  unchanged.

## Impact

- `obs-ui/src/icons.jsx` (new): the six base-shape components, the
  per-category variation table keyed by category code, the label → icon
  lookup with its group fallback, and the `#icons` sheet.
- `obs-ui/src/obs.jsx`: `FixedMarker` and `markerKind` are replaced by
  the lookup in `icons.jsx`; `ObsStage` renders the icon sheet instead
  of the sky when the fragment asks for it. The marker's outer footprint
  stays within the current 12-pixel diameter so the hit areas, the
  hover tooltip anchoring and the layer order are unaffected.
- `obs-ui/src/categories.js`: unchanged as data; its header comment
  gains the rule that a new category also needs an icon entry. The
  icons file checks at module load that the two lists agree and logs a
  console error if not, since the UI has no test runner and `npm run
  build` is the only automated check.
- No backend, API, schema or database change. The icon lookup is keyed
  on the readable object-type label the candidates already store,
  mapped back to a code through `categories.js`, so no new field
  travels from the astro backend or the Go server.
- `README.md`, `VERSION`. `CLAUDE.md`'s frontend-structure paragraph on
  `obs.jsx` is updated to name `icons.jsx`.
- Assumptions recorded for review: the icons are keyed on labels rather
  than codes because that is what the stored candidates carry, and the
  "every label matches `_OTYPE_LABELS`" rule already keeps the two in
  step; the color vocabulary follows astronomical convention where one
  exists (blue for hot, red for cool, pink for ionized hydrogen) so the
  infill is informative rather than arbitrary; letters are reserved for
  the categories where neither shape nor color distinguishes them
  (several variable classes, the Seyfert types);
  the icon sheet is kept to a URL fragment rather than a legend in the
  UI, since a user-facing legend is a feature of its own.
