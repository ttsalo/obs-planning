## MODIFIED Requirements

### Requirement: Sky view renders the selected search's matches
The sky view SHALL draw a marker for every matched candidate of the
selected search at its current position as seen from the selected
position, refreshed on the same cadence as today's planet markers, using
the existing artistic markers for solar-system bodies and a category
icon for other objects. Every object category the searches dialog
offers SHALL have an icon of its own, drawn in the sky view's simplified
line-graphics style — a black outline with a colored infill — and no
two offered categories SHALL share the same icon. The categories of one
group in the dialog's picker (stars; double and multiple stars; variable
stars; clusters; nebulae and interstellar matter; galaxies and beyond)
SHALL share a base shape, and each category's icon SHALL be a variation
of its group's base shape by size, infill color, an added graphical
marker, or one to three letters set beside the shape. An object whose
type is not an offered category SHALL draw with the base shape of the
group its type belongs to when the type names one, and with a plain dot
otherwise; a type marked as a candidate ("(candidate)") draws as the
type it is a candidate of. An object MUST NOT be left undrawn for want
of an icon. An icon's footprint MUST stay within the area today's
markers occupy, so hovering, tapping and clicking a marker behave as
before. Unmatched candidates MUST NOT be drawn. Hovering or tapping a
marker SHALL show a tooltip with its name and, for non-solar-system
objects, its object type and magnitude. When the search has at most 10
matched candidates, a 24-hour path SHALL be drawn for every one of them
as today; when it has more, a path SHALL be drawn only for the one whose
marker is hovered or tapped. The Sun's marker and path are drawn
regardless of the search. Updating the selected search's candidates or
match flags MUST cause the view to show the new matches without a page
reload.

#### Scenario: Small search draws all paths
- **WHEN** the selected search is the eight-planet "Planets" search
- **THEN** every planet has a marker and a path, as before this change

#### Scenario: Large search draws paths on demand
- **WHEN** the selected search has 60 matched Messier objects and the user
  hovers M31
- **THEN** all 60 markers are shown, only M31's path is drawn, and the path
  disappears when the hover ends

#### Scenario: Unmatched candidates hidden
- **WHEN** the selected search has 110 Messier candidates of which 40 are
  matched
- **THEN** exactly 40 markers are drawn

#### Scenario: Fixed-object tooltip
- **WHEN** the user hovers a double-star marker
- **THEN** the tooltip shows its name, "Double star" type and magnitude

#### Scenario: Request volume bounded
- **WHEN** the selected search has 100 matched candidates
- **THEN** each marker refresh issues a bounded number of requests to the
  astronomy service rather than one per object

#### Scenario: Every offered category has a distinct icon
- **WHEN** one object of each of the categories the searches dialog
  offers is drawn
- **THEN** every one of them has an icon and no two of the icons are the
  same

#### Scenario: One group, one base shape
- **WHEN** a globular cluster, an open cluster and an asterism are drawn
- **THEN** all three are recognisably variations of the clusters' base
  shape, and none of them shares its base shape with a galaxy or a
  nebula

#### Scenario: Subtypes of one search told apart
- **WHEN** a double-star search's matches include an eclipsing binary, a
  spectroscopic binary and a cataclysmic variable star
- **THEN** the three draw with three different icons, each a variation of
  the double-and-multiple-star base shape

#### Scenario: Messier objects typed from the catalog
- **WHEN** the selected search is a Messier set whose matches include M13
  (a globular cluster) and M57 (a planetary nebula)
- **THEN** M13 draws with the globular-cluster icon and M57 with the
  planetary-nebula icon, without the search having named a category

#### Scenario: Type outside the offered list falls back to its group
- **WHEN** a candidate's type is "Low-mass X-ray binary", which the
  dialog does not offer
- **THEN** it draws with the double-and-multiple-star base shape

#### Scenario: Unknown type still drawn
- **WHEN** a candidate's type is an object-type code the frontend does not
  know, or is empty
- **THEN** it draws as a plain dot and its tooltip still names the type

#### Scenario: Candidate types draw as their base type
- **WHEN** a candidate's type is "Galaxy (candidate)"
- **THEN** it draws with the galaxy icon

## ADDED Requirements

### Requirement: Icon sheet for checking the vocabulary
When the application is opened with the URL fragment `#icons`, the sky
view's canvas SHALL show, instead of the sky, every offered category's
icon next to its code and label, arranged by group in the order the
searches dialog lists them, so the whole icon vocabulary can be inspected
on one screen. Without the fragment the sky view MUST be unaffected.

#### Scenario: Sheet lists every category
- **WHEN** the application is opened with `#icons` in the URL
- **THEN** the canvas shows one entry per offered category, grouped and
  ordered as the picker is, each with its icon, code and label

#### Scenario: Sky unaffected otherwise
- **WHEN** the application is opened without the fragment
- **THEN** the sky view renders the selected search's matches as before
