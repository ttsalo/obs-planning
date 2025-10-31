import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Circle, Text } from 'react-konva';
import { SessionContext } from './session.jsx'

const ObsStage = () => {
    const session = useContext(SessionContext)
    return (
	<Layer>
	    <Rect
		x={20}
		y={50}
		width={100}
		height={100}
		fill="red"
		shadowBlur={10}
		draggable
	    />
	    <Circle
		x={200}
		y={100}
		radius={50}
		fill="green"
		draggable
	    />
	</Layer>
    )
};

export default ObsStage;
