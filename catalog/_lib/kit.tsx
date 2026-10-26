"use client";

// The catalog's own furniture: the frame every example sits in.
//
// These are deliberately plain — a preview surface that had opinions would
// compete with the component it is meant to be showing. The one exception is
// the copy button, which reuses the app's `Button` so the catalog is not the
// only screen in the repo with a bespoke one.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "../../components/icons/icon";
import { CheckIcon, Copy01Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button";
import { Rise } from "cube-motion/react";
import { ActionSwapRollIcon, ActionSwapRollText } from "../../components/motion/action-swap-roll";
import { cn } from "../../lib/utils";
import { ct } from "./catalog-i18n";
import type { Demo, PropDoc } from "./types";

// ── Copy ────────────────────────────────────────────────────────────

export function CopyButton({
  value,
  label,
  className,
}: {
  readonly value: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    if (!navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [value]);

  const displayLabel = label ?? ct("shell.copy");

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={copy}
      aria-label={displayLabel}
      className={cn("text-muted-foreground", className)}
    >
      <ActionSwapRollIcon value={copied ? "copied" : "copy"} className="size-3">
        <HugeiconsIcon
          icon={copied ? CheckIcon : Copy01Icon}
          size={12}
          strokeWidth={1.75}
        />
      </ActionSwapRollIcon>
      <ActionSwapRollText value={copied ? "copied" : "copy"}>
        {copied ? ct("shell.copied") : displayLabel}
      </ActionSwapRollText>
    </Button>
  );
}

// ── Code ────────────────────────────────────────────────────────────

/**
 * A snippet, in the app's mono face.
 *
 * Not the app's `CodeBlock`: that one loads Shiki and highlights
 * asynchronously, and this page holds well over a hundred snippets. The
 * catalog is a reading surface, so the cost of a syntax theme is paid in
 * bundle size on every entry and repaid on none of them.
 */
export function Code({ code, className }: { readonly code: string; readonly className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-muted/60 p-3.5 font-mono text-[12px] leading-[1.6] text-foreground/85",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

/** The one-line import, with its own copy affordance. */
export function ImportLine({ line }: { readonly line: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11.5px] whitespace-nowrap text-muted-foreground">
        {line}
      </code>
      <CopyButton value={line} label="Import" />
    </div>
  );
}

// ── Preview ─────────────────────────────────────────────────────────

const SURFACE_CLASS = {
  plain: "bg-card",
  muted: "bg-muted/40",
  page: "bg-background",
} as const;

/** One example: its heading, the live thing, and the JSX behind a toggle. */
export function DemoBlock({ demo }: { readonly demo: Demo }) {
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{demo.title}</p>
          {demo.desc ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{demo.desc}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setShowCode((open) => !open)}
          aria-expanded={showCode}
          className="shrink-0 text-muted-foreground"
        >
          <HugeiconsIcon icon={SourceCodeIcon} size={12} strokeWidth={1.75} />
          <ActionSwapRollText value={showCode ? "hide" : "code"}>
            {showCode ? ct("shell.hide") : ct("shell.code")}
          </ActionSwapRollText>
        </Button>
      </div>

      <div
        className={cn(
          "flex min-h-24 flex-wrap items-center gap-3 rounded-b-xl p-5",
          SURFACE_CLASS[demo.surface ?? "plain"],
          showCode && "rounded-b-none border-b border-border",
        )}
      >
        {demo.render}
      </div>

      {/* Panel que viene y va: entra con rise, sale con leave y
          desmonta solo. Sin animación de altura a propósito: eso sería
          layout, fuera del scope de Cube. */}
      <Rise show={showCode} className="p-3">
        <div className="mb-2 flex justify-end">
          <CopyButton value={demo.code} />
        </div>
        <Code code={demo.code} />
      </Rise>
    </div>
  );
}

// ── API table ───────────────────────────────────────────────────────

export function PropsTable({ props }: { readonly props: readonly PropDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[36rem] border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] tracking-[-0.02em] text-muted-foreground uppercase">
            <th scope="col" className="px-3.5 py-2 font-medium">Prop</th>
            <th scope="col" className="px-3.5 py-2 font-medium">Type</th>
            <th scope="col" className="px-3.5 py-2 font-medium">Default</th>
            <th scope="col" className="px-3.5 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {props.map((prop) => (
            <tr key={prop.name} className="border-b border-border/60 last:border-b-0 align-top">
              <td className="px-3.5 py-2.5 font-mono text-[12px] whitespace-nowrap">
                {prop.name}
                {prop.required ? (
                  <span className="ml-1 text-destructive" title={ct("shell.required")}>*</span>
                ) : null}
              </td>
              <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-muted-foreground">
                {prop.type}
              </td>
              <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-muted-foreground">
                {prop.def ?? "—"}
              </td>
              <td className="px-3.5 py-2.5 text-muted-foreground">{prop.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Misc ────────────────────────────────────────────────────────────

/** A labelled cell — used by the foundations section for tokens. */
export function Swatch({
  name,
  value,
  children,
}: {
  readonly name: string;
  readonly value?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {children}
      <div className="min-w-0">
        <p className="truncate font-mono text-[11px]">{name}</p>
        {value ? (
          <p className="truncate font-mono text-[10.5px] text-muted-foreground">{value}</p>
        ) : null}
      </div>
    </div>
  );
}

/** The row of related exports a module ships that have no demo of their own. */
export function ExportList({ names }: { readonly names: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <code
          key={name}
          className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          {name}
        </code>
      ))}
    </div>
  );
}
