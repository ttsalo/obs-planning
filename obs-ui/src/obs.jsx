import { createContext, useContext, useState, useEffect, useRef } from 'react';
import Konva from 'konva';
import { Stage, Layer, Rect, Circle, Text, Line } from 'react-konva';
import { SessionContext, StageContext } from './session.jsx'

function azToPx(az, stageSize) {
    return (az - stageSize.get("minAz")) * stageSize.get("zoom");
}

function altToPx(alt, stageSize) {
    return (stageSize.get("maxAlt") - alt) * stageSize.get("zoom");
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
	// Azimuth lines (vertical)
	for (let i = 0; i < 360; i = i + 10) {
	    const line = new Konva.Line(
		{points: [azToPx(i, stageSize), altToPx(-90, stageSize),
			  azToPx(i, stageSize), altToPx(90, stageSize)],
		 stroke: "#808080", strokeWidth: 1});
	    l.add(line);
	    const label = new Konva.Label({
		x: azToPx(i, stageSize), 
		y: altToPx(stageSize.get("maxAlt"), stageSize)});
	    label.add(
		new Konva.Tag({
		    pointerDirection: 'left',
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
	    label.setAttrs({y: label.getAttr('y') + label.height()});
	    l.add(label);
	}
	
	// Altitude lines (horizontal)
	for (let i = -90; i <= 90; i = i + 10) {
	    const line = new Konva.Line(
		{points: [azToPx(0, stageSize), altToPx(i, stageSize),
			  azToPx(360, stageSize), altToPx(i, stageSize)],
		 stroke: "#808080", strokeWidth: 1});
	    l.add(line);
	    const label = new Konva.Label({
		x: azToPx(stageSize.get("minAz"), stageSize),
		y: altToPx(i, stageSize)});
	    label.add(
		new Konva.Tag({
		    pointerDirection: 'up',
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
	    label.setAttrs({x: label.getAttr('x') + label.width()});
	    l.add(label);
	}
    }
    
    return (
	<Layer ref={coordsLayer}>
	</Layer>
    )
};

export default ObsStage;
