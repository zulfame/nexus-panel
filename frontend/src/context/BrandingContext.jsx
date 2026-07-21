import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const DEFAULTS = { system_name: "NEXUS.PANEL", tagline: "deploy control", logo: "", favicon: "", primary_color: "#3b82f6" };
const BrandingContext = createContext({ branding: DEFAULTS, refresh: () => {} });

function applyFavicon(href) {
  if (!href) return;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

function applyPrimaryColor(color) {
  const c = (color || "").trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return;
  document.documentElement.style.setProperty("--ds-primary", c);
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/branding");
      setBranding({ ...DEFAULTS, ...data });
    } catch (e) {
      /* keep defaults */
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    document.title = branding.system_name || "Nexus Panel";
    if (branding.favicon) applyFavicon(branding.favicon);
    applyPrimaryColor(branding.primary_color);
  }, [branding]);

  return (
    <BrandingContext.Provider value={{ branding, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);

/** Renders a name splitting on "." with a primary-color accent dot, matching the panel style. */
export function BrandName({ name }) {
  const parts = (name || "NEXUS.PANEL").split(".");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-[var(--ds-primary)]">.</span>}
          {p}
        </span>
      ))}
    </>
  );
}
