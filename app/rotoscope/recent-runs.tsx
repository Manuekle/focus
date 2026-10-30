"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { rotoscopeUrls, type RotoscopeRunSummary } from "../../shared/rotoscope";
import shell from "../editor/studio.module.css";
import { rotoscopeApi } from "./rotoscope-client";

/**
 * The latest Rotoscope runs, listed beside the Flipbook animations: both are
 * projects of step 2, and a run becomes an animation once it opens in Flipbook.
 */
export function RecentRuns({ limit = 5 }: { readonly limit?: number }) {
  const [runs, setRuns] = useState<RotoscopeRunSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    rotoscopeApi.list().then((list) => live && setRuns(list), () => live && setRuns([]));
    return () => { live = false; };
  }, []);
  if (!runs?.length) return null;
  return (
    <nav className={shell.projects} aria-label="Rotoscope runs">
      <p className={shell.sideLabel}>Rotoscope runs</p>
      <ul className="flex flex-col gap-1">
        {runs.slice(0, limit).map((entry) => (
          <li key={entry.id} className={shell.project}>
            <Link href={`/rotoscope?run=${entry.id}`} className={shell.projectLink}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the run's character, from its media route */}
              <img src={rotoscopeUrls.media(entry.id, "character")} alt="" className={cn(shell.poster)} style={{ objectFit: "contain" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-foreground" title={entry.name}>{entry.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{entry.total ? `${entry.approved}/${entry.total} frames approved` : "Preparing"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {runs.length > limit ? <Link href="/rotoscope" className="px-2 text-xs text-muted-foreground hover:text-foreground">All {runs.length} runs</Link> : null}
    </nav>
  );
}
