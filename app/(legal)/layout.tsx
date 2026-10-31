import type { ReactNode } from "react";
import { SiteHeader } from "../_auth/site-header";
import shell from "../editor/studio.module.css";
import { LegalNav } from "./legal-nav";

export default function LegalLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div lang="es" className={shell.studio}>
      <SiteHeader label="Legal">
        <LegalNav />
      </SiteHeader>
      <main className="mx-auto w-full max-w-2xl px-5 pt-12 pb-24 md:pt-16">
        <article
          className={[
            "page-enter text-sm leading-7 text-muted-foreground",
            "[&_h1]:font-[family-name:var(--font-sn-pro)] [&_h1]:text-2xl [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:text-foreground",
            "[&_h1+p]:mt-2 [&_h1+p]:text-xs",
            "[&_h2]:mt-10 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-foreground",
            "[&_p]:my-3 [&_strong]:font-medium [&_strong]:text-foreground",
            "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_li]:marker:text-muted-foreground/60",
            "[&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
          ].join(" ")}
        >
          {children}
        </article>
      </main>
    </div>
  );
}
