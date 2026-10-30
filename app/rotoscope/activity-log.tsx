"use client";

import { useState } from "react";
import { Alert02Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import styles from "./rotoscope.module.css";

type Check = { readonly name: string; readonly passed: boolean; readonly detail: string };
type Entry =
  | { readonly kind: "attempt"; frame: number; tries: number; max: number; checks: Check[]; notes: string[]; approved: boolean }
  | { readonly kind: "halt"; readonly frame: number }
  | { readonly kind: "note"; readonly text: string };

/** How many entries show before "Show older". */
const FIRST = 8;

/**
 * The run's log as it reads to a person: one row per attempt with the checks
 * it failed, the stops and the person's own actions in between, newest first.
 * Lines the pipeline writes (run-state.ts, service.ts) are parsed back here.
 */
function parse(log: readonly string[]): Entry[] {
  const entries: Entry[] = [];
  let open: Extract<Entry, { kind: "attempt" }> | null = null;
  for (const line of log) {
    const attempt = /^frame (\d+): attempt (\d+)\/(\d+)$/.exec(line);
    if (attempt) {
      open = { kind: "attempt", frame: Number(attempt[1]), tries: Number(attempt[2]), max: Number(attempt[3]), checks: [], notes: [], approved: false };
      entries.push(open);
      continue;
    }
    const check = /^ {2}(ok {2}|FAIL) (\w+): (.*)$/.exec(line);
    if (check && open) { open.checks.push({ name: check[2], passed: check[1] !== "FAIL", detail: check[3] }); continue; }
    if (line.startsWith("  ") && open) { open.notes.push(line.trim()); continue; }
    const approved = /^frame (\d+): approved$/.exec(line);
    if (approved && open?.frame === Number(approved[1])) { open.approved = true; open = null; continue; }
    const halt = /^FIREWALL: stopped at frame (\d+)$/.exec(line);
    open = null;
    if (halt) { entries.push({ kind: "halt", frame: Number(halt[1]) }); continue; }
    entries.push({ kind: "note", text: line.charAt(0).toUpperCase() + line.slice(1) });
  }
  return entries.reverse();
}

export function ActivityLog({ log, labels, liveFrame, onFrame }: {
  readonly log: readonly string[];
  /** Check names as the person knows them. */
  readonly labels: Readonly<Record<string, string>>;
  /** The frame being drawn right now: its newest attempt is still running. */
  readonly liveFrame: number | null;
  readonly onFrame: (index: number) => void;
}) {
  const [all, setAll] = useState(false);
  const entries = parse(log);
  const shown = all ? entries : entries.slice(0, FIRST);
  const frameLink = (index: number) => (
    <button type="button" className={styles.activityFrame} onClick={() => onFrame(index)}>Frame {index}</button>
  );

  return (
    <>
      <ol className={styles.activity}>
        {shown.map((entry, position) => {
          if (entry.kind === "note") {
            return (
              <li key={position} data-tone="neutral">
                <span className={styles.activityDot} aria-hidden />
                <span className={styles.activityNote}>{entry.text}</span>
              </li>
            );
          }
          if (entry.kind === "halt") {
            return (
              <li key={position} data-tone="warning">
                <span className={styles.activityDot} aria-hidden><HugeiconsIcon icon={Alert02Icon} size={10} strokeWidth={2.2} /></span>
                <span className="min-w-0">
                  <span className={styles.activityHead}>Stopped at {frameLink(entry.frame)}</span>
                  <span className={styles.activityNote}>Every attempt failed a check.</span>
                </span>
              </li>
            );
          }
          const failed = entry.checks.filter((check) => !check.passed);
          const passed = entry.checks.filter((check) => check.passed);
          const running = position === 0 && !entry.approved && entry.frame === liveFrame;
          const tone = entry.approved ? "approved" : running ? "running" : "rejected";
          return (
            <li key={position} data-tone={tone}>
              <span className={styles.activityDot} aria-hidden>
                {running ? <Spinner className="size-2.5" /> : <HugeiconsIcon icon={entry.approved ? Tick02Icon : Cancel01Icon} size={10} strokeWidth={2.4} />}
              </span>
              <span className="min-w-0">
                <span className={styles.activityHead}>
                  {frameLink(entry.frame)}
                  <span className={styles.activityMeta}>attempt {entry.tries}/{entry.max}</span>
                  <span className={styles.activityOutcome}>{entry.approved ? "Approved" : running ? "In progress" : "Rejected"}</span>
                </span>
                {failed.map((check) => (
                  <span key={check.name} className={styles.activityFail}>
                    <span className="text-foreground">{labels[check.name] ?? check.name}</span> · {check.detail}
                  </span>
                ))}
                {passed.length ? <span className={styles.activityNote}>Passed: {passed.map((check) => labels[check.name] ?? check.name).join(", ")}</span> : null}
                {entry.notes.map((note) => <span key={note} className={styles.activityNote}>{note}</span>)}
              </span>
            </li>
          );
        })}
      </ol>
      {entries.length > FIRST ? (
        <Button size="xs" variant="ghost" className="w-fit" onClick={() => setAll((open) => !open)}>
          {all ? "Show fewer" : `Show ${entries.length - FIRST} older`}
        </Button>
      ) : null}
    </>
  );
}
