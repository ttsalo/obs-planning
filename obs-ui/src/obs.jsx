import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line, Group } from 'react-konva';
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

    return (<Line points={remoteProps.points} stroke="black" tension={1}>
	    </Line>);
};

const ObsStage = () => {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);
    const coordsLayer = useRef(null);
    const objLayer = useRef(null);
    stageSize.forEach((value, key) => {
	console.log(`${key} = ${value}`);
    });
    if (session == null) {
	console.log("session null, skip rendering contents");
	return null;
    }
    const azToPx = stageSize.get("azToPx");
    const altToPx = stageSize.get("altToPx");

    /* The component code is evaluated twice when first showing the UI,
       first with a temporary stage size and without the contained layer
       having been created, so we'll skip creating any contents at that
       point. After that there will be a initial resize event in the
       app and this will be called again for a re-render, at which point
       we can populate the layer. */
    if (coordsLayer.current) {
	// Draw the coordinate grid
	const l = coordsLayer.current;
	l.destroyChildren();
	const step = 30; // Adjust based on zoom level when implemented
	// Azimuth lines (vertical)
	for (let i = stageSize.get("minAz") + step;
	     i < stageSize.get("maxAz"); i = i + step) {
		const line = new Konva.Line(
		{points: [azToPx(i, stageSize),
			  altToPx(stageSize.get("minAlt"), stageSize),
			  azToPx(i, stageSize),
			  altToPx(stageSize.get("maxAlt"), stageSize)],
		 stroke: ((i == 90 || i == 180 || i == 270) ?
			  "#000000" : "#888888"),
		 strokeWidth: ((i == 90 || i == 180 || i == 270) ? 1 : 0.5)});
	    l.add(line);
	    const label = new Konva.Label({
		x: azToPx(i, stageSize), 
		y: altToPx(stageSize.get("maxAlt"), stageSize)});
	    label.add(
		new Konva.Tag({
		    pointerDirection: 'down',
		    pointerWidth: 6,
		    pointerHeight: 6,
		    lineJoin: 'round',
		    fill: 'white',
		    stroke: "#808080",
		    strokeWidth: 1
		})
	    );
	    label.add(new Konva.Text({text: `${i}°`, padding: 2,
				       fill: "black"}));
	    label.setAttrs({y: label.getAttr('y') + label.height() * 2});
	    l.add(label);
	}
	
	// Altitude lines (horizontal)
	for (let i = stageSize.get("minAlt") + step;
	     i < stageSize.get("maxAlt"); i = i + step) {

	    const line = new Konva.Line(
		{points: [azToPx(stageSize.get("minAz"), stageSize),
			  altToPx(i, stageSize),
			  azToPx(stageSize.get("maxAz"), stageSize),
			  altToPx(i, stageSize)],
		 stroke: ((i == 0) ? "#000000" : "#888888"),
		 strokeWidth: ((i == 0) ? 1 : 0.5)});
	    l.add(line);
	    const label = new Konva.Label({
		x: azToPx(stageSize.get("minAz"), stageSize),
		y: altToPx(i, stageSize)});
	    label.add(
		new Konva.Tag({
		    pointerDirection: 'right',
		    pointerWidth: 6,
		    pointerHeight: 6,
		    lineJoin: 'round',
		    fill: 'white',
		    stroke: "#808080",
		    strokeWidth: 1
		})
	    );
	    label.add(new Konva.Text({text: `${i}°`, padding: 2,
				       fill: "black"}));
	    label.setAttrs({x: label.getAttr('x') + label.width() * 2});
	    l.add(label);
	}
    }
       
    return (<Layer ref={coordsLayer}>
		<Target target={session.target}>
		</Target>
		<TargetPath target={session.target}>
		</TargetPath>
		<Target target="sun" fill="yellow">
		</Target>
		<TargetPath target="sun">
		</TargetPath>
	    </Layer>
	   )
};

export default ObsStage;
