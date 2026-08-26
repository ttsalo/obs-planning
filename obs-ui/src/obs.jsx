import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    useQuery,
} from '@tanstack/react-query'
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line, Group, Label,
	 Tag, Shape } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'
import { useAstroBase } from './config.jsx'
import { altToBrightness, brightnessChangeToAlt, checkObsWindow,
	 findUpcomingTransitions, findNextTransition } from './transitions.jsx'

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

// Shared outline width for all object markers, so the moon (whose outline
// is a separate stroke-only circle on top of the phase shapes) matches the
// plain filled-circle objects exactly.
const objStrokeWidth = 1.2;

// Draw the representation of a given object. When phase data is present
// (moon only), the disc is split into a dark base circle and a lit region
// whose flat side is the terminator, rotated so the bright limb faces the
// sun's position on the sky.
function ObsObject({target, x, y, radius, phase = null, alt = 0}) {
    const obj = objMap.get(target);
    if (!obj) return null;
    if (phase == null) {
	return (<Circle fill={obj.fill} stroke="black"
			strokeWidth={objStrokeWidth}
			x={x} y={y} radius={obj.radius || radius}>
		</Circle>)
    }

    const r = obj.radius || radius;
    // The backend angle is a true sky bearing; the plate-carrée canvas
    // stretches azimuth by 1/cos(alt), so correct the bearing before
    // using it as a rotation (~12° visible error at alt 55° otherwise).
    const chi = phase.angle * Math.PI / 180;
    const cosAlt = Math.max(Math.cos(alt * Math.PI / 180), 0.05);
    const screenAngle = Math.atan2(Math.sin(chi) / cosAlt,
				   Math.cos(chi)) * 180 / Math.PI;
    const c = 2 * phase.k - 1;  // signed terminator semi-minor fraction

    return (<Group x={x} y={y} rotation={screenAngle}>
		<Circle x={0} y={0} radius={r} fill="#3a3a44">
		</Circle>
		<Shape fill={obj.fill}
		       sceneFunc={(ctx, shape) => {
			   ctx.beginPath();
			   // Bright limb points up (-y) in this unrotated
			   // frame: upper semicircle from (-r,0) to (r,0).
			   ctx.arc(0, 0, r, Math.PI, 2 * Math.PI, false);
			   // Terminator half-ellipse back to (-r,0):
			   // gibbous (c>0) bulges into the dark side,
			   // crescent (c<0) into the bright side.
			   ctx.ellipse(0, 0, r, Math.abs(c) * r, 0,
				       0, Math.PI, c < 0);
			   ctx.closePath();
			   ctx.fillStrokeShape(shape);
		       }}>
		</Shape>
		<Circle x={0} y={0} radius={r} stroke="black"
			strokeWidth={objStrokeWidth} fillEnabled={false}>
		</Circle>
	    </Group>)
}

function fmtTime(ts) {
    return `${String(ts.getHours()).padStart(2, "0")}:` +
	`${String(ts.getMinutes()).padStart(2, "0")}`;
}

const brightnessLabel = ["Night", "Astro twilight", "Nautical twilight",
			  "Civil twilight", "Day"];

// Conventional phase name from the illuminated fraction and the waxing
// flag, both provided by the astro backend for the moon.
function moonPhaseLabel(illumination, waxing) {
    if (illumination <= 0.02) return "New moon";
    if (illumination >= 0.98) return "Full moon";
    if (illumination >= 0.45 && illumination <= 0.55)
	return waxing ? "First quarter" : "Last quarter";
    if (illumination < 0.5) return waxing ? "Waxing crescent" : "Waning crescent";
    return waxing ? "Waxing gibbous" : "Waning gibbous";
}

// Shared tooltip box: a Konva Label/Tag/Text positioned at (x,y), used by
// both TargetTooltip (marker hover) and SegmentTooltip (path hover).
function InfoTooltip({x, y, lines, pointerDirection = "up", opacity = 0.9}) {
    return (<Label x={x} y={y} opacity={opacity}>
		<Tag fill="white" pointerDirection={pointerDirection}
		     pointerHeight={8} pointerWidth={5} stroke="black"
		     strokeWidth={1} lineJoin="round">
		</Tag>
		<Text fill="black" padding={4} align="left"
		      fontFamily="Verdana" fontSize={11} text={lines.join("\n")}>
		</Text>
	    </Label>);
}

// Hover/tap tooltip for a target marker: name, current alt/az, the moon
// phase (moon only, when the backend provides it), and the next upcoming
// brightness and visibility transitions. pointerDirection
// defaults to centering the box above the marker, but the caller passes
// "left"/"right" near the edges of the visible area so the box is anchored
// away from the edge instead of clipping off it (see edgePointerDirection).
function TargetTooltip({target, alt, az, x, y, transitions, phase = null,
			 pointerDirection = "up"}) {
    const lines = [
	target,
	`Alt ${alt.toFixed(1)}°  Az ${az.toFixed(1)}°`,
	...(phase != null
	    ? [`Phase: ${Math.round(phase.illumination * 100)}% ` +
	       moonPhaseLabel(phase.illumination, phase.waxing)]
	    : []),
	transitions.brightness
	    ? `Next: ${brightnessLabel[transitions.brightness.b]} ` +
	      `${fmtTime(transitions.brightness.ts)}`
	    : "Next: no change",
	transitions.visibility
	    ? `${transitions.visibility.vis ? "Rises" : "Sets"} ` +
	      `${fmtTime(transitions.visibility.ts)}`
	    : "Visibility: no change"
    ];

    return <InfoTooltip x={x} y={y} lines={lines} pointerDirection={pointerDirection}></InfoTooltip>;
}

// Hover/tap tooltip for a target path segment: name, the segment's
// midpoint alt/az/time, and the single next transition (brightness or
// visibility, whichever occurs sooner) from that point along the path.
function SegmentTooltip({target, alt, az, ts, x, y, transition,
			  pointerDirection = "up"}) {
    const lines = [
	target,
	`${fmtTime(ts)}  Alt ${alt.toFixed(1)}°  Az ${az.toFixed(1)}°`,
	transition == null ? "Next: no change"
	    : transition.kind === 'brightness'
	    ? `Next: ${brightnessLabel[transition.b]} ${fmtTime(transition.ts)}`
	    : `${transition.vis ? "Rises" : "Sets"} ${fmtTime(transition.ts)}`
    ];

    return <InfoTooltip x={x} y={y} lines={lines} pointerDirection={pointerDirection}></InfoTooltip>;
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
    const astroBase = useAstroBase();

    // The datetime part of the query key is divided so that it has
    // a half an hour granularity, so the one minute intervals for
    // updating target object positions don't re-query the path data
    // more of then than that.
    return useQuery({
	queryKey: ['targetPathData', target,
		   Math.floor(renderTS / 1000 / 60 / 30)],
	queryFn: async () => {
	    const resp = await axios.post(
		`${astroBase}/api/get-obj-timeseries`,
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
    const astroBase = useAstroBase();
    return useQuery({
	queryKey: ['targetData', target, renderTS],
	queryFn: async () => {
	    const resp = await axios.post(
		`${astroBase}/api/get-obj`,
		{target: target, lat: pos.lat,
		 lon: pos.lon, time: renderTS},
		{timeout: 120 * 1000});
	    return resp.data;
	}
    });
}

// Component to plot the current position of the given target in the sky,
// seen from the geographic location in the settings. Reports hover/tap in
// and out via onHover({type:'target',target}|null|updaterFn) so that
// ObsStage can render the tooltip itself as the last (topmost) element in
// the Layer, rather than nested under whichever target happens to be
// hovered. Shares the hover state (and its {type,...} shape) with
// TargetPath's segment hover, so a marker tooltip and a segment tooltip
// can never both be open at once.
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
		    onHover({type: 'target', target});
		    e.target.getStage().container().style.cursor = 'pointer';
		}}
		onMouseLeave={(e) => {
		    onHover((prev) =>
			(prev?.type === 'target' && prev.target === target) ? null : prev);
		    e.target.getStage().container().style.cursor = 'default';
		}}
		onTap={() => onHover((prev) =>
		    (prev?.type === 'target' && prev.target === target) ? null
		    : {type: 'target', target})}>
		<ObsObject target={target} x={props.x} y={props.y}
			   radius={props.radius} alt={data.alt}
			   phase={data.illumination != null
				  ? {k: data.illumination,
				     angle: data.bright_limb_angle}
				  : null}></ObsObject>
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

    // Gate on field presence rather than the target name so a backend
    // without phase support just yields a tooltip without the phase line.
    const phase = posQ.data.illumination != null
	  ? {illumination: posQ.data.illumination, waxing: posQ.data.waxing}
	  : null;

    return (<TargetTooltip target={target} alt={posQ.data.alt} az={posQ.data.az}
			    x={x} y={y} transitions={transitions} phase={phase}
			    pointerDirection={edgePointerDirection(x, stageSize)}>
	    </TargetTooltip>);
};

// Renders the tooltip for whichever half-hour path segment is currently
// hovered/tapped. Like HoveredTooltip, rendered once by ObsStage as the
// last child of the Layer so it's always on top. startIndex is the
// data.series index of the interval's first sample; the interval's
// midpoint alt/az/time is the plain average of that sample and the next.
function HoveredSegmentTooltip({target, startIndex, pos}) {
    const stageSize = useContext(StageContext);
    // React Query dedupes this against TargetPath's identical query for
    // the same target, so this normally isn't an extra network request.
    const pathQ = useTargetPathData(target, pos, stageSize);

    if (pathQ.isPending || pathQ.error) {
	return null;
    }

    const s1 = pathQ.data.series[startIndex];
    const s2 = pathQ.data.series[startIndex + 1];
    if (!s1 || !s2) {
	// Covers the case where the date/time picker changes while a
	// segment tooltip is open: the query can return a different day's
	// (differently-shaped) series before startIndex is invalidated.
	return null;
    }

    const alt = (s1.alt + s2.alt) / 2;
    const az = (s1.az + s2.az) / 2;
    const ts = new Date((new Date(s1.ts).getTime() + new Date(s2.ts).getTime()) / 2);
    const x = stageSize.get("azToPx")(az);
    const y = stageSize.get("altToPx")(alt);
    const transition = findNextTransition(pathQ.data.series, pos, target, startIndex);

    return (<SegmentTooltip target={target} alt={alt} az={az}
			     ts={ts} x={x} y={y}
			     transition={transition}
			     pointerDirection={edgePointerDirection(x, stageSize)}>
	    </SegmentTooltip>);
};

// Component to plot the future path of a given target in the sky,
// seen from the geographic location in the settings.
function TargetPath({target, pos, onHover}) {
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

    // One small (2-point) line per half-hour sample interval, entirely
    // separate from outer/inner segments above: those are merged across
    // many samples for smooth (tension) visual rendering, but hover
    // tooltips are wanted at half-hour granularity, which a merged
    // multi-hour band can't give. {points, startIndex} where startIndex
    // is the data.series index of the interval's first sample.
    const hit_segments = [];

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
    let i = null;
    let brightness = null;
    let vis = null;
    let wrap = null;
    let vis_change = null;

    for (const elem in data.series) {
	i = Number(elem);
	x = stageSize.get("azToPx")(data.series[elem].az);
	y = stageSize.get("altToPx")(data.series[elem].alt);
	sy = stageSize.get("altToPx")(
	    data.series[elem].sun_alt);
	ts = new Date(data.series[elem].ts);
	brightness = altToBrightness(data.series[elem]);
	vis = (target == "Sun") || checkObsWindow(pos, data.series[elem].alt, data.series[elem].az);

	wrap = (prev_x != null && prev_x > x);
	vis_change = (vis != null && prev_vis != null && vis != prev_vis);

	if (prev_x != null && !wrap && !vis_change && vis) {
	    // The interval from the previous sample to this one doesn't
	    // cross a discontinuity and is visible throughout, so it's a
	    // valid, single half-hour hover target.
	    hit_segments.push({points: [prev_x, prev_y, x, y], startIndex: i - 1});
	}

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

    // Invisible half-hour-interval hover targets, one Line per entry in
    // hit_segments. Rendered last (after transitionEvs) so they take hit
    // priority over everything else, including the Sun's persistent
    // transition labels -- unlike a visible line, there's no harm in an
    // invisible hit target winning over a label drawn on top of it.
    const hitSegs = hit_segments.map(seg =>
	<Line points={seg.points} strokeWidth={0} hitStrokeWidth={20}
	      stroke="black"
	      onMouseEnter={(e) => {
		  onHover({type: 'segment', target, startIndex: seg.startIndex});
		  e.target.getStage().container().style.cursor = 'pointer';
	      }}
	      onMouseLeave={(e) => {
		  onHover((prev) =>
		      (prev?.type === 'segment' && prev.target === target &&
		       prev.startIndex === seg.startIndex) ? null : prev);
		  e.target.getStage().container().style.cursor = 'default';
	      }}
	      onTap={() => onHover((prev) =>
		  (prev?.type === 'segment' && prev.target === target &&
		   prev.startIndex === seg.startIndex) ? null
		  : {type: 'segment', target, startIndex: seg.startIndex})}>
	</Line>)

    return (<>
		{outerSegs}
		{innerSegs}
		{transitionEvs}
		{hitSegs}
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
    // null | {type:'target', target} | {type:'segment', target, startIndex}
    // -- unified so a marker tooltip and a path-segment tooltip can never
    // both be open at once.
    const [hovered, setHovered] = useState(null);

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
	<TargetPath target={obj.name} pos={pos} onHover={setHovered}>
	</TargetPath>)

    const targets = search.TargetObjects.map(obj =>
	<Target target={obj.name} pos={pos} onHover={setHovered}>
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
		<TargetPath target="Sun" pos={pos} onHover={setHovered}>
		</TargetPath>
		<Target pos={pos} target="Sun" fill="yellow" onHover={setHovered}>
		</Target>
		{hovered?.type === 'target' &&
		 <HoveredTooltip target={hovered.target} pos={pos}>
		 </HoveredTooltip>}
		{hovered?.type === 'segment' &&
		 <HoveredSegmentTooltip target={hovered.target} startIndex={hovered.startIndex} pos={pos}>
		 </HoveredSegmentTooltip>}
	    </Layer>
	   )
};

export default ObsStage;
