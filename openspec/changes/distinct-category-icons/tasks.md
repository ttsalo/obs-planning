## 1. Icon module: base shapes and the category table

- [x] 1.1 Create `obs-ui/src/icons.jsx` with the six base-shape components from design.md (`StarIcon`, `DoubleIcon`, `VariableIcon`, `ClusterIcon`, `NebulaIcon`, `GalaxyIcon`), each taking only the variation parameters its table lists (size, fill, halo, letters, dots, core, jet, lobes, and so on), plus the shared helpers for a letter tag, a dot and a halo; every shape black-outlined with the existing `objStrokeWidth`. Verify with `npm run build` and by rendering each base with default parameters on the icon sheet from task 2.1 and checking it stays inside a 16-unit square.
- [x] 1.2 Add the `ICONS` table keyed by category code, one entry per row of the six design.md tables (70 entries), carrying the base and its parameters. Verify by counting the keys against the design tables and confirming no two entries in a group have identical parameters (a short one-off script over the module in `node` is enough).
- [x] 1.3 Add the module-load consistency check comparing `ICONS`'s keys with the codes in `categories.js` in both directions and reporting differences with `console.error`. Verify by temporarily removing one entry, seeing the error in the dev console, and restoring it.
- [x] 1.4 Add `CategoryIcon({x, y, objectType})`: label → code through a map built from `categories.js`, a retry with the " (candidate)" suffix stripped, the word-based group fallback in the order design.md gives (galaxy before cluster), and the plain dot last. Export it as the replacement for `FixedMarker`. Verify with a small table of labels — "Globular cluster", "Galaxy (candidate)", "Low-mass X-ray binary", "Galaxy in cluster", "Seyfert galaxy", "Star", "", "XyZ" — evaluated through the resolver in `node` and checked against the expected base shape.

## 2. Icon sheet

- [x] 2.1 Add `IconSheet` to `icons.jsx`: group headings in the picker's order, one row per category with its icon at marker scale plus code and label as Konva text, four columns across the 1000×500 scene. Verify by opening the dev stack with `#icons` and confirming all 70 categories appear grouped and ordered as the picker lists them.
- [x] 2.2 In `obs-ui/src/obs.jsx` make `ObsStage` render `IconSheet` inside the stage instead of the sky when `window.location.hash` is `#icons` at mount, and the sky as before otherwise. Verify by loading the app with and without the fragment: the sheet in one case, the unchanged sky view in the other.

## 3. Sky view integration

- [x] 3.1 Replace `FixedMarker`, `markerKind` and the four regexps in `obs.jsx` with `CategoryIcon` from `icons.jsx`, keeping `ResultMarkers`'s `Group` handlers unchanged. Verify with a saved double-star search that eclipsing, spectroscopic and cataclysmic binaries draw with three different double-base icons and that hover, click-to-toggle and tap still work on each.
- [x] 3.2 Check the icons over the existing sets: select a Messier search and confirm M13 draws as a globular cluster and M57 as a planetary nebula; select a names search with an unresolved-type object and confirm it draws as a dot with its type still in the tooltip. Verify visually in the dev stack at both a daytime and a night-time render.
- [x] 3.3 Tune legibility on the icon sheet: adjust coordinates, dot placement and tag offsets until every icon reads on the light-blue day sky and the dark night sky at marker scale, without swapping any variation for another. Verify by reviewing the full sheet once more against the design tables.

## 4. Documentation and release

- [x] 4.1 Extend the header comment of `obs-ui/src/categories.js` with the rule that a new category also needs an `ICONS` entry and that the icon sheet is where to check it; update the `obs.jsx` paragraph of `CLAUDE.md`'s frontend structure section to name `icons.jsx`, the label-keyed lookup and the `#icons` sheet. Verify by re-reading both for any remaining mention of `FixedMarker` or `markerKind`.
- [x] 4.2 Bump `VERSION` to 0.13.1 and add the matching README Versions entry describing the per-category icons, the group base shapes and the icon sheet. Verify the entry matches the file and follows the format of the 0.13.0 entry.
- [x] 4.3 Run `make check` and confirm all three suites are green, then `make build` so the Go server's static copy carries the new UI, and walk the flow once against `make runserver`: sky view with a category search, a Messier search, hover and toggle on a few markers, and `#icons`.
