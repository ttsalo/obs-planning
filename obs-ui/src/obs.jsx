import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    useQuery,
} from '@tanstack/react-query'
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line, Group, Label,
	 Tag } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'

// Component to plot the current position of the given target in the sky,
// seen from the geographic location in the settings.
function Target({target, pos, fill="white"}) {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);

    console.log(`Target(${target})`);
    
    const { isPending, error, data } = useQuery({
	queryKey: ['targetData', target],
	queryFn: async () => {
	    const resp = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj`,
		{target: target, lat: pos.lat,
		 lon: pos.lon, time: new Date()},
		{timeout: 120 * 1000});
	    return resp.data;
	},
	refetchInterval: 60 * 1000
    });

    if (error) { console.log(`error=${error}`)};
    if (isPending) { return null };
    
    console.log(`Rendering object for ${target}`);

    const props = {x: stageSize.get("azToPx")(data.az),
		   y: stageSize.get("altToPx")(data.alt),
		   radius: data.radius * stageSize.get("zoom")
		   * (target == "Sun" || target == "Moon" ?
		      stageSize.get("moonzoom") :
		      stageSize.get("planetzoom"))}
    
    return (<Circle fill={fill} stroke="black" x={props.x}
		    y={props.y} radius={props.radius}>
	    </Circle>)
};

// Component to plot the future path of a given target in the sky,
// seen from the geographic location in the settings.
function TargetPath({target, pos}) {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);

    console.log(`TargetPath(${target})`);
    
    function altToBrightness(elem) {
	const alt = elem.sun_alt;
	if (alt >= 0) return 4;
	if (alt >= -6) return 3;
	if (alt >= -12) return 2;
	if (alt >= -18) return 1;
	return 0;
    };

    function brightnessChangeToAlt(b1, b2) {
	if (b1 == 0 || b2 == 0) return -18;
	if (b1 == 1 || b2 == 1) return -12;
	if (b1 == 4 || b2 == 4) return 0;
	return -6;
    }

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

    const { isPending, error, data } = useQuery({
	queryKey: ['targetPathData', target],
	queryFn: async () => {
	    const resp = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj-timeseries`,
		{target: target, lat: pos.lat,
		 lon: pos.lon, time: new Date(), timespan: "day"},
	    	{timeout: 120 * 1000});
	    return resp.data;
	},
	refetchInterval: 30 * 60 * 1000
    });

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
    
    // Latest values pulled from the remote data
    let x = 0;
    let y = 0;
    let sy = 0;
    let ts = null;
    let brightness = null;
    
    for (const elem in data.series) {
	x = stageSize.get("azToPx")(data.series[elem].az);
	y = stageSize.get("altToPx")(data.series[elem].alt);
	sy = stageSize.get("altToPx")(
	    data.series[elem].sun_alt);
	ts = new Date(data.series[elem].ts);
	brightness = altToBrightness(data.series[elem]);
	
	if (prev_x != null && prev_x > x) {
	    // Segment wrapped around the right side of the stage,
	    // break up the line into segments to avoid drawing a
	    // line back to left across the stage. 
	    inner_segments.push(inner_points);
	    inner_points = [];
	    outer_segments.push([brightness, outer_points]);
	    outer_points = [];
	    prev_brightness = null;
	}
	
	inner_points.push(x);
	inner_points.push(y);
	
	if (prev_brightness != null && prev_brightness != brightness) {
	    // The path crossed a brightness limit, break it into
	    // a separate segment marked with the brigness. XXX
	    // needs interpolation so that we can cut the segment
	    // at the exact point.
	    const [dx, dy, dts] = interpolateTransition(
		prev_x, prev_y, prev_sy, prev_ts,
		x, y, sy, ts, prev_brightness, brightness);
	    transition_events.push({x: dx, y: dy, ts: dts,
				    b: brightness});
	    outer_points.push(dx);
	    outer_points.push(dy);
	    outer_segments.push([prev_brightness, outer_points]);
	    outer_points = [dx, dy];
	} else {
	    outer_points.push(x);
	    outer_points.push(y);
	}
	prev_brightness = brightness;
	prev_x = x;
	prev_y = y;
	prev_sy = sy;
	prev_ts = ts;
    };
    inner_segments.push(inner_points);
    outer_segments.push([brightness, outer_points]);

    const outerSegs = outer_segments.map(seg =>
	<Line points={seg[1]} strokeWidth={5} 
	      stroke={brightnessToColor[seg[0]]} tension={1}
	      shadowColor={brightnessToColor[seg[0]]} shadowBlur={10}>
	</Line>)

    const innerSegs = inner_segments.map(seg =>
	<Line points={seg} strokeWidth={1} 
	      stroke={target == "sun" ? "yellow" : "white"} tension={1}>
	</Line>)

    const transitionEvs = transition_events.map(ev =>
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

    stageSize.forEach((value, key) => {
	console.log(`${key} = ${value}`);
    });
    
    if (session == null) {
	console.log("session null, skip rendering contents");
	return null;
    }

    const posQ = useQuery({
	queryKey: ["positions"],
	queryFn: async () => {
	    const response = await axios.get('/api/positions');
	    return response.data;
	    },
	})
    const searchQ = useQuery({
	queryKey: ["searches"],
	queryFn: async () => {
	    const response = await axios.get('/api/searches');
	    return response.data;
	    },
	})
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
    console.log(`Found pos: ${pos}`)
    const search = searchQ.data.find((i) => (i.name == session.search))
    console.log(`Found search: ${search}`)

    const paths = search.TargetObjects.map(obj =>
	<TargetPath target={obj.name} pos={pos}>
	</TargetPath>)
    
    const targets = search.TargetObjects.map(obj =>
	<Target target={obj.name} pos={pos}>
	</Target>)
    
    return (<Layer>
		<CoordGrid>
		</CoordGrid>
		{paths}
		<TargetPath target="Sun" pos={pos}>
		</TargetPath>
		{targets}
		<Target pos={pos} target="Sun" fill="yellow">
		</Target>
	    </Layer>
	   )
};

export default ObsStage;
