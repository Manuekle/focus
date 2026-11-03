"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "radix-ui";
import { Button } from "../../components/ui/button";
import type { DrawBackground } from "../../shared/rotoscope";

const CHOICES: readonly { readonly value: DrawBackground; readonly title: string; readonly detail: string }[] = [
  { value: "scene", title: "With the video’s background", detail: "The character in the video’s own room, as on the test page." },
  { value: "none", title: "Transparent, as before", detail: "The character alone, cut out and placed on the video person." },
];

function ChooseBackgroundView({ what, onDone }: { readonly what: string; readonly onDone: (value: DrawBackground | null) => void }) {
  const [open, setOpen] = React.useState(true);
  const settled = React.useRef(false);
  const answer = (value: DrawBackground | null) => {
    if (settled.current) return;
    settled.current = true;
    setOpen(false);
    onDone(value);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) answer(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="t-scrim fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="t-modal fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-[family-name:var(--font-sn-pro)] text-base leading-[1.4] font-semibold text-balance text-foreground">How should {what} come out?</Dialog.Title>
            <Dialog.Description className="text-xs leading-5 text-pretty text-muted-foreground">Each frame is drawn once with the test page’s prompt and kept as drawn, without checks.</Dialog.Description>
          </div>
          <div className="flex flex-col gap-2">
            {CHOICES.map((choice, i) => (
              <button
                key={choice.value}
                type="button"
                autoFocus={i === 0}
                onClick={() => answer(choice.value)}
                className="flex cursor-pointer flex-col gap-0.5 rounded-xl border border-border px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm font-medium text-foreground">{choice.title}</span>
                <span className="text-xs text-muted-foreground">{choice.detail}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="text-xs md:text-xs" onClick={() => answer(null)}>Cancel</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Asks how the drawings should come out before a run draws (direct.ts): with the video's background, or cut out on
 * transparency. Resolves null when the person cancels. `what` names them: "the 146 drawings", "frame 12".
 */
export function chooseBackground(what: string): Promise<DrawBackground | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let done = false;
    root.render(
      <ChooseBackgroundView
        what={what}
        onDone={(value) => {
          if (done) return;
          done = true;
          resolve(value);
          // Past the close animation (150ms) so the dialog is seen leaving.
          window.setTimeout(() => { root.unmount(); host.remove(); }, 200);
        }}
      />,
    );
  });
}
