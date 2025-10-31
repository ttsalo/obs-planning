import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Button, Flex, Layout, ConfigProvider, Typography, Input, InputNumber,
	 Space, Modal, Row, Col } from 'antd';
import { Stage, Layer, Rect, Circle, Text } from 'react-konva';
import axios from 'axios';
import ObsStage from './obs.jsx';
import { SessionContext, updateSession } from './session.jsx'

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

    const [isModalOpen, setIsModalOpen] = useState(false);
    const showModal = () => {
	setIsModalOpen(true);
    };
    
    const SetDialog = () => {
	const handleOk = () => {
	    setIsModalOpen(false);
	    updateSession(session, setSession, {"lat": lat, "lon": lon});
	};
	const handleCancel = () => {
	    setIsModalOpen(false);
	};
	const [lat, setLat] = useState(session?.lat);
	const [lon, setLon] = useState(session?.lon);

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
			   <Col className="gutter-row" span={12}>
			       <Typography.Text>Latitude</Typography.Text>
			   </Col>
			   <Col className="gutter-row" span={12}>
			       <Typography.Text>Longitude</Typography.Text>
			   </Col>
		       </Row>
		       <Row>
			   <Col className="gutter-row" span={12}>
			       <InputNumber min={-90} max={90} value={lat}
					    onChange={setLat}>
			       </InputNumber>
			   </Col>
			   <Col className="gutter-row" span={12}>
			       <InputNumber min={-180} max={180} value={lon}
					    onChange={setLon}>
			       </InputNumber>
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
