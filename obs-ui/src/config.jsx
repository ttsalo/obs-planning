import { createContext, useContext } from 'react';
import {
    useQuery,
} from '@tanstack/react-query'
import axios from 'axios';

// Runtime configuration served by the Go backend's unauthenticated
// /config endpoint. Currently just the astro backend base URL.
export const RuntimeConfigContext = createContext({ astroUrl: null });

/* Fetches the runtime config once at startup and provides it to the
   whole app. Renders nothing until the fetch settles so no component
   can fire an astro call before the configured URL is known; on error
   the astro URL falls back like an empty one would. */
export function RuntimeConfigProvider({ children }) {
    const { data, isPending } = useQuery({
	queryKey: ['runtimeConfig'],
	queryFn: async () => (await axios.get('/config')).data,
	staleTime: Infinity,
	retry: 1,
    });
    if (isPending) return null;
    return (
	<RuntimeConfigContext value={{ astroUrl: data?.astro_url || null }}>
	    {children}
	</RuntimeConfigContext>
    );
}

/* Astro backend base URL, no trailing slash. Configured mode (Cloud
   Run): the https://...run.app URL from OBS_ASTRO_URL. Fallback
   (local, AWS): protocol-relative host on port 8081. */
export function useAstroBase() {
    const { astroUrl } = useContext(RuntimeConfigContext);
    return astroUrl ? astroUrl.replace(/\/+$/, '')
		    : `//${window.location.hostname}:8081`;
}
