"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = "focus-theme";

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  // Always start as "light" so server HTML and the first client render match
  // (hydration-safe). The inline script in layout.tsx has already set the
  // correct `dark` class on <html> before paint, so there is no white flash —
  // the CSS is already dark. We sync the React state to the DOM after mount.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const actual: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setThemeState((prev) => (prev === actual ? prev : actual));
  }, []);

  // After mount, enable smooth theme transitions. Before this, transitions
  // are disabled so the initial theme set by the inline script doesn't
  // animate (which causes a visible light→dark flash on load).
  useEffect(() => {
    document.documentElement.classList.add("theme-ready");
    return () => document.documentElement.classList.remove("theme-ready");
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    // The inline script in layout.tsx writes `color-scheme` as an INLINE
    // style, which outranks the `:root` / `:root.dark` rules in globals.css
    // forever. Toggling only the class therefore left the UA-painted parts —
    // scrollbars, form controls, the overscroll canvas — on the theme the
    // page loaded with until a refresh. Rewrite the same inline property.
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      applyTheme(next);
    },
    [applyTheme],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
