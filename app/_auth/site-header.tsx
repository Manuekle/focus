"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import shell from "../editor/studio.module.css";
import { AccountButton } from "./account-button";
import { useSession } from "./session-client";

/**
 * The studios' header for pages outside a studio (privacy, data deletion,
 * settings): the same brand, sound and theme toggles and account menu, with
 * the page's own name where a studio shows its mode.
 */
export function SiteHeader({ label, children }: { readonly label: string; readonly children?: ReactNode }) {
  const { session } = useSession();
  const here = usePathname() ?? "/";
  return (
    <header className={shell.header}>
      <div className={shell.headerStart}>
        <Link href="/" className={shell.brand} aria-label="Focus — Home">
          <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
          <span>
            focus<span className={shell.brandDot}>.</span>
          </span>
        </Link>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{label}</span>
      </div>
      <div className="flex justify-center">{children}</div>
      <div className={shell.headerEnd}>
        <AccountButton session={session} next={here} />
      </div>
    </header>
  );
}
