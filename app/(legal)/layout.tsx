import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div lang="es" className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Link href="/editor" className="text-lg font-semibold" aria-label="Focus: ir al editor">Focus</Link>
        <nav aria-label="Información de Focus" className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">Privacidad</Link>
          <Link href="/data-deletion" className="underline underline-offset-4">Eliminar mis datos</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 pt-8 pb-20">
        <article className="text-base leading-7 [&_h1]:text-3xl [&_h1]:leading-tight [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-6 [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </article>
      </main>
    </div>
  );
}
