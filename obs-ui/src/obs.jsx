import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    useQuery,
} from '@tanstack/react-query'
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line, Group, Label,
	 Tag } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'
import { altToBrightness, brightnessChangeToAlt, checkObsWindow,
	 findUpcomingTransitions } from './transitions.jsx'

// Artistic representations of solar system objects
const objMap = new Map();
objMap.set("Sun", {fill: "yellow", radius: null});
objMap.set("Moon", {fill: "white", radius: null});
objMap.set("Mercury", {fill: "darkgray", radius: 3.5});
objMap.set("Venus", {fill: "papayawhip", radius: 4});
objMap.set("Mars", {fill: "salmon", radius: 3.5});
objMap.set("Jupiter", {fill: "orange", radius: 6});
objMap.set("Saturn", {fill: "peachpuff", radius: 5.8});
objMap.set("Uranus", {fill: "lightskyblue", radius: 5});
objMap.set("Neptune", {fill: "cornflowerblue", radius: 5});

// Draw the representation of a given object. 
function ObsObject({target, x, y, radius}) {
    const obj = objMap.get(target);
    if (!obj) return null;
    return (<Circle fill={obj.fill} stroke="black" strokeWidth={1.5}
		    x={x} y={y} radius={obj.radius || radius}>
	    </Circle>)
}

function fmtTime(ts) {
    return `${String(ts.getHours()).padStart(2, "0")}:` +
	`${String(ts.getMinutes()).padStart(2, "0")}`;
}

const brightnessLabel = ["Night", "Astro twilight", "Nautical twilight",
			  "Civil twilight", "Day"];

// Hover/tap tooltip for a target marker: name, current alt/az, and the
// next upcoming brightness and visibility transitions. pointerDirection
// defaults to centering the box above the marker, but the caller passes
// "left"/"right" near the edges of the visible area so the box is anchored
// away from the edge instead of clipping off it (see edgePointerDirection).
function TargetTooltip({target, alt, az, x, y, transitions,
			 pointerDirection = "up"}) {
    const text = [
	target,
	`Alt ${alt.toFixed(1)}°  Az ${az.toFixed(1)}°`,
	transitions.brightness
	    ? `Next: ${brightnessLabel[transitions.brightness.b]} ` +
	      `${fmtTime(transitions.brightness.ts)}`
	    : "Next: no change",
	transitions.visibility
	    ? `${transitions.visibility.vis ? "Rises" : "Sets"} ` +
	      `${fmtTime(transitions.visibility.ts)}`
	    : "Visibility: no change"
    ].join("\n");

    return (<Label x={x} y={y} opacity={0.9}>
		<Tag fill="white" pointerDirection={pointerDirection}
		     pointerHeight={8} pointerWidth={5} stroke="black"
		     strokeWidth={1} lineJoin="round">
		</Tag>
		<Text fill="black" padding={4} align="left"
		      fontFamily="Verdana" fontSize={11} text={text}>
		</Text>
	    </Label>);
}

// The tooltip box is centered on its anchor x for pointerDirection "up",
// so near the left/right edges of the visible area it would run off the
// edge; anchor it to the opposite side there instead ("left" keeps the box
// to the right of x, "right" keeps it to the left of x). The margin is a
// rough estimate of half the tooltip's rendered width, in the same fudged
// spirit as CoordGrid's label-position adjustments.
function edgePointerDirection(x, stageSize) {
    const edgeMargin = 130;
    const visibleWidth = stageSize.get("width") / stageSize.get("scale");
    if (x < edgeMargin) return "left";
    if (x > visibleWidth - edgeMargin) return "right";
    return "up";
}

// Calculate the timestamp to render based on current render timestamp
// on the context, modified by the optionally user-selected date and
// time
function CalcRenderTS(stageSize) {
    const ts = new Date(stageSize.get("renderts"));
    const time = stageSize.get("time");
    const date = stageSize.get("date");
    if (time != null) {
	ts.setHours(time.hour());
	ts.setMinutes(time.minute());
	ts.setSeconds(time.second());
    }
    if (date != null) {
	ts.setFullYear(date.year());
	ts.setMonth(date.month());
	ts.setDate(date.date());
    }
    return ts;
}

// Fetches the day-long alt/az/sun_alt timeseries for a target. Shared by
// TargetPath (path rendering) and Target (upcoming-transitions tooltip) so
// the two components' React Query cache entries are the same request.
function useTargetPathData(target, pos, stageSize) {
    const renderTS = CalcRenderTS(stageSize);

    // The datetime part of the query key is divided so that it has
    // a half an hour granularity, so the one minute intervals for
    // updating target object positions don't re-query the path data
    // more of then than that.
    return useQuery({
	queryKey: ['targetPathData', target,
		   Math.floor(renderTS / 1000 / 60 / 30)],
	queryFn: async () => {
	    const resp = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj-timeseries`,
		{target: target, lat: pos.lat,
		 lon: pos.lon, time: renderTS,
		 timespan: "day"},
		{timeout: 120 * 1000});
	    return resp.data;
	}
    });
}

// Fetches the current alt/az/radius for a target.
function useTargetPosition(target, pos, stageSize) {
    const renderTS = CalcRenderTS(stageSize);
    return useQuery({
	queryKey: ['targetData', target, renderTS],
	queryFn: async () => {
	    const resp = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj`,
		{target: target, lat: pos.lat,
		 lon: pos.lon, time: renderTS},
		{timeout: 120 * 1000});
	    return resp.data;
	}
    });
}

// Component to plot the current position of the given target in the sky,
// seen from the geographic location in the settings. Reports hover/tap
// in and out via onHover(target|null|updaterFn) so that ObsStage can
// render the tooltip itself as the last (topmost) element in the Layer,
// rather than nested under whichever target happens to be hovered.
function Target({target, pos, fill="white", onHover}) {
    const stageSize = useContext(StageContext);

    console.log(`Target(${target})`);

    const { isPending, error, data } = useTargetPosition(target, pos, stageSize);

    if (error) { console.log(`error=${error}`)};
    if (isPending) { return null };

    console.log(`Rendering object for ${target}`);

    // The real (artificially zoomed) radius is only used for sun
    // and moon, planets use artistic radius
    const props = {x: stageSize.get("azToPx")(data.az),
		   y: stageSize.get("altToPx")(data.alt),
		   radius: data.radius * stageSize.get("zoom")
                   * stageSize.get("moonzoom")}

    return (<Group
		onMouseEnter={(e) => {
		    onHover(target);
		    e.target.getStage().container().style.cursor = 'pointer';
		}}
		onMouseLeave={(e) => {
		    onHover((prev) => prev === target ? null : prev);
		    e.target.getStage().container().style.cursor = 'default';
		}}
		onTap={() => onHover((prev) => prev === target ? null : target)}>
		<ObsObject target={target} x={props.x} y={props.y}
			   radius={props.radius}></ObsObject>
	    </Group>)
};

// Renders the tooltip for whichever target is currently hovered/tapped.
// Rendered once by ObsStage as the last child of the Layer so it always
// paints on top of every path and marker, regardless of which target it's
// for (the Sun's path/labels are otherwise always drawn last).
function HoveredTooltip({target, pos}) {
    const stageSize = useContext(StageContext);
    const posQ = useTargetPosition(target, pos, stageSize);
    // React Query dedupes this against TargetPath's identical query for
    // the same target, so this normally isn't an extra network request.
    const pathQ = useTargetPathData(target, pos, stageSize);

    if (posQ.isPending || posQ.error || pathQ.isPending || pathQ.error) {
	return null;
    }

    const x = stageSize.get("azToPx")(posQ.data.az);
    const y = stageSize.get("altToPx")(posQ.data.alt);
    const transitions = findUpcomingTransitions(pathQ.data.series, pos, target);

    return (<TargetTooltip target={target} alt={posQ.data.alt} az={posQ.data.az}
			    x={x} y={y} transitions={transitions}
			    pointerDirection={edgePointerDirection(x, stageSize)}>
	    </TargetTooltip>);
};

// Component to plot the future path of a given target in the sky,
// seen from the geographic location in the settings.
function TargetPath({target, pos}) {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);

    console.log(`TargetPath(${target})`);

    const brightnessToColor =
	  ["black", "#0000C0", "#4040FF", "#8080FF", "yellow"];

    // The line segment is crossing a brightness transition, interpolate
    // the exact point where that happens
    function interpolateTransition(x1, y1, sy1, ts1, x2, y2, sy2, ts2, b1, b2) {
	const alt = brightnessChangeToAlt(b1, b2);
	const altPx = stageSize.get("altToPx")(alt);
	const d = (sy1 - altPx) / (sy1 - sy2);
	//console.log(`${target} crossed ${alt} with ratio ${d}`);
	return [x1 + ((x2 - x1) * d), y1 + ((y2 - y1) * d),
		new Date(ts1.getTime() + ((ts2 - ts1) * d))];
    };

    const { isPending, error, data } = useTargetPathData(target, pos, stageSize);

    if (error) { console.log(`error=${error}`)};
    if (isPending) { return null };

    // Outer segments is a list of pairs, first item in the pair
    // being the brightness level 0-4 (day, civil, nautical
    // and astronomical twilight and full night)
    const outer_segments = [];
    
    // Inner segments is a list of lists, this is just so that we
    // can break the discontinuity at 0/360 azimuth
    const inner_segments = [];

    const transition_events = [];

    // Temporary arrays of points
    let outer_points = [];
    let inner_points = [];
    
    // Previous values, comparing these to the latest values
    // is used to decide when point sequences are split into
    // the segments
    let prev_x = null;
    let prev_y = null;
    let prev_sy = null;
    let prev_ts = null;
    let prev_brightness = null;
    let prev_vis = null;
    
    // Latest values pulled from the remote data
    let x = 0;
    let y = 0;
    let sy = 0;
    let ts = null;
    let brightness = null;
    let vis = null;
    let wrap = null;
    let vis_change = null;
    
    for (const elem in data.series) {
	x = stageSize.get("azToPx")(data.series[elem].az);
	y = stageSize.get("altToPx")(data.series[elem].alt);
	sy = stageSize.get("altToPx")(
	    data.series[elem].sun_alt);
	ts = new Date(data.series[elem].ts);
	brightness = altToBrightness(data.series[elem]);
	vis = (target == "Sun") || checkObsWindow(pos, data.series[elem].alt, data.series[elem].az);

	wrap = (prev_x != null && prev_x > x);
	vis_change = (vis != null && prev_vis != null && vis != prev_vis);
	
	if (wrap || vis_change) {
	    // This datapoint is crossing a discontinuity either at
	    // az=360 or to/from observation window, break the currently
	    // collected line into a separate segment and start building
	    // the next one.
	    if (prev_vis) {
		// Collect segments if this is the az wrap or a visibility
		// change from visible to not visible, otherwise discard.
		// If we wanted a different processing for non-visible
		// segments, they could be stored somewhere else and handled
		// later separately. (Same for other conditional pushes below)
		inner_segments.push(inner_points);
		outer_segments.push([brightness, outer_points]);
	    }
	    inner_points = [];
	    outer_points = [];
	    prev_brightness = null;
	    prev_vis = null;
	}
	
	inner_points.push(x);
	inner_points.push(y);
	
	if (prev_brightness != null && prev_brightness != brightness) {
	    // The path crossed a brightness limit, break it into
	    // a separate segment marked with the brigness.
	    const [dx, dy, dts] = interpolateTransition(
		prev_x, prev_y, prev_sy, prev_ts,
		x, y, sy, ts, prev_brightness, brightness);
	    transition_events.push({x: dx, y: dy, ts: dts,
				    b: brightness});
	    outer_points.push(dx);
	    outer_points.push(dy);
	    if (vis) {
		outer_segments.push([prev_brightness, outer_points]);
	    }
	    outer_points = [dx, dy];
	} else {
	    outer_points.push(x);
	    outer_points.push(y);
	}
	prev_vis = vis;
	prev_brightness = brightness;
	prev_x = x;
	prev_y = y;
	prev_sy = sy;
	prev_ts = ts;
    };
    if (vis) {
	inner_segments.push(inner_points);
	outer_segments.push([brightness, outer_points]);
    }

    const outerSegs = outer_segments.filter(
	seg => target == "Sun" || seg[0] < 4).map(seg =>
	<Line points={seg[1]} strokeWidth={5} 
	      stroke={brightnessToColor[seg[0]]} tension={1}
	      shadowColor={brightnessToColor[seg[0]]} shadowBlur={10}>
	</Line>)

    const innerSegs = inner_segments.map(seg =>
	<Line points={seg} strokeWidth={1} 
	      stroke={target == "Sun" ? "yellow" : "white"} tension={1}>
	</Line>)

    var transitionEvs = null;
    if (target == "Sun") {
	transitionEvs = transition_events.map(ev =>
	    <Label x={ev.x} y={ev.y} opacity={0.75}>
		<Tag fill="white" pointerDirection="up" pointerHeight={8}
		     pointerWidth={5} stroke="black" strokeWidth={1}>
		</Tag>
		<Text fill="black" padding={1} align="center"
		      fontFamily="Verdana" fontSize={12} 
		      text={["N", "AT", "NT", "CT", "D"][ev.b] + "\n" +
			    String(ev.ts.getHours()).padStart(2, "0") + "\n" +
			    String(ev.ts.getMinutes()).padStart(2, "0")}>
		</Text>
	    </Label>)
    }

    return (<>
		{outerSegs}
		{innerSegs}
		{transitionEvs}
	    </>);
};

// Coordinate grid component
function CoordGrid() {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);

    const azToPx = stageSize.get("azToPx");
    const altToPx = stageSize.get("altToPx");

    let azGrid = [];
    let altGrid = [];
    // Adjust step based on zoom level when implemented. Also used to fudge
    // the label positions which would otherwise be off the visible area.
    const step = 30;

    const minAzPx = azToPx(stageSize.get("minAz"));
    const maxAzPx = azToPx(stageSize.get("maxAz"));
    const minAltPx = altToPx(stageSize.get("minAlt"));
    const maxAltPx = altToPx(stageSize.get("maxAlt"));
    const horizonAltPx = altToPx(0);
    
    for (let i = stageSize.get("minAz") + step;
	 i < stageSize.get("maxAz"); i = i + step) {
	azGrid.push({az: i, major: (i == 90 || i == 180 || i == 270),
		     azPx: azToPx(i),
		     labelAltPx: altToPx(stageSize.get("maxAlt") - step/3)});
    };
    
    for (let i = stageSize.get("minAlt") + step;
	 i < stageSize.get("maxAlt"); i = i + step) {
	altGrid.push({alt: i, major: (i == 0), altPx: altToPx(i),
		      labelAzPx: azToPx(stageSize.get("minAz") + step/2)});
    };

    const azLines = azGrid.map(azLine =>
	<Line points={[azLine.azPx, minAltPx,
		       azLine.azPx, maxAltPx]}
	      stroke={azLine.major ? "#000000" : "#888888"}
	      strokeWidth={azLine.major ? 1 : 0.5}>
	</Line>);

    const altLines = altGrid.map(altLine =>
	<Line points={[minAzPx, altLine.altPx,
		       maxAzPx, altLine.altPx]}
	      stroke={altLine.major ? "#000000" : "#888888"}
	      strokeWidth={altLine.major ? 1 : 0.5}>
	</Line>);
    
    const azLabels = azGrid.map(azLine =>
	<Label x={azLine.azPx} y={azLine.labelAltPx}>
	    <Tag pointerDirection='down'
		 pointerWidth={6}
		 pointerHeight={6}
		 lineJoin='round'
		 fill='white'
		 stroke='#808080'
		 strokeWidth={1}>
	    </Tag>
	    <Text text={`${azLine.az}°`} padding={2} fill='black'>
	    </Text>
	</Label>);

    const altLabels = altGrid.map(altLine =>
	<Label x={altLine.labelAzPx} y={altLine.altPx}>
	    <Tag pointerDirection='right'
		 pointerWidth={6}
		 pointerHeight={6}
		 lineJoin='round'
		 fill='white'
		 stroke='#808080'
		 strokeWidth={1}>
	    </Tag>
	    <Text text={`${altLine.alt}°`} padding={2} fill='black'>
	    </Text>
	</Label>);

    // Sky and ground backgrounds with coordinate lines and labels on top
    return (<Group>
		<Rect x={minAzPx} y={maxAltPx} width={maxAzPx-minAzPx}
		      height={horizonAltPx-maxAltPx}
		      strokeEnabled={false} fill="#87CEEB">
		</Rect>
		<Rect x={minAzPx} y={horizonAltPx} width={maxAzPx-minAzPx}
		      height={minAltPx-horizonAltPx}
		      strokeEnabled={false} fill="#D69847">
		</Rect>
		{azLines}{altLines}{azLabels}{altLabels}
	    </Group>);
};

const ObsStage = () => {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);
    const [hoveredTarget, setHoveredTarget] = useState(null);

    stageSize.forEach((value, key) => {
	console.log(`${key} = ${value}`);
    });

    // These queries must run unconditionally on every render (Rules of
    // Hooks), so the session==null gating below happens after they're
    // called; `enabled` keeps them from firing before there's a session.
    const posQ = useQuery({
	queryKey: ["positions"],
	enabled: session != null,
	queryFn: async () => {
	    const response = await axios.get('/api/positions');
	    return response.data;
	    },
	})
    const searchQ = useQuery({
	queryKey: ["searches"],
	enabled: session != null,
	queryFn: async () => {
	    const response = await axios.get('/api/searches');
	    return response.data;
	    },
	})

    if (session == null) {
	console.log("session null, skip rendering contents");
	return null;
    }
    if (posQ.isPending || searchQ.isPending) {
	return null;
    };
    if (posQ.error) {
	console.log(`Failed to load positions: ${posQ.error}`);
	return null;
    };
    if (searchQ.error) {
	console.log(`Failed to load searches: ${searchQ.error}`);
	return null;
    };

    const pos = posQ.data.find((i) => (i.name == session.position))
    const search = searchQ.data.find((i) => (i.name == session.search))

    const paths = search.TargetObjects.map(obj =>
	<TargetPath target={obj.name} pos={pos}>
	</TargetPath>)

    const targets = search.TargetObjects.map(obj =>
	<Target target={obj.name} pos={pos} onHover={setHoveredTarget}>
	</Target>)

    // Construct the view of the sky. The elements later in the list are
    // drawn on top of the earlier ones, so we want the objects on
    // top of the paths except the sun path on top of everything but
    // the sun itself so that the illumination labels aren't obscured.
    // The hover tooltip is rendered last of all, so it always sits above
    // every path/marker no matter which target it belongs to.
    return (<Layer>
		<CoordGrid>
		</CoordGrid>
		{paths}
		{targets}
		<TargetPath target="Sun" pos={pos}>
		</TargetPath>
		<Target pos={pos} target="Sun" fill="yellow" onHover={setHoveredTarget}>
		</Target>
		{hoveredTarget &&
		 <HoveredTooltip target={hoveredTarget} pos={pos}>
		 </HoveredTooltip>}
	    </Layer>
	   )
};

export default ObsStage;
