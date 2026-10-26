import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const navigate = (to) => { window.location.hash = to; };
