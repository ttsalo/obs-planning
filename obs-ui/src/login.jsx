import { useState } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Flex, Form, Input } from 'antd';

const login_api = axios.create({});

function LoginPage({children}) {
    const queryClient = useQueryClient();
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loginData, setLoginData] = useState(null);
    if (loginData == null) {
	const { isPending, error, data } = useQuery({
	    queryKey: ["loginpage"],
	    queryFn: async () => {
		const response = await login_api.get('/api/get-session');
		return response.data;
	    },
	    retry: false
	})
	if (isPending) {
	    return ("Loading session...");
	};
	if (!error) {
	    setIsLoggedIn(true);
	    setLoginData(null);
	};
    } else {
	const { isPending, error, data } = useQuery({
	    queryKey: ["loginpageLogin"],
	    queryFn: async () => {
		const response = await login_api.post('/login',
						      loginData);
		return response.data;
	    },
	    retry: false
	})
	if (isPending) {
	    return ("Logging in...");
	};
	if (!error) {
	    setIsLoggedIn(true);
	    setLoginData(null);
	    console.log(`Got token: ${data.token}`);
	    axios.defaults.headers.common['Authorization'] =
		`Bearer ${data.token}`;
	};
    };
    if (isLoggedIn) {
	return (<>{children}</>)
    };
    const onFinish = values => {
	setLoginData(values);
	queryClient.invalidateQueries({ queryKey: ['loginpage'] })
	queryClient.invalidateQueries({ queryKey: ['loginpageLogin'] })
    };
    const onFinishFailed = errorInfo => {
	console.log('Failed to send login form:', errorInfo);
    };
    return (
	<Flex justify="center" align="center" style={{ height: '100vh',
						       width: '100vw' }}>
	    <Form name="basic" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }}
		  style={{ maxWidth: 600 }} initialValues={{ remember: true }}
		  onFinish={onFinish} onFinishFailed={onFinishFailed}
		  autoComplete="off" padding={60}>
		<Form.Item
		    label="Username"
		    name="username"
		    rules={[{ required: true,
			      message: 'Please input your username!' }]}>
		    <Input />
		</Form.Item>
		
		<Form.Item
		    label="Password"
		    name="password"
		    rules={[{ required: true,
			      message: 'Please input your password!' }]}>
		    <Input.Password />
		</Form.Item>

		<Form.Item name="remember" valuePropName="checked"
			   label={null}>
		    <Checkbox>Remember me</Checkbox>
		</Form.Item>

		<Form.Item label={null}>
		    <Button type="primary" htmlType="submit">
			Submit
		    </Button>
		</Form.Item>
	    </Form>
	</Flex>);
};

export default LoginPage;
