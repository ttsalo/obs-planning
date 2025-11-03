import { createContext, useContext, useState, useEffect, useRef } from 'react';
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'

function azToPx(az, stageSize) {
    return (az - stageSize.get("minAz")) * stageSize.get("zoom");
}

function altToPx(alt, stageSize) {
    return (alt - stageSize.get("minAlt")) * stageSize.get("zoom");
}

const ObsStage = () => {
    const session = useContext(SessionContext);
    const stageSize = useContext(StageContext);
    const coordsLayer = useRef(null);
    stageSize.forEach((value, key) => {
	console.log(`${key} = ${value}`);
    });
    
    if (coordsLayer.current) {
	// Draw the coordinate grid
	const l = coordsLayer.current;
	l.destroyChildren();
	for (let i = 0; i < 360; i = i + 10) {
	    const line = new Konva.Line(
		{points: [azToPx(i, stageSize), altToPx(-90, stageSize),
			  azToPx(i, stageSize), altToPx(90, stageSize)],
		 stroke: "#808080", strokeWidth: 1});
	    l.add(line);
	}
	for (let i = -90; i <= 90; i = i + 10) {
	    const line = new Konva.Line(
		{points: [azToPx(0, stageSize), altToPx(i, stageSize),
			  azToPx(360, stageSize), altToPx(i, stageSize)],
		 stroke: "#808080", strokeWidth: 1});
	    l.add(line);
	}
    }
    
    return (
	<Layer ref={coordsLayer}>
	</Layer>
    )
};

export default ObsStage;
