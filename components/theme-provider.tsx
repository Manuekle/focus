"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = "focus-theme";
const SWITCH_MS = 560;
const SWITCH_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const SWITCH_BLUR = "10px";

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

  /**
   * Switch as one soft dissolve: the old theme blurs out while the new one
   * comes into focus, across the whole app at once. Every surface flips in
   * the same frame under the snapshot, so nothing lags behind on its own
   * colour transition; browsers without view transitions, and anyone who
   * asked for reduced motion, get the plain swap.
   */
  const toggleTheme = useCallback(() => {
    if (forcedTheme) return;
    const root = document.documentElement;
    const next: Theme = root.classList.contains("dark") ? "light" : "dark";
    const commit = () => {
      flushSync(() => setThemeState(next));
      applyTheme(next);
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition !== "function" || reduced) {
      commit();
      return;
    }

    root.classList.add("theme-switching");
    const transition = document.startViewTransition(commit);
    const timing = { duration: SWITCH_MS, easing: SWITCH_EASE, fill: "both" } as const;
    transition.ready
      .then(() => {
        root.animate(
          { opacity: [1, 0], filter: ["blur(0px)", `blur(${SWITCH_BLUR})`] },
          { ...timing, pseudoElement: "::view-transition-old(root)" },
        );
        root.animate(
          { opacity: [0, 1], filter: [`blur(${SWITCH_BLUR})`, "blur(0px)"] },
          { ...timing, pseudoElement: "::view-transition-new(root)" },
        );
      })
      // A transition skipped by another (a route change mid-switch) still
      // commits; only the dissolve is lost.
      .catch(() => {});
    void transition.finished
      .finally(() => root.classList.remove("theme-switching"))
      .catch(() => {});
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
