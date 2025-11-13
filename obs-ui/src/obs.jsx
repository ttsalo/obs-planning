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
			    * stageSize.get("moonzoom")});
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

    const fetchDataSeries = async () => {
	try {
	    const now = new Date();
	    const response = await axios.post(
		`//${window.location.hostname}:8081/api/get-obj`,
		{target: target, lat: session.lat,
		 lon: session.lon, time: now, timespan: "day"});
	    const points = [];
	    let x = 0;
	    let y = 0;
	    for (const elem in response.data.series) {
		x = stageSize.get("azToPx")(response.data.series[elem].az);
		y = stageSize.get("altToPx")(response.data.series[elem].alt);
		points.push(x);
		points.push(y);
	    };
	    setRemoteProps({points: points});
	} catch (error) {
	    console.error("/get-obj series fetch failed:", error); 
	}
    };

    if (remoteProps == null) {
	fetchDataSeries();
	return null;
    };

    return (<Group>
		<Line points={remoteProps.points} strokeWidth={5} 
		      stroke="black" tension={1}
		      shadowColor="black" shadowBlur={10}>
		</Line>
		<Line points={remoteProps.points} strokeWidth={2} 
		      stroke={target == "sun" ? "yellow" : "white"} tension={1}>
		</Line>
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
