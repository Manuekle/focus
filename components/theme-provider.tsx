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

export function ThemeProvider({ children, forcedTheme }: {
  readonly children: ReactNode;
  readonly forcedTheme?: Theme;
}) {
  // The server cannot know the visitor's theme; the pre-paint script in the
  // root layout puts it on <html>, and the effect below adopts it.
  const [theme, setThemeState] = useState<Theme>(forcedTheme ?? "dark");

  useEffect(() => {
    const root = document.documentElement;
    const actual: Theme = forcedTheme ?? (root.classList.contains("dark") ? "dark" : "light");
    if (forcedTheme) {
      root.classList.toggle("dark", forcedTheme === "dark");
      root.classList.toggle("light", forcedTheme === "light");
      root.style.colorScheme = forcedTheme;
    }
    setThemeState((prev) => (prev === actual ? prev : actual));
  }, [forcedTheme]);

  // Enable theme transitions only after the initial server theme has painted.
  useEffect(() => {
    document.documentElement.classList.add("theme-ready");
    return () => document.documentElement.classList.remove("theme-ready");
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    // Keep native controls and scrollbars in sync with the CSS theme, even
    // when the consumer renders an inline color-scheme on the root element.
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      if (forcedTheme) return;
      setThemeState(next);
      applyTheme(next);
    },
    [applyTheme, forcedTheme],
  );

  const toggleTheme = useCallback(() => {
    if (forcedTheme) return;
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, [applyTheme, forcedTheme]);

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
