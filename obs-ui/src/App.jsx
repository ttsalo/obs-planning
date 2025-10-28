import React from 'react';
import { Layout } from 'antd';

const App = () => {
    return <Layout style={{ minHeight: '100vh', minWidth: '100vw' }}>
	       <Layout.Header style={{ padding: 0 }}>header</Layout.Header>
	       <Layout>
		   <Layout.Content>
		       <div style={{padding: 24, minHeight: '100%',
				    minWidth: '100%',}}>
			   <h1>Full Screen Content</h1>
		       </div>
		   </Layout.Content>
	       </Layout>
	       <Layout.Footer style={{ padding: 0 }}>footer</Layout.Footer>
	   </Layout>
};

export default App;
