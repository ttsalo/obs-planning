## Why

The `double_stars` target set was a prototype: it proved that a SIMBAD
object-type query can drive a search, but it hard-codes one type out of
the roughly two hundred the catalog knows. A user who wants globular
clusters, planetary nebulae or bright galaxies brighter than a magnitude
has no way to ask for them, even though the query that would answer is
the same query `double_stars` already runs (Linear OBS-16).

## What Changes

- The target set gains a `category` kind: a SIMBAD object-type code plus
  the maximum visual magnitude the prototype already required. It resolves
  to every catalog object of that type — including the type's subtypes,
  which is what the existing `otypes`-table query gives — at or brighter
  than the limit.
- The astro backend's resolution stops knowing about double stars
  specifically. It accepts any syntactically valid object-type code,
  builds the same ADQL as today with that code in place of the literal
  `'**'`, and labels each returned candidate from its own catalogued type
  rather than stamping the requested category on all of them — so a
  double-star search now distinguishes an eclipsing binary from a
  spectroscopic one. A code the catalog does not know resolves to zero
  candidates rather than an error; the picker only offers real ones.
- The searches dialog replaces the "Double stars" radio button with an
  "Object category" one plus a grouped, searchable category picker. The
  picker's contents are a curated list bundled with the frontend — the
  branches of SIMBAD's type hierarchy that are worth pointing a telescope
  at, grouped as stars, double and multiple stars, variable stars,
  clusters, nebulae and interstellar matter, and galaxies and beyond.
  Exactly one category per search; a user wanting two makes two searches.
- The sky view's marker-shape classification learns the label families the
  new categories introduce, so a globular cluster and a planetary nebula
  are not drawn as anonymous dots.
- **BREAKING** (API-internal): the `double_stars` set kind is dropped
  outright, with no migration. Saved searches that still name it keep
  their stored candidates and keep drawing on the sky view, but the server
  rejects the kind on the next write, so editing such a search means
  choosing a set before it can be saved. Nothing outside this repository
  sends the kind.
- Bump `VERSION` to 0.13.0 and add the matching README Versions entry.

## Capabilities

### New Capabilities
<!-- None: this change extends two capabilities the observation-target-search
     change introduced. -->

### Modified Capabilities
- `observation-target-search`: the target set's vocabulary — `category`
  with an object-type code replaces `double_stars`, with its own
  validation rules and its own staleness rule for re-resolution — and a
  new requirement for how the category is chosen. The sky view's marker
  shapes are not a spec change: the existing requirement already asks for
  "a marker distinguished by object type", and only which shape goes with
  which type moves.
- `target-resolution`: the astronomy service resolves a `category` set
  from any object-type code instead of resolving the fixed
  `double_stars` set, and types each candidate from the catalog.

## Impact

- `backend/db.go`: `TargetSearch` gains an `otype` column; `setKinds`
  loses `double_stars` and gains `category`; `Validate` requires a
  well-formed code and a magnitude limit for `category` and clears the
  code for every other kind. `backend/api.go`: `otype` joins
  `searchInputColumns` and the bound input. `backend/search_test.go`:
  validation and round-trip tests for the new field, and the dropped kind
  rejected.
- `astrobackend/catalog.py`: `_resolve_double_stars` becomes
  `_resolve_category(otype, max_magnitude)`; `_OTYPE_LABELS` is extended
  to cover every code the picker offers, so the picker's label and the
  candidate's label agree. `astrobackend/schemas.py`, `server.py`:
  `SET_KINDS` and the `TargetSetSchema` gain `otype` with a strict
  charset pattern — the code is interpolated into ADQL, so the pattern is
  what keeps the query safe — and the `double_stars` special case in
  `/api/resolve-targets` becomes the `category` one.
  `astrobackend/tests/test_search.py`: canned-table tests for a
  non-double category, the charset rejection and the unknown-code case.
- `obs-ui/src/searches.jsx`: the set-kind options, the category picker
  and its curated list, `toDefinition`/`toFormValues`/`setKey`/
  `setSummary`, and a required rule on the set kind so a search saved
  under the dropped kind cannot be re-saved without choosing one.
  `obs-ui/src/obs.jsx`: `markerKind` covers the new label families. No new
  frontend dependencies — `antd`'s `Select` already does grouped options
  and filtering.
- `README.md`, `VERSION`, `CLAUDE.md` (the `set_kind` vocabulary in the
  database-model and astro-endpoint sections).
- Assumptions recorded for review: a category search keeps the magnitude
  limit mandatory, as `double_stars` did, because it is what holds the
  result under the 2000-candidate cap; the curated picker list lives in
  the frontend only, while the astro backend stays generic over codes, so
  there is one list to maintain and widening it is a frontend-only edit;
  the picker's default category is the double-or-multiple star type, so
  the nearest equivalent of today's button is one click away.
