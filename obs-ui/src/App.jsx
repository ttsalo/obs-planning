import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Button, Flex, Layout, ConfigProvider, Typography,
	 Space, DatePicker, TimePicker } from 'antd';
import { Stage, Layer, Rect, Circle, Text } from 'react-konva';
import dayjs from 'dayjs';
import axios from 'axios';
import ObsStage from './obs.jsx';
import { SessionContext, StageContext } from './session.jsx'
import PositionsDialog from './positions.jsx'
import SearchesDialog, { useSearches } from './searches.jsx'
import { useAstroBase } from './config.jsx'

const App = () => {
    // Global session context. This is a bit special state since it's
    // set by reading or writing it to server side for persistence.
    const [session, setSession] = useState(null);

    const astroBase = useAstroBase();

    useEffect(() => {
	const fetchData = async () => {
	    try {
		const response = await axios.get('/api/get-session'); 
		setSession(response.data);
	    } catch (error) {
		console.error("/api/get-session fetch failed:", error); 
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
    // Make the planets relatively bigger
    stageMap.set("planetzoom", 200.0);
    // Date and time to calculate. If both are null, tracks current time.
    stageMap.set("date", null);
    stageMap.set("time", null);
    // Initial current time
    stageMap.set("renderts", new Date());
    calcLimits(stageMap);
    
    const [stageSize, setStageSize] = useState(stageMap)

    // Update the render time every minute, triggers re-rendering
    // the observation canvas
    useEffect(() => {
	const intervalId = setInterval(() => {
	    const newStageMap = new Map(stageSize);
	    newStageMap.set("renderts", new Date());
	    setStageSize(newStageMap);
	}, 60 * 1000);
	return () => clearInterval(intervalId);
    }, []);
    
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
	stageMap.set("azToPx", (az) => { return (az - stageMap.get("minAz")) *
					 stageMap.get("zoom") });
	stageMap.set("altToPx", (alt) => {
	    return (stageMap.get("maxAlt") - alt) * stageSize.get("zoom")});
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

    const [isSearchesOpen, setIsSearchesOpen] = useState(false);

    // The session names the selected position; until it has loaded
    // there's nothing to name yet.
    const positionLabel = session == null ? "Loading..."
	  : session.position || "(no position)";

    // Likewise for the search, except that the name the session holds
    // may resolve to nothing once the user has deleted every search
    // (ObsStage's fallback only helps while one is left).
    const searchQ = useSearches(session);
    const searchLabel = session == null ? "Loading..."
	  : (searchQ.data != null &&
	     !searchQ.data.find((s) => s.name == session.search))
	  ? "(no search)" : session.search || "(no search)";


    const onTimeChange = (time, timeString) => {
	const newStageMap = new Map(stageSize);
	newStageMap.set("time", time);
	setStageSize(newStageMap);
	console.log(time, timeString);
    };

    const onDateChange = (date, dateString) => {
	const newStageMap = new Map(stageSize);
	newStageMap.set("date", date);
	setStageSize(newStageMap);
	console.log(date, dateString);
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
				   <ConfigProvider theme={{token:
							   {colorBgContainer:
							    '#2f325e',
							    colorBgElevated:
							    '#4f527e',
							    cellActiveWithRangeBg:
							    '#6f729e',
							    cellHoverWithRangeBg:
							    '#6f729e',
							    colorTextQuaternary:
							    '#e0e0e0',
							    colorIcon:
							    '#e0e0e0'
							   }}}>
				       <Space.Compact>
					   <DatePicker
					       onChange={onDateChange} />
				       </Space.Compact>
				       <Space.Compact>
					   <TimePicker
					       onChange={onTimeChange} />
				       </Space.Compact>
				   </ConfigProvider>
				   <Button type="text"
					   onClick={showModal}>
				       <Typography.Text strong={true}>
					   Position:
				       </Typography.Text>
				       <Typography.Text
					   ellipsis={true}
					   style={{display: 'inline-block',
						   verticalAlign: 'bottom',
						   maxWidth: 200}}>
					   {positionLabel}
				       </Typography.Text>
				   </Button>
				   <PositionsDialog
				       open={isModalOpen}
				       onClose={() => setIsModalOpen(false)}
				       session={session}
				       setSession={setSession}>
				   </PositionsDialog>
				   <Button type="text"
					   onClick={() => setIsSearchesOpen(true)}>
				       <Typography.Text strong={true}>
					   Search:
				       </Typography.Text>
				       <Typography.Text
					   ellipsis={true}
					   style={{display: 'inline-block',
						   verticalAlign: 'bottom',
						   maxWidth: 200}}>
					   {searchLabel}
				       </Typography.Text>
				   </Button>
				   <SearchesDialog
				       open={isSearchesOpen}
				       onClose={() => setIsSearchesOpen(false)}
				       session={session}
				       setSession={setSession}
				       shownDate={stageSize.get("date")}>
				   </SearchesDialog>
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
				       <ObsStage setSession={setSession}>
				       </ObsStage>
				   </StageContext>
			       </Stage>
			   </div>
		       </Layout.Content>
		   </Layout>
		   
		   <Layout.Footer style={{ padding: 0 }}>
		       <Flex justify="center" align="middle"
			     style={{ height: '100%' }}>
			   <Space>
			   © Tomi T. Salo 2025-2026
			   <a href={`${astroBase}/apidocs/`}>
			   Apidoc (astro)</a>
			   <a href="/health">
			   Backend health</a>
			   <a href={`${astroBase}/health`}>
			   Astrobackend health</a>
			   </Space>
		       </Flex>
		   </Layout.Footer>
	       </Layout>
	   </SessionContext>
};

export default App;
