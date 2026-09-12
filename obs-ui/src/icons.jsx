/* Canvas icons for the catalog object categories.

   Every category the searches dialog offers (categories.js) has an icon
   of its own here, in the sky view's simplified line-graphics style: a
   black outline with a colored infill, a dozen scene units across. The
   six picker groups each have a base shape, and a category's icon is a
   variation of its group's base by size, infill, a small added marker
   or, where nothing graphical is natural, one to three letters on a tag.

   Three layers: the base-shape components, the ICONS table keyed by
   category code, and CategoryIcon, which resolves a candidate's
   object-type *label* (the only thing the stored candidates carry) to a
   table entry through categories.js, or to a group fallback, or to a
   plain dot. IconSheet draws the whole vocabulary for checking; the app
   shows it in place of the sky when opened with the URL fragment
   "#icons". Colors follow the conventions an observer already knows:
   blue for hot, red for cool, gold for yellow supergiants and Cepheids,
   pink for ionised hydrogen. */

import { Circle, Ellipse, Line, Group, Star, Text, Rect, Arrow }
    from 'react-konva';
import { categories } from './categories.js';

// Shared outline width for all object markers, the solar-system ones in
// obs.jsx included, so every marker on the sky reads with the same line.
export const objStrokeWidth = 1.2;

// ---------------------------------------------------------------------
// Shared pieces

// One to three letters on a small white tag anchored to the shape's
// lower right, so they read on the day and the night sky alike.
function LetterTag({text}) {
    const w = 4.3 * text.length + 3;
    return (<Group x={4} y={2.5}>
		<Rect width={w} height={8.5} cornerRadius={1.5} fill="white"
		      stroke="black" strokeWidth={0.6}>
		</Rect>
		<Text text={text} x={0} y={1} width={w} align="center"
		      fontSize={7} fill="black" listening={false}>
		</Text>
	    </Group>);
}

// A star inside a cluster, a nebula's exciting star, a galaxy's core.
function Dot({x = 0, y = 0}) {
    return (<Circle x={x} y={y} radius={1.2} fill="white" stroke="black"
		    strokeWidth={0.6}>
	    </Circle>);
}

// A thin ring around a star: an emission shell, a wind, a dust shell.
function Halo({radius = 8}) {
    return (<Circle radius={radius} stroke="black" strokeWidth={0.8}
		    fillEnabled={false}>
	    </Circle>);
}

function FourStar({x = 0, y = 0, size, fill, strokeWidth = objStrokeWidth,
		   fillEnabled = true, innerRatio = 0.3}) {
    return (<Star x={x} y={y} numPoints={4} innerRadius={size * innerRatio}
		  outerRadius={size} fill={fill} fillEnabled={fillEnabled}
		  stroke="black" strokeWidth={strokeWidth}>
	    </Star>);
}

// ---------------------------------------------------------------------
// Base shapes. Each is drawn centred on the origin of the caller's Group
// and takes only the variation parameters its table in design.md lists.

/* Stars: a four-point star. Size classes: dwarf 4, normal 6, giant 7,
   supergiant 8. `disc` draws a flat ellipse behind and below (the
   protoplanetary disc), `envelope` a translucent cloud behind (a young
   stellar object), `arrow` the proper motion, `beams` a pulsar's two
   beams, `hole` makes a black hole: a black disc with an orange ring in
   place of the outline, the one star icon that is not a star shape. */
function StarIcon({size = 6, fill = "white", halo = false, letters = null,
		   disc = false, envelope = false, arrow = false,
		   beams = false, hole = false}) {
    if (hole) {
	return (<>
		    <Circle radius={4} fill="black"></Circle>
		    <Circle radius={6} stroke="orange" strokeWidth={1.5}
			    fillEnabled={false}></Circle>
		</>);
    }
    return (<>
		{envelope &&
		 <Circle radius={7.5} fill="rgba(160,160,160,0.55)"></Circle>}
		{disc &&
		 <Ellipse y={size * 0.55} radiusX={size + 2.5} radiusY={1.6}
			  fill="rgba(255,255,255,0.7)" stroke="black"
			  strokeWidth={0.7}></Ellipse>}
		{beams && <>
		     <Line points={[-3, 3, -9, 9]} stroke="black"
			   strokeWidth={1}></Line>
		     <Line points={[3, -3, 9, -9]} stroke="black"
			   strokeWidth={1}></Line>
		 </>}
		<FourStar size={size} fill={fill}></FourStar>
		{halo && <Halo></Halo>}
		{arrow &&
		 <Arrow points={[size + 1, 0, size + 6.5, 0]} stroke="black"
			fill="black" strokeWidth={1} pointerLength={2.5}
			pointerWidth={2.5}></Arrow>}
		{letters && <LetterTag text={letters}></LetterTag>}
	    </>);
}

/* Double and multiple stars: a primary disc at the lower left and a
   secondary at the upper right. `eclipse` moves the secondary in front
   of the primary, `merged` overlaps them (unresolved pair), `ring` puts
   an accretion disc around the secondary, `burst` replaces the
   secondary with a small yellow star (a nova's outburst). */
function DoubleIcon({primary = "white", secondary = "white",
		     primaryR = 3.5, secondaryR = 2.5, eclipse = false,
		     merged = false, ring = false, burst = false,
		     letters = null}) {
    const sx = eclipse ? 0 : merged ? 1.5 : 3.5;
    const sy = eclipse ? -1.5 : merged ? -1 : -2;
    return (<>
		<Circle x={-2.5} y={0.5} radius={primaryR} fill={primary}
			stroke="black" strokeWidth={objStrokeWidth}></Circle>
		{burst
		 ? <FourStar x={sx} y={sy} size={3.5} fill="yellow"
			     strokeWidth={0.8}></FourStar>
		 : <Circle x={sx} y={sy} radius={secondaryR} fill={secondary}
			   stroke="black" strokeWidth={objStrokeWidth}>
		   </Circle>}
		{ring &&
		 <Circle x={sx} y={sy} radius={secondaryR + 1.8} stroke="black"
			 strokeWidth={0.7} fillEnabled={false}></Circle>}
		{letters && <LetterTag text={letters}></LetterTag>}
	    </>);
}

/* Variable stars: a four-point star inside a second, thin and fatter
   star outline at 1.5x the size (the throb); the fatter waist keeps a
   visible gap between the two outlines, which a same-shaped outline
   only slightly larger did not. `spark` adds a small yellow star at the
   upper right (a flare). */
function VariableIcon({size = 6, fill = "white", letters = null,
		       spark = false}) {
    return (<>
		<FourStar size={size * 1.5} innerRatio={0.55} fill={null}
			  fillEnabled={false} strokeWidth={0.7}></FourStar>
		<FourStar size={size} fill={fill}></FourStar>
		{spark &&
		 <FourStar x={size * 0.7} y={-size * 0.7} size={2.8}
			   fill="yellow" strokeWidth={0.6}></FourStar>}
		{letters && <LetterTag text={letters}></LetterTag>}
	    </>);
}

// Dot layouts for the cluster base, by count.
const clusterDots = {
    3: [[-2.2, 1.6], [2.2, 1.6], [0, -2.2]],
    4: [[-3, -2], [3, -1], [-1.5, 3], [2.2, 3]],
    5: [[0, 0], [-1.9, -1.1], [1.9, -1.1], [-1.1, 1.9], [1.3, 1.7]],
};
// An asterism's figure: dots joined by lines, no circle around them.
const figurePoints = [[-5, 3.5], [-2, -4], [2, -1], [5, 4]];

/* Clusters: a circle holding white dots. `fill` tints the inside,
   `dashed` loosens the outline (an open cluster), `figure` draws the
   dots joined by lines with no circle (an asterism), `arrow` a moving
   group's common motion. */
function ClusterIcon({dots = 3, fill = null, dashed = false, figure = false,
		      arrow = false}) {
    if (figure) {
	return (<>
		    <Line points={figurePoints.flat()} stroke="black"
			  strokeWidth={0.8}></Line>
		    {figurePoints.map(([x, y], i) =>
			<Dot key={i} x={x} y={y}></Dot>)}
		</>);
    }
    return (<>
		<Circle radius={6} stroke="black" strokeWidth={objStrokeWidth}
			fill={fill} fillEnabled={fill != null}
			dash={dashed ? [2.2, 1.8] : undefined}></Circle>
		{clusterDots[dots].map(([x, y], i) =>
		    <Dot key={i} x={x} y={y}></Dot>)}
		{arrow &&
		 <Arrow points={[7.5, 0, 12.5, 0]} stroke="black" fill="black"
			strokeWidth={1} pointerLength={2.5} pointerWidth={2.5}>
		 </Arrow>}
	    </>);
}

// A closed curve through seven points around the origin; the radii
// give the blob its lumps, the tension its softness.
function blobPoints(radii) {
    const n = radii.length;
    return radii.flatMap((r, i) => {
	const a = 2 * Math.PI * i / n - Math.PI / 2;
	return [r * Math.cos(a), r * Math.sin(a)];
    });
}
const lumpyBlob = [6, 5, 6.5, 5.3, 6.2, 4.8, 6.3];
const roundBlob = [5.6, 5.6, 5.6, 5.6, 5.6, 5.6, 5.6];
const spikyBlob = [7, 4.2, 7, 4.5, 7.2, 4, 6.8];
const nebulaDots = {
    1: [[0.6, -0.4]],
    3: [[-2.2, -1.2], [2.3, 0], [0, 2.6]],
};

/* Nebulae and interstellar matter: a cloud blob. `round` makes it a
   shell (planetary nebula), `spiky` a shock front (supernova remnant),
   `dots` the exciting stars, `core` a denser inner blob (a molecular
   cloud), `star` a central star. The dark nebula passes a grey
   `stroke`: a black outline on a black fill would vanish at night. */
function NebulaIcon({fill = "lightgray", stroke = "black", round = false,
		     spiky = false, dots = 0, core = false, star = false}) {
    const radii = round ? roundBlob : spiky ? spikyBlob : lumpyBlob;
    return (<>
		<Line points={blobPoints(radii)} closed
		      tension={spiky ? 0 : 0.5} fill={fill} stroke={stroke}
		      strokeWidth={objStrokeWidth}></Line>
		{core &&
		 <Line points={blobPoints(lumpyBlob.map((r) => r * 0.5))}
		       closed tension={0.5} stroke="black" strokeWidth={0.7}
		       fillEnabled={false}></Line>}
		{star && <Dot></Dot>}
		{dots > 0 && nebulaDots[dots].map(([x, y], i) =>
		    <Dot key={i} x={x} y={y}></Dot>)}
	    </>);
}

const TILT = -30;
// The unit vector along the tilted major axis, for the radio lobes.
const axisX = Math.cos(TILT * Math.PI / 180);
const axisY = Math.sin(TILT * Math.PI / 180);

function GalaxyEllipse({x = 0, y = 0, rx, ry, fill, rotation = TILT,
			dashed = false}) {
    return (<Ellipse x={x} y={y} radiusX={rx} radiusY={ry} rotation={rotation}
		     fill={fill} stroke="black" strokeWidth={objStrokeWidth}
		     dash={dashed ? [2.2, 1.8] : undefined}>
	    </Ellipse>);
}

/* Galaxies and beyond: a tilted ellipse. `core` is a bright nucleus,
   `jet` a blazar's jet, `lobes` a radio galaxy's two lobes, `dots`
   star-forming knots, `dashed` a faint outline. `multi` replaces the
   single ellipse with a pair, an interacting pair, a group or a circle
   holding a cluster of them. */
function GalaxyIcon({fill = "wheat", rx = 7, ry = 3.5, core = false,
		     jet = false, lobes = false, dots = 0, dashed = false,
		     letters = null, multi = null}) {
    let body;
    if (multi == "pair") {
	body = (<>
		    <GalaxyEllipse x={-4} y={1.5} rx={4} ry={2} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={4} y={-1.5} rx={4} ry={2} fill={fill}>
		    </GalaxyEllipse>
		</>);
    } else if (multi == "interacting") {
	body = (<>
		    <Line points={[-2.5, 1, 2.5, -1.5]} stroke="black"
			  strokeWidth={1.6}></Line>
		    <GalaxyEllipse x={-2.5} y={1} rx={5} ry={2.5} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={2.5} y={-1.5} rx={5} ry={2.5} fill={fill}
				   rotation={25}></GalaxyEllipse>
		</>);
    } else if (multi == "group") {
	body = (<>
		    <GalaxyEllipse x={-4} y={2.5} rx={3.2} ry={1.6} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={3.5} y={3} rx={3.2} ry={1.6} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={0} y={-3} rx={3.2} ry={1.6} fill={fill}>
		    </GalaxyEllipse>
		</>);
    } else if (multi == "cluster") {
	body = (<>
		    <Circle radius={7.5} stroke="black"
			    strokeWidth={objStrokeWidth} fillEnabled={false}>
		    </Circle>
		    <GalaxyEllipse x={-3} y={1.5} rx={2.4} ry={1.2} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={3} y={2.5} rx={2.4} ry={1.2} fill={fill}>
		    </GalaxyEllipse>
		    <GalaxyEllipse x={0.5} y={-3} rx={2.4} ry={1.2} fill={fill}>
		    </GalaxyEllipse>
		</>);
    } else {
	body = (<GalaxyEllipse rx={rx} ry={ry} fill={fill} dashed={dashed}>
		</GalaxyEllipse>);
    }
    return (<>
		{lobes && <>
		     <Circle x={-(rx + 1.5) * axisX} y={-(rx + 1.5) * axisY}
			     radius={2.2} fill="white" stroke="black"
			     strokeWidth={0.8}></Circle>
		     <Circle x={(rx + 1.5) * axisX} y={(rx + 1.5) * axisY}
			     radius={2.2} fill="white" stroke="black"
			     strokeWidth={0.8}></Circle>
		 </>}
		{body}
		{jet && <Line points={[1.5, -1.5, 8, -8]} stroke="black"
			      strokeWidth={1.2}></Line>}
		{core && <Dot></Dot>}
		{dots > 0 && [[-2.2, 1], [2.2, -1]].slice(0, dots).map(
		    ([x, y], i) => <Dot key={i} x={x} y={y}></Dot>)}
		{letters && <LetterTag text={letters}></LetterTag>}
	    </>);
}

const BASES = {
    star: StarIcon,
    double: DoubleIcon,
    variable: VariableIcon,
    cluster: ClusterIcon,
    nebula: NebulaIcon,
    galaxy: GalaxyIcon,
};

// The base shape of each picker group, for the table below and for the
// fallback of a label that names a group without being in the table.
const GROUP_BASE = {
    'Stars': 'star',
    'Double and multiple stars': 'double',
    'Variable stars': 'variable',
    'Clusters': 'cluster',
    'Nebulae and interstellar matter': 'nebula',
    'Galaxies and beyond': 'galaxy',
};

// ---------------------------------------------------------------------
// The icon of every offered category, by SIMBAD code: its base shape
// and the parameters that make it that category's variation. One entry
// per row of the tables in the change's design.md; no two entries in a
// group are the same. A new category in categories.js needs a row here,
// and the "#icons" sheet is where to check it.
const ICONS = {
    // Stars
    '*':   {base: 'star'},
    'MS*': {base: 'star', letters: 'MS'},
    'RG*': {base: 'star', size: 7, fill: 'orangered'},
    's*b': {base: 'star', size: 8, fill: 'dodgerblue'},
    's*r': {base: 'star', size: 8, fill: 'red'},
    's*y': {base: 'star', size: 8, fill: 'gold'},
    'AB*': {base: 'star', size: 7, fill: 'orange', halo: true},
    'HB*': {base: 'star', letters: 'HB'},
    'WD*': {base: 'star', size: 4},
    'BD*': {base: 'star', size: 4, fill: 'saddlebrown'},
    'HS*': {base: 'star', size: 4, fill: 'deepskyblue'},
    'C*':  {base: 'star', size: 7, fill: 'darkred', letters: 'C'},
    'S*':  {base: 'star', size: 7, fill: 'orangered', letters: 'S'},
    'Em*': {base: 'star', halo: true},
    'Be*': {base: 'star', fill: 'deepskyblue', halo: true},
    'WR*': {base: 'star', size: 7, fill: 'mediumpurple', halo: true},
    'TT*': {base: 'star', size: 5, fill: 'orange', disc: true},
    'pr*': {base: 'star', size: 5, disc: true},
    'YSO': {base: 'star', size: 5, envelope: true},
    'PM*': {base: 'star', arrow: true},
    'N*':  {base: 'star', size: 4, fill: 'slategray'},
    'Psr': {base: 'star', size: 4, fill: 'slategray', beams: true},
    'BH':  {base: 'star', hole: true},

    // Double and multiple stars
    '**':  {base: 'double'},
    'EB*': {base: 'double', secondary: '#444', eclipse: true},
    'SB*': {base: 'double', merged: true, primary: 'gold',
	    secondary: 'deepskyblue'},
    'CV*': {base: 'double', primary: 'orange', ring: true},
    'No*': {base: 'double', burst: true},
    'XB*': {base: 'double', primary: 'deepskyblue', secondary: 'black',
	    ring: true},
    'SyS': {base: 'double', primary: 'red', primaryR: 4},

    // Variable stars
    'V*':  {base: 'variable'},
    'Pu*': {base: 'variable', letters: 'P'},
    'Ce*': {base: 'variable', size: 7, fill: 'gold'},
    'RR*': {base: 'variable', size: 5, letters: 'RR'},
    'Mi*': {base: 'variable', size: 7, fill: 'red'},
    'LP*': {base: 'variable', size: 7, fill: 'orangered', letters: 'LP'},
    'dS*': {base: 'variable', size: 5, letters: 'dS'},
    'bC*': {base: 'variable', fill: 'dodgerblue'},
    'RV*': {base: 'variable', size: 7, fill: 'gold', letters: 'RV'},
    'Ro*': {base: 'variable', letters: 'Ro'},
    'Er*': {base: 'variable', fill: 'orange'},
    'Fl*': {base: 'variable', fill: 'tomato', spark: true},

    // Clusters
    'Cl*': {base: 'cluster'},
    'GlC': {base: 'cluster', dots: 5, fill: 'rgba(255,215,0,0.45)'},
    'OpC': {base: 'cluster', dots: 4, fill: 'rgba(173,216,230,0.45)',
	    dashed: true},
    'As*': {base: 'cluster', figure: true},
    'MGr': {base: 'cluster', arrow: true},

    // Nebulae and interstellar matter
    'Neb': {base: 'nebula'},
    'PN':  {base: 'nebula', round: true, fill: 'mediumturquoise', star: true},
    'SNR': {base: 'nebula', spiky: true, fill: 'coral'},
    'HII': {base: 'nebula', fill: 'hotpink', dots: 1},
    'RNe': {base: 'nebula', fill: 'cornflowerblue', dots: 1},
    'DNe': {base: 'nebula', fill: '#1a1a1a', stroke: '#9a9a9a'},
    'MoC': {base: 'nebula', fill: '#5a5a5a', core: true},
    'SFR': {base: 'nebula', fill: 'hotpink', dots: 3},

    // Galaxies and beyond
    'G':   {base: 'galaxy'},
    'AGN': {base: 'galaxy', core: true},
    'QSO': {base: 'galaxy', rx: 5, ry: 2.5, fill: 'deepskyblue', core: true},
    'BLL': {base: 'galaxy', rx: 5, ry: 2.5, fill: 'deepskyblue', core: true,
	    jet: true},
    'rG':  {base: 'galaxy', lobes: true},
    'Sy1': {base: 'galaxy', core: true, letters: '1'},
    'Sy2': {base: 'galaxy', core: true, letters: '2'},
    'SBG': {base: 'galaxy', fill: 'hotpink', dots: 2},
    'LIN': {base: 'galaxy', core: true, letters: 'L'},
    'EmG': {base: 'galaxy', fill: 'hotpink'},
    'LSB': {base: 'galaxy', fill: 'rgba(245,222,179,0.25)', dashed: true},
    'IG':  {base: 'galaxy', multi: 'interacting'},
    'PaG': {base: 'galaxy', multi: 'pair'},
    'GrG': {base: 'galaxy', multi: 'group'},
    'ClG': {base: 'galaxy', multi: 'cluster'},
};

/* The table and the picker's list must agree in both directions. There
   is no UI test runner to fail on a mismatch, so report it where the
   dev stack and the icon sheet show it; the fallback below still draws
   a marker for a category left out here, so this does not throw. */
{
    const codes = new Set(categories.map((c) => c.code));
    const missing = [...codes].filter((c) => !(c in ICONS));
    const extra = Object.keys(ICONS).filter((c) => !codes.has(c));
    if (missing.length > 0 || extra.length > 0) {
	console.error("icons.jsx and categories.js disagree:" +
		      (missing.length > 0
		       ? ` no icon for ${missing.join(", ")}` : "") +
		      (extra.length > 0
		       ? ` no category for ${extra.join(", ")}` : ""));
    }
}

// ---------------------------------------------------------------------
// Resolving a candidate's object type to an icon

const codeByLabel = new Map(categories.map((c) => [c.label, c.code]));
const groupByCode = new Map(categories.map((c) => [c.code, c.group]));

/* A label outside the table is placed in a group by its words. Galaxies
   are tested first, since "Galaxy in cluster" must not become a
   cluster; the other tests are disjoint over the labels the catalog
   produces. "Emission object" is a nebula before "object" can make it
   a star. */
const groupTests = [
    [/galax|quasar|seyfert|liner|bl lac/, 'galaxy'],
    [/binary|double|multiple|symbiotic/, 'double'],
    [/variable/, 'variable'],
    [/cluster|asterism|moving group|association/, 'cluster'],
    [/nebula|remnant|region|cloud|interstellar|medium|emission object/,
     'nebula'],
    [/star|stellar|dwarf|giant|pulsar|nova|object/, 'star'],
];

/* The icon for an object-type label: `{base, ...params}` for an offered
   category (a "(candidate)" type draws as the type it is a candidate
   of), the bare base shape for a label that names a group without being
   offered, and null - the plain dot - for anything else, an empty label
   and a raw code included. */
export function resolveIcon(objectType) {
    const label = (objectType || "").replace(/ \(candidate\)$/, "");
    const code = codeByLabel.get(label);
    if (code != null && code in ICONS) return ICONS[code];
    if (code != null) return {base: GROUP_BASE[groupByCode.get(code)]};
    const lower = label.toLowerCase();
    for (const [test, base] of groupTests) {
	if (test.test(lower)) return {base};
    }
    return null;
}

// The marker for a catalog object at a scene position. Drops in where
// the three-shape marker used to be; the caller's Group owns the hover,
// click and tap handlers, and any shape here takes part in hit testing.
export function CategoryIcon({x, y, objectType}) {
    const icon = resolveIcon(objectType);
    if (icon == null) {
	return (<Circle x={x} y={y} radius={3} fill="white" stroke="black"
			strokeWidth={objStrokeWidth}>
		</Circle>);
    }
    const {base, ...params} = icon;
    const Base = BASES[base];
    return (<Group x={x} y={y}>
		<Base {...params}></Base>
	    </Group>);
}

// ---------------------------------------------------------------------
// The icon sheet: every category's icon next to its code and label,
// grouped and ordered as the picker is, four columns across the
// 1000x500 scene. The left half sits on the sky color and the right half
// on the ground color (an object below the horizon is drawn over the
// ground), so legibility can be judged on both at once.

const SHEET = {width: 1000, height: 500, columns: 4, rowHeight: 23,
	       top: 12, sky: "#87CEEB", ground: "#D69847"};

export function IconSheet() {
    const rows = [];
    let group = null;
    for (const c of categories) {
	if (c.group != group) {
	    group = c.group;
	    rows.push({heading: group});
	}
	rows.push(c);
    }
    const perColumn = Math.ceil(rows.length / SHEET.columns);
    const colWidth = SHEET.width / SHEET.columns;
    const items = rows.map((row, i) => {
	const col = Math.floor(i / perColumn);
	const x = col * colWidth;
	const y = SHEET.top + (i % perColumn) * SHEET.rowHeight;
	const textFill = "black";
	if (row.heading) {
	    return (<Text key={`h${i}`} x={x + 10} y={y + 2} text={row.heading}
			  fontSize={10} fontStyle="bold" fill={textFill}>
		    </Text>);
	}
	return (<Group key={row.code}>
		    <CategoryIcon x={x + 22} y={y + 8} objectType={row.label}>
		    </CategoryIcon>
		    <Text x={x + 44} y={y + 3} text={row.code} fontSize={9}
			  fontFamily="monospace" fill={textFill}></Text>
		    <Text x={x + 76} y={y + 3} text={row.label} fontSize={9}
			  fill={textFill}></Text>
		</Group>);
    });
    return (<Group>
		<Rect x={0} y={0} width={SHEET.width / 2} height={SHEET.height}
		      fill={SHEET.sky}></Rect>
		<Rect x={SHEET.width / 2} y={0} width={SHEET.width / 2}
		      height={SHEET.height} fill={SHEET.ground}></Rect>
		{items}
	    </Group>);
}
