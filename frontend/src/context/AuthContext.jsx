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

  const login = async (username, password, remember = false, totp = null) => {
    try {
      const payload = { username, password, remember };
      if (totp) payload.totp = totp;
      const { data } = await api.post("/auth/login", payload);
      if (data.twofa_required) {
        return { ok: false, twofaRequired: true };
      }
      // Persist across restarts only when "remember me" is checked; otherwise session-only.
      (remember ? localStorage : sessionStorage).setItem("panel_token", data.access_token);
      setUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: apiError(e) };
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // best-effort server-side revoke; clear locally regardless
    }
    localStorage.removeItem("panel_token");
    sessionStorage.removeItem("panel_token");
    setUser(false);
  };

  const logoutAll = async () => {
    try {
      await api.post("/auth/logout-all");
    } catch (e) {
      // ignore
    }
    localStorage.removeItem("panel_token");
    sessionStorage.removeItem("panel_token");
    setUser(false);
  };

  const ROLE_RANK = { viewer: 0, developer: 1, admin: 2, owner: 3 };
  const role = user && typeof user === "object" ? (user.role || "viewer") : null;
  const hasRole = (min) => role != null && (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[min] ?? 0);

  return (
    <AuthContext.Provider value={{ user, role, hasRole, login, logout, logoutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
