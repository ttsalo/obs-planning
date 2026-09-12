## Context

See proposal.md — Why. The mechanics that constrain the design are
already in place from the target-search change:

- `astrobackend/catalog.py:_resolve_double_stars(max_magnitude)` builds
  one ADQL query joining `basic`, `allfluxes` and `otypes`, with
  `otypes.otype = '**'` as the only type predicate and
  `TOP CANDIDATE_CAP + 1` so an over-cap result is detectable without
  paging. The `otypes` table holds the full hierarchy for each object,
  so the predicate already matches subtypes; nothing about the query
  is specific to double stars except the literal.
- The result is stamped with `object_type="Double star"` for every row,
  overriding the per-object `otype_label(basic.otype)` the other
  resolvers use.
- The set kind travels through three validators: `TargetSetSchema` in
  `astrobackend/schemas.py`, `TargetSearch.Validate` in `backend/db.go`,
  and the form in `obs-ui/src/searches.jsx`. Both server-side lists
  currently spell out `double_stars`.
- `setKey()` in `searches.jsx` decides when the form must go back to the
  catalog; it hashes `{kind, mag, names}`.

The one genuinely new constraint is injection: the object-type code is
user input that ends up inside an ADQL string literal.

## Goals / Non-Goals

**Goals:**

- One curated list to maintain, in one place, so widening the offering
  later is a single-file edit.
- The astro service generic over object types, so its contract is
  "whatever SIMBAD defines" rather than "whatever we listed".
- The ADQL safe by construction, not by escaping.

**Non-Goals:**

- Discovering the category list from SIMBAD at runtime (the `otypedef`
  TAP table). Rejected in planning: the astro service scales to zero on
  Cloud Run, so the picker would stall on a cold start, and it would go
  blank exactly when the catalog is down.
- Multiple categories per search, category-specific magnitude defaults,
  or a magnitude-free category search.
- Reworking the sky view's marker vocabulary. Only the mapping from type
  label to the three existing shapes is touched.

## Decisions

### The curated list lives in the frontend; the backends stay generic

`obs-ui/src/categories.js` holds one array of
`{group, code, label}` entries — the picker's contents and the source of
the readable name in `setSummary`. Neither Go nor Python holds an
allow-list of codes: Go validates shape (`^[A-Za-z0-9*?_+-]{1,8}$`, plus
a required magnitude) so the column can only ever hold something
code-shaped, and Python validates the same shape before building the
ADQL.

Alternatives considered:

- *Allow-list in `catalog.py`, served to the UI over a new
  `GET /api/target-categories`.* One list, but the picker then depends on
  a service that cold-starts in seconds and can be down, for data that
  never changes. Rejected.
- *Allow-list duplicated in `catalog.py` and the frontend.* Two lists
  that must agree, with no mechanical check across the language
  boundary, for no gain: a code the picker never offers can only arrive
  from a hand-written request, and the worst it does is return nothing.
  Rejected.

The consequence to accept: a well-formed code SIMBAD does not define is
a successful empty result, not an error. That is specified behaviour, not
an oversight — the picker makes it unreachable through the UI.

`_OTYPE_LABELS` in `catalog.py` stays, and grows to cover every code the
picker offers. It is a label table, not an allow-list: it already types
individual candidates, and it is what makes the over-cap message name
"Globular cluster" instead of `GlC`. If it and the picker ever disagree
the damage is cosmetic (a picker label differing from a tooltip label),
so the duplication is tolerable where an allow-list duplication would
not have been.

### Injection is prevented by the charset, not by escaping

The pattern `^[A-Za-z0-9*?_+-]{1,8}$` admits every SIMBAD otype code
(`**`, `V*`, `GlC`, `SNR`, `PN`, `EB*`, `Sy1`, `s*r`, `Cl*`, `?` suffixes)
and excludes quotes, whitespace, parentheses, semicolons and comment
markers — so `f"otypes.otype = '{otype}'"` cannot be broken out of. The
check runs in `TargetSetSchema` (marshmallow `validate.Regexp`) before
`catalog.resolve_set` is reached, and again inside `_resolve_category`
so the catalog module is safe on its own terms rather than trusting its
caller. Go applies the same pattern for the same reason it validates
everything else: the column should not be able to hold junk.

Chosen over parameterised queries because `astroquery`'s `query_tap`
takes a query string with no bind-parameter facility; a charset that
cannot express an escape is the stronger guarantee anyway.

### `category` replaces `double_stars` with no migration

The set kind is dropped from `setKinds` (Go) and `SET_KINDS` (Python),
and `category` added. No backfill runs: unlike the `Planets` backfill in
`InitTestData`, there is no seeded row to repair, and a user's own
`double_stars` search keeps its stored candidates and matched flags, so
it keeps listing, selecting and drawing — those paths read
`TargetObjects`, never `set_kind`. Only a write rejects it, which is
what forces the user to pick a set the next time they edit.

The frontend consequence: `toFormValues` may hand the radio group a
value that is no longer an option, so the group renders with nothing
selected. A `required` rule on `set_kind` turns that into an ordinary
form validation message instead of a silent submit of the old kind.
`setSummary` falls back to the raw kind string for such a row, which is
the honest thing to show.

### `_resolve_category(otype, max_magnitude)` types candidates individually

The `object_type="Double star"` override is dropped, so
`_fixed_candidate` derives each candidate's type from its own
`basic.otype`. This is strictly more information — a `**` search now
distinguishes eclipsing from spectroscopic binaries — and it is what
makes one generic resolver possible: with the override there would have
to be a code-to-label mapping in the resolve path, which is the
allow-list this design avoids.

`lru_cache` moves from keying on the magnitude alone to keying on
`(otype, max_magnitude)`; `maxsize=16` stays, which now spans categories
rather than magnitudes, and `clear_cache()` updates to the new name.

### Marker shapes

`markerKind()` in `obs.jsx` classifies by regex over the type label and
defaults to "extended". The new label families fall out mostly right
already — "Globular cluster", "Planetary nebula" and "Seyfert 1 galaxy"
all become extended, which is correct. The regex gains the star-like
labels the wider vocabulary introduces (supergiant, subdwarf, carbon
star, T Tauri and the like), and point-like non-stars — quasars, radio
and X-ray sources — are routed to the dot. This is the only obs.jsx
change.

## Risks / Trade-offs

- **A well-formed but undefined code silently returns nothing** → The
  picker is the only way to produce one through the UI, and the empty
  result is specified. The form already shows "0 candidates", so the
  user is not left guessing whether the request ran.
- **A popular category at a generous magnitude blows the 2000 cap where
  double stars at magnitude 5 never did** → Already handled: `TOP cap+1`
  detects it and the 400 asks for a lower limit. The message now names
  the category, so the user knows which knob to turn. Worth checking one
  broad category (stars, `*`) by hand at deploy time to confirm the
  message reads sensibly.
- **The picker list and `_OTYPE_LABELS` drift** → Cosmetic only (see
  Decisions). Keeping the labels identical when the list is extended is
  a convention, checked by eye, not by a test that would have to cross
  the language boundary.
- **`otype` is a new column on a table AutoMigrate manages** → Additive,
  nullable, defaults to empty; GORM adds it on the next startup with no
  data movement. Rolling back to the previous image leaves the column in
  place and unread.

## Migration Plan

Deploy is the ordinary path — `make build`, then the AWS or GCP target.
AutoMigrate adds `otype` on the Go server's first startup. No data
migration, no backfill, no ordering constraint between the two services:
the astro service accepting `category` before any client sends it is
harmless, and the Go server rejecting `double_stars` only affects writes.

Rollback is the previous image pair. A search saved with `category` while
the new version was live becomes unwritable under the old one (unknown
set kind) but still lists and draws from its stored candidates — the
mirror image of what `double_stars` searches experience going forward.
