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
import { RuntimeConfigProvider } from './config.jsx'

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
    <StrictMode>
	<QueryClientProvider client={queryClient}>
	    <RuntimeConfigProvider>
		<LoginPage>
		    <App />
		</LoginPage>
	    </RuntimeConfigProvider>
	</QueryClientProvider>
    </StrictMode>,
)
