"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/utils";

const PAGES = [
  { href: "/privacy", label: "Privacidad" },
  { href: "/data-deletion", label: "Eliminar mis datos" },
] as const;

/** Switches between the legal pages, styled like the studios' mode switch. */
export function LegalNav() {
  const here = usePathname();
  return (
    <nav aria-label="Información de Focus" className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
      {PAGES.map((page) => {
        const active = here === page.href;
        return (
          <Link
            key={page.href}
            href={page.href}
            aria-current={active ? "page" : undefined}
            data-cuelume-select=""
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
              active ? "bg-card text-foreground shadow-[var(--shadow-xs,0_1px_2px_rgb(0_0_0/0.08))]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}
