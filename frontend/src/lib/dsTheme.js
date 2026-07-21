import { useCallback, useEffect, useState } from "react";

const KEY = "nexus-ds-theme";

function applyThemeClass(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("theme-light", theme === "light");
}

export function useDsTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem(KEY) || "dark";
  });

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY) setTheme(e.newValue || "dark"); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      applyThemeClass(next);
      return next;
    });
  }, []);

  return { theme, toggle, isLight: theme === "light" };
}
