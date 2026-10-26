"use client";

import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { MERMAID_SAMPLE_GROUPS } from "./_samples";

/**
 * Every Mermaid construct the chat renderer claims to support, drawn.
 *
 * `tests/mermaid-samples.test.ts` runs the same list headlessly and fails when
 * a sample stops reaching `beautiful-mermaid` — but "did not throw" is a low
 * bar for a picture. A subgraph can lay out on top of its own label, a
 * twelve-shape flow can come out four hundred pixels wide, and an ER
 * relationship the parser quietly drops leaves a diagram that is simply
 * missing a line. None of that fails a test; all of it is obvious here.
 *
 * Rendered through `MessageResponse`, not the renderer directly, so what is on
 * screen is exactly what a reply in /chat produces — same plugin, same stripped
 * chrome, same tokens. Flip the app's theme to check both palettes.
 *
 * One family at a time, picked by the hash (`/dev/mermaid#Sequence`): eighty-four
 * diagrams in one scroll is a page nobody reads to the bottom of, and a hash is
 * a link somebody can paste into a bug report.
 *
 * Dev only — /dev 404s in production (see `app/dev/layout.tsx`).
 */
export default function Page() {
  const [family, setFamily] = useState(MERMAID_SAMPLE_GROUPS[0]!.family);

  useEffect(() => {
    const read = () =>
      setFamily(decodeURIComponent(window.location.hash.slice(1)) || MERMAID_SAMPLE_GROUPS[0]!.family);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const group = MERMAID_SAMPLE_GROUPS.find((g) => g.family === family) ?? MERMAID_SAMPLE_GROUPS[0]!;
  const total = MERMAID_SAMPLE_GROUPS.reduce((sum, g) => sum + g.samples.length, 0);

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      <header className="space-y-2">
        <h1 className="font-medium text-foreground text-xl">Diagramas Mermaid</h1>
        <p className="text-muted-foreground text-sm">
          Las {total} construcciones que{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">beautiful-mermaid</code> dibuja en
          /chat, una por muestra. Cambiá el tema desde la app para revisar las dos paletas.
        </p>
        <nav className="flex flex-wrap gap-1.5 pt-1">
          {MERMAID_SAMPLE_GROUPS.map((g) => (
            <a
              className={
                g.family === group.family
                  ? "rounded-md border border-input bg-accent px-2 py-1 text-foreground text-xs"
                  : "rounded-md border border-border px-2 py-1 text-muted-foreground text-xs transition-colors hover:border-input hover:text-foreground"
              }
              href={`#${encodeURIComponent(g.family)}`}
              key={g.family}
            >
              {g.family} ({g.samples.length})
            </a>
          ))}
        </nav>
      </header>

      {group.samples.map((sample) => (
        <section className="space-y-1.5" key={sample.n}>
          <h2 className="font-medium text-foreground text-sm">
            <span className="text-muted-foreground tabular-nums">{sample.n}.</span> {sample.title}
          </h2>
          {/* The card is this page's, not the diagram's: in a reply the
              diagram sits on the message surface with no frame of its own.
              Here it marks where one sample ends and the next begins. */}
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <MessageResponse>{`\`\`\`mermaid\n${sample.code}\n\`\`\``}</MessageResponse>
          </div>
        </section>
      ))}
    </main>
  );
}
