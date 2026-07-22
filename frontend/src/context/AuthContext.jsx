import { createContext, useContext, useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=unauth, obj=auth

  useEffect(() => {
    const token = localStorage.getItem("panel_token") || sessionStorage.getItem("panel_token");
    if (!token) {
      setUser(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {
        localStorage.removeItem("panel_token");
        sessionStorage.removeItem("panel_token");
        setUser(false);
      });
  }, []);

  const login = async (username, password, remember = false) => {
    try {
      const { data } = await api.post("/auth/login", { username, password, remember });
      // Persist across restarts only when "remember me" is checked; otherwise session-only.
      (remember ? localStorage : sessionStorage).setItem("panel_token", data.access_token);
      setUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: apiError(e) };
    }
  };

  const logout = () => {
    localStorage.removeItem("panel_token");
    sessionStorage.removeItem("panel_token");
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
