"use client";

import { fitToContainer, renderDiagramSvg } from "../../lib/mermaid-svg";

/**
 * The Mermaid renderer behind every ```mermaid fence in a chat reply.
 *
 * Streamdown asks a diagram plugin for an object with `render(id, source) ->
 * { svg }` and injects the string it gets back. The stock plugin
 * (`@streamdown/mermaid`) answers that by loading mermaid.js, which is a
 * ~500KB parser that builds the diagram by measuring real DOM nodes: it needs
 * a document, it cannot run on the server, and it is the single largest thing
 * the chat screen downloads.
 *
 * `beautiful-mermaid` does the same job with a text parser and its own layout
 * pass, so this returns an SVG string with no DOM involved at all. The
 * post-processing that makes its output usable — theme colours, the Google
 * Fonts import it hardcodes, the fixed pixel width — lives in
 * `lib/mermaid-svg.ts`, because the report card and the PDF export need
 * exactly the same treatment.
 *
 * What is left here is the one thing only this caller has: mermaid.js as a
 * fallback. `beautiful-mermaid` covers flowchart, sequence, class, ER, state
 * and xychart, and throws rather than drawing Mermaid's long tail (gantt,
 * mindmap, timeline, quadrant…) wrong. A fence in a reply can contain any of
 * those, so the cost of the big parser is paid by the diagram that needs it
 * and by nobody else.
 */

let mermaidJsFallback: Promise<MermaidLike> | null = null;

type MermaidLike = {
  readonly render: (id: string, source: string) => Promise<{ readonly svg: string }>;
};

/**
 * mermaid.js, loaded once and only for a diagram `beautiful-mermaid` refused.
 * Kept behind a dynamic import so it stays out of the chat bundle.
 */
async function loadMermaidJs(): Promise<MermaidLike> {
  mermaidJsFallback ??= import("@streamdown/mermaid").then((mod) =>
    mod.mermaid.getMermaid({
      securityLevel: "strict",
      startOnLoad: false,
      theme: "neutral",
    }),
  );
  return mermaidJsFallback;
}

async function renderDiagram(id: string, source: string): Promise<{ svg: string }> {
  try {
    return { svg: await renderDiagramSvg(source) };
  } catch {
    const mermaidJs = await loadMermaidJs();
    const { svg } = await mermaidJs.render(id, source);
    return { svg: fitToContainer(svg) };
  }
}

/**
 * Shaped to Streamdown's `DiagramPlugin`. Not typed as one on purpose: that
 * interface types its config parameter as mermaid.js's `MermaidConfig`, and
 * importing the type would pull the package back into the module graph for a
 * value this renderer ignores.
 */
export const mermaid = {
  getMermaid: () => ({
    initialize: () => {},
    render: renderDiagram,
  }),
  language: "mermaid",
  name: "mermaid" as const,
  type: "diagram" as const,
};
