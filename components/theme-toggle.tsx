"use client";

import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "./icons/icon";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

const subscribe = () => () => {};

/** Header control for the light/dark preference. Renders after mount so the icon matches the theme the pre-paint script chose. */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <span aria-hidden className="size-8 shrink-0" />;
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button size="icon-sm" variant="ghost" className={className} onClick={toggleTheme} aria-label={`Switch to ${next} mode`}>
      <HugeiconsIcon icon={theme === "dark" ? Sun03Icon : Moon02Icon} size={16} strokeWidth={1.75} />
    </Button>
  );
}
