import { useState, useEffect, useRef } from 'react';
import { Layout } from 'antd';
import { Stage, Layer, Rect, Circle, Text } from 'react-konva'


const ObsStage = () => {
    return (
	<Layer>
	    <Text text="Try to drag shapes" fontSize={15} />
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

const App = () => {
    // Define virtual size for our scene
    const sceneWidth = 1000;
    const sceneHeight = 500;
    
    // State to track current scale and dimensions
    const [stageSize, setStageSize] = useState({
	width: sceneWidth,
	height: sceneHeight,
	scale: 1
    });
    
    // Reference to parent container
    const containerRef = useRef(null);
    
    // Function to handle resize
    const updateSize = () => {
	if (!containerRef.current) return;
	
	// Get container width
	const containerWidth = containerRef.current.offsetWidth;
	
	// Calculate scale
	const scale = containerWidth / sceneWidth;
	
	// Update state with new dimensions
	setStageSize({
	    width: sceneWidth * scale,
	    height: sceneHeight * scale,
	    scale: scale
	});
    };
  
    // Update on mount and when window resizes
    useEffect(() => {
	updateSize();
	window.addEventListener('resize', updateSize);
    
	return () => {
	    window.removeEventListener('resize', updateSize);
	};
    }, []);

    return <Layout style={{ minHeight: '100vh', minWidth: '100vw' }}>
	       <Layout.Header style={{ padding: 0 }}>header</Layout.Header>
	       <Layout>
		   <Layout.Content>
		       <div ref={containerRef}
			    style={{padding: 0, minHeight: '100%',
				    minWidth: '100%',}}>
			   <Stage
			       width={stageSize.width} 
			       height={stageSize.height}
			       scaleX={stageSize.scale}
			       scaleY={stageSize.scale}>
			       <ObsStage>
			       </ObsStage>
			   </Stage>
		       </div>
		   </Layout.Content>
	       </Layout>
	       <Layout.Footer style={{ padding: 0 }}>footer</Layout.Footer>
	   </Layout>
};

export default App;
