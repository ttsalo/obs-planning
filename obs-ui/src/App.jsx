import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Button, Flex, Layout, ConfigProvider, Typography, Input, InputNumber,
	 Space, Modal, Row, Col, Select } from 'antd';
import { Stage, Layer, Rect, Circle, Text } from 'react-konva';
import axios from 'axios';
import ObsStage from './obs.jsx';
import { SessionContext, StageContext, updateSession } from './session.jsx'

const App = () => {
    // Global session context 
    const [session, setSession] = useState(null);
    
    useEffect(() => {
	const fetchData = async () => {
	    try {
		const response = await axios.get('/get-session'); 
		setSession(response.data);
	    } catch (error) {
		console.error("/get-session fetch failed:", error); 
	    }
	};
	if (session == null)
	    fetchData();
    });
    
    // Define initial virtual size for our scene
    const sceneWidth = 1000;
    const sceneHeight = 500;

    // Calculate the alt-az limits of the visible area. Set to the full
    // sky view for now.
    function calcLimits(stageMap) {
	stageMap.set("minAz", 0);
	stageMap.set("maxAz", 360);
	stageMap.set("minAlt", -90);
	stageMap.set("maxAlt", 90);
    };

    // State to track current scale and dimensions
    var stageMap = new Map();
    stageMap.set("width", sceneWidth);
    stageMap.set("height", sceneHeight);
    stageMap.set("scale", 1.0);
    // zoom is pixels per degree and used when converting the alt-az
    // coordinates to layer coordinates. The user-visible zooming applied
    // with the Stage scale prop. (This might still change in some use cases)
    stageMap.set("zoom", 10.0);
    // Make the moon (and sun) relatively bigger
    stageMap.set("moonzoom", 10.0);
    calcLimits(stageMap);
    
    const [stageSize, setStageSize] = useState(stageMap)
    
    // Reference to parent container
    const containerRef = useRef(null);
    
    // Function to handle resize
    const updateSize = () => {
	if (!containerRef.current) return;
	
	// Get container width
	const containerWidth = containerRef.current.offsetWidth;

	// Layer presentation area width in degrees
	const layerWidth = stageMap.get("maxAz") - stageMap.get("minAz");
	
	// Calculate scale to show the full layer on the visible area
	//const scale = containerWidth / layerWidth;
	const scale = containerWidth / sceneWidth;
	
	// Update state with new dimensions
	stageMap = stageSize;
	stageMap.set("width", sceneWidth * scale);
	stageMap.set("height", sceneHeight * scale);
	stageMap.set("scale", scale);
	// Set the zoom level (pixels per degree) so that the presentation
	// area fits on the screen exactly.
	stageMap.set("zoom", sceneWidth / layerWidth);
	setStageSize(stageMap);
    };
  
    // Update on mount and when window resizes
    useEffect(() => {
	updateSize();
	window.addEventListener('resize', updateSize);
    
	return () => {
	    window.removeEventListener('resize', updateSize);
	};
    }, []);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const showModal = () => {
	setIsModalOpen(true);
    };
    
    const SetDialog = () => {
	const handleOk = () => {
	    setIsModalOpen(false);
	    updateSession(session, setSession, {"lat": lat, "lon": lon,
						"target": target});
	};
	const handleCancel = () => {
	    setIsModalOpen(false);
	};
	const [lat, setLat] = useState(session?.lat);
	const [lon, setLon] = useState(session?.lon);
	const [target, setTarget] = useState(session?.target);

	return <ConfigProvider
		   theme={{token:
			   {colorText: 'black'}}}>
		   <Modal
		       title="Set observation parameters"
		       closable={{ 'aria-label':
				   'Set' }}
		       open={isModalOpen}
		       onOk={handleOk}
		       onCancel={handleCancel}>
		       <Row>
			   <Col className="gutter-row" span={8}>
			       <Typography.Text>Latitude</Typography.Text>
			   </Col>
			   <Col className="gutter-row" span={8}>
			       <Typography.Text>Longitude</Typography.Text>
			   </Col>
			   <Col className="gutter-row" span={8}>
			       <Typography.Text>Target(s)</Typography.Text>
			   </Col>
		       </Row>
		       <Row>
			   <Col className="gutter-row" span={8}>
			       <InputNumber min={-90} max={90} value={lat}
					    onChange={setLat}>
			       </InputNumber>
			   </Col>
			   <Col className="gutter-row" span={8}>
			       <InputNumber min={-180} max={180} value={lon}
					    onChange={setLon}>
			       </InputNumber>
			   </Col>
			   <Col className="gutter-row" span={8}>
			       <Select options={[{ value: 'Moon',
						   label: <span>Moon</span> }]}
				       onChange={setTarget}>
			       </Select>
			   </Col>
		       </Row>
		   </Modal>
	       </ConfigProvider>
    };

    return <SessionContext value={session}>
	       <Layout style={{ minHeight: '100vh', minWidth: '100vw' }}>
		   <Layout.Header>
		       <ConfigProvider theme={{token:
					       {colorText: '#e0e0e0'}}}>
			   <Flex justify="space-between" align="center">
			       <Typography.Title level={3}>
				   Observations Planner
			       </Typography.Title>
			       <Space>
				   <Space.Compact>
				       <Typography.Text strong={true}>
					   Lat:
				       </Typography.Text>
				       <Typography.Text>
					   {session?.lat}
				       </Typography.Text>
				   </Space.Compact>
				   <Space.Compact>
				       <Typography.Text strong={true}>
					   Lon:
				       </Typography.Text>
				       <Typography.Text>
					   {session?.lon}
				       </Typography.Text>
				   </Space.Compact>
				   <Space.Compact>
				       <Typography.Text strong={true}>
					   Target:
				       </Typography.Text>
				       <Typography.Text>
					   {session?.target}
				       </Typography.Text>
				   </Space.Compact>
				   <Button type="primary"
					   onClick={showModal}>
				       Set
				   </Button>
				   <SetDialog>
				   </SetDialog>
			       </Space>
			   </Flex>
		       </ConfigProvider>
		   </Layout.Header>
		   
		   <Layout>
		       <Layout.Content>
			   <div ref={containerRef}
				style={{padding: 0, minHeight: '100%',
					minWidth: '100%',}}>
			       <Stage
				   width={stageSize.get("width")} 
				   height={stageSize.get("height")}
				   scaleX={stageSize.get("scale")}
				   scaleY={stageSize.get("scale")}
			           draggable>
				   <StageContext value={stageSize}>
				       <ObsStage>
				       </ObsStage>
				   </StageContext>
			       </Stage>
			   </div>
		       </Layout.Content>
		   </Layout>
		   
		   <Layout.Footer style={{ padding: 0 }}>
		       <Flex justify="center" align="middle"
			     style={{ height: '100%' }}>
			   © Tomi T. Salo 2025
		       </Flex>
		   </Layout.Footer>
	       </Layout>
	   </SessionContext>
};

export default App;
