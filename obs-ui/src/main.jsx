import { StrictMode, createContext, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import LoginPage from './login.jsx'

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
    <StrictMode>
	<QueryClientProvider client={queryClient}>
	    <LoginPage>
		<App />
	    </LoginPage>
	</QueryClientProvider>
    </StrictMode>,
)
