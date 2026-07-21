import { useCallback, useEffect, useState } from "react";

const KEY = "nexus-ds-theme";

export function useDsTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem(KEY) || "dark";
  });

  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY) setTheme(e.newValue || "dark"); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);

  // class applied on the .ds-root wrapper
  const dsClass = theme === "light" ? "ds-root ds-light" : "ds-root";
  return { theme, toggle, dsClass, isLight: theme === "light" };
}
