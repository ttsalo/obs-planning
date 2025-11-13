import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line, Group, Label,
	 Tag } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'

// Component to plot the current position of the given target in the sky,
// seen from the geographic location in the settings.
function Target({target, fill="white"}) {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);
    const [remoteProps, setRemoteProps] = useState(null);

    // Function to fetch the current position and update the component state
    const fetchData = async () => {
	try {
	    const now = new Date();
	    const response = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj`,
		{target: target, lat: session.lat,
		 lon: session.lon, time: now});
	    setRemoteProps({x: stageSize.get("azToPx")(response.data.az),
			    y: stageSize.get("altToPx")(response.data.alt),
			    radius: response.data.radius * stageSize.get("zoom")
			    * (target == "sun" || target == "moon" ?
			       stageSize.get("moonzoom") :
			       stageSize.get("planetzoom"))});
	    // Set up a once per minute timeout to update the position.
	    setTimeout(fetchData, 60*1000);
	} catch (error) {
	    console.error("/get-obj fetch failed:", error); 
	}
    };
    
    if (remoteProps == null) {
	fetchData();
	return null;
    };

    return (<Circle fill={fill} stroke="black" x={remoteProps.x}
		    y={remoteProps.y} radius={remoteProps.radius}>
	    </Circle>)
};

// Component to plot the future path of a given target in the sky,
// seen from the geographic location in the settings.
function TargetPath({target}) {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);
    const [remoteProps, setRemoteProps] = useState(null);

    function altToBrightness(elem) {
	const alt = (target == "sun" ? elem.alt : elem.sun_alt);
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
    function interpolateTransition(x1, y1, x2, y2, b1, b2) {
	

    };

    const fetchDataSeries = async () => {
	try {
	    const now = new Date();
	    const response = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj`,
		{target: target, lat: session.lat,
		 lon: session.lon, time: now, timespan: "day"});
	    // Outer segments is a list of pairs, first item in the pair
	    // being the brightness level 0-4 (day, civil, nautical
	    // and astronomical twilight and full night)
	    const outer_segments = [];
	    // Inner segments is a list of lists, this is just so that we
	    // can break the discontinuity at 0/360 azimuth
	    const inner_segments = [];
	    let outer_points = [];
	    let inner_points = [];
	    let prev_x = null;
	    let prev_y = null;
	    let prev_brightness = null;
	    let x = 0;
	    let y = 0;
	    let brightness = null;
	    for (const elem in response.data.series) {
		x = stageSize.get("azToPx")(response.data.series[elem].az);
		y = stageSize.get("altToPx")(response.data.series[elem].alt);
		brightness = altToBrightness(response.data.series[elem]);
		if (prev_x != null && prev_x > x) {
		    // Segment wrapped around the right side of the stage,
		    // break up the line into segments to avoid drawing a
		    // line back to left across the stage. 
		    inner_segments.push(inner_points);
		    inner_points = [];
		    outer_segments.push([brightness, outer_points]);
		    outer_points = [];
		}
		outer_points.push(x);
		outer_points.push(y);
		inner_points.push(x);
		inner_points.push(y);
		if (prev_brightness != null && prev_brightness != brightness) {
		    // The path crossed a brightness limit, break it into
		    // a separate segment marked with the brigness. XXX
		    // needs interpolation so that we can cut the segment
		    // at the exact point.
		    outer_segments.push([prev_brightness, outer_points]);
		    outer_points = [x, y];
		}
		prev_brightness = brightness;
		prev_x = x;
		prev_y = y;
	    };
	    inner_segments.push(inner_points);
	    outer_segments.push([brightness, outer_points]);
	    setRemoteProps({inner_segments: inner_segments,
			    outer_segments: outer_segments});
	} catch (error) {
	    console.error("/get-obj series fetch failed:", error); 
	}
    };

    if (remoteProps == null) {
	fetchDataSeries();
	return null;
    };

    const outerSegments = remoteProps.outer_segments.map(seg =>
	<Line points={seg[1]} strokeWidth={5} 
	      stroke={brightnessToColor[seg[0]]} tension={1}
	      shadowColor={brightnessToColor[seg[0]]} shadowBlur={10}>
	</Line>)

    const innerSegments = remoteProps.inner_segments.map(seg =>
	<Line points={seg} strokeWidth={2} 
	      stroke={target == "sun" ? "yellow" : "white"} tension={1}>
	</Line>)
	
    return (<Group>
		{outerSegments}
		{innerSegments}
	    </Group>);
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
       
    return (<Layer>
		<CoordGrid>
		</CoordGrid>
		<TargetPath target={session.target}>
		</TargetPath>
		<TargetPath target="sun">
		</TargetPath>
		<Target target={session.target}>
		</Target>
		<Target target="sun" fill="yellow">
		</Target>
	    </Layer>
	   )
};

export default ObsStage;
