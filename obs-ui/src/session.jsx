import { createContext, useContext } from 'react';
import axios from 'axios';

/* The SessionContext component wraps all the other UI components so
   that the session data is available for all of them. The session is
   also updated to the server, which in turn updates the (opaque to
   UI) session cookie. Optionally the session could be stored
   persistently in the server.

   Session properties:
   lat: <Number> User latitude
   lon: <Number> User longitude
*/
export const SessionContext = createContext();

/* Update one or more items in the session. We'll pass the updated
   values to the server, which will update the cookie and return the
   session data with updated values back, which are then set to the
   client side session here. This allows server to validate the data
   and optionally write it to a more persistent storage than the cookie.
 */
export function updateSession(session, setSession, updated) {
    const updateData = async () => {
	try {
	    const response = await axios.post('/update-session', updated);
	    setSession(response.data);
	} catch (error) {
	    console.error("/update-session fetch failed:", error); 
	}
    };
    
    updateData();
};

