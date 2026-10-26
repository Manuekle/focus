import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * The JSON in the hero's fake tool calls, coloured.
 *
 * This exists instead of `ToolResultOutput`, and the reason is worth stating
 * plainly: that component renders through Shiki, and Shiki's regex engine is a
 * WebAssembly module inlined as base64 — 607 KB of it, plus the TextMate
 * grammars and two themes. The hero mounts on first paint, so every visitor to
 * the marketing page downloaded and instantiated a syntax highlighter to
 * colour `{"active": 3, "matching": 0}`. It was the single largest asset on
 * the page, larger than every font put together.
 *
 * The colours are Shiki's, lifted from the same two themes `agent-code.tsx`
 * asks for — `github-light-high-contrast` and `github-dark-high-contrast` — so
 * the block renders identically to what it replaced. JSON has four token
 * classes and a regex is enough to tell them apart; nothing here needs a
 * grammar.
 *
 * `AgentCode` itself is untouched and still the right component for real tool
 * output, where the language varies and the content is not known in advance.
 */

/** Shiki's `github-*-high-contrast` colours for the four JSON token classes. */
const TOKEN = {
  key: ["#024C1A", "#72F088"],
  number: ["#023B95", "#91CBFF"],
  punctuation: ["#0E1116", "#F0F3F6"],
  string: ["#032563", "#ADDCFF"],
} as const;

type TokenKind = keyof typeof TOKEN;

/**
 * Splits a line into runs of one token class each.
 *
 * A quoted run is a key if the next non-space character is a colon, and a
 * string otherwise — which is the whole of JSON's ambiguity. Everything that
 * is not a quoted run or a bare number is punctuation, including whitespace,
 * so the runs always reassemble into the original line exactly.
 */
function tokenize(line: string): { kind: TokenKind; text: string }[] {
  const runs: { kind: TokenKind; text: string }[] = [];
  const pattern = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  let last = 0;

  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) {
      runs.push({ kind: "punctuation", text: line.slice(last, match.index) });
    }
    const text = match[0];
    const rest = line.slice(match.index + text.length);
    const kind: TokenKind = text.startsWith('"')
      ? rest.trimStart().startsWith(":")
        ? "key"
        : "string"
      : "number";
    runs.push({ kind, text });
    last = match.index + text.length;
  }

  if (last < line.length) runs.push({ kind: "punctuation", text: line.slice(last) });
  return runs;
}

export function MockJson({ children, className }: { readonly children: string; readonly className?: string }) {
  const lines = children.split("\n");

  return (
    <pre
      className={cn(
        // The classes `ToolResultOutput` composed onto `AgentCode`, so the
        // block sits in the disclosure exactly as it did.
        "m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/80",
        className,
      )}
    >
      <code>
        {lines.map((line, lineIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static mock copy, never reordered.
          <Fragment key={lineIndex}>
            {tokenize(line).map((run, runIndex) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: same.
                key={runIndex}
                className="text-[var(--mock-json-light)] dark:text-[var(--mock-json-dark)]"
                style={{
                  "--mock-json-light": TOKEN[run.kind][0],
                  "--mock-json-dark": TOKEN[run.kind][1],
                } as React.CSSProperties}
              >
                {run.text}
              </span>
            ))}
            {lineIndex < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
