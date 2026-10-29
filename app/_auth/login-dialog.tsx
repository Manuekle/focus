"use client";

import { Dialog } from "radix-ui";
import Link from "next/link";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FacebookButton } from "./facebook-button";
import { Button } from "../../components/ui/button";

/**
 * Explains the generation limit, or asks for Facebook sign-in to save work.
 * Whatever the person typed stays in localStorage meanwhile.
 */
export function LoginDialog({
  open,
  onOpenChange,
  next,
  reason,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where to come back after signing in. */
  readonly next: string;
  readonly reason: "quota" | "save" | "characters";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {reason === "quota" ? "No generations left" : reason === "characters" ? "Keep your characters together" : "Save your projects"}
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {reason === "quota"
                  ? "You’ve used all your free generations. You can still view and export your saved work."
                  : reason === "characters" ? "Sign in to save your references, character designs and every version you create."
                  : "Sign in with Facebook and every clip you edit is saved to your account, with all its versions."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {reason === "quota" ? <Dialog.Close asChild><Button>Continue to my work</Button></Dialog.Close> : <FacebookButton next={next} />}
          {reason !== "quota" ? <div className="space-y-2 text-xs leading-5 text-muted-foreground">
            <p>Facebook shares your name, profile picture and email address, if available.</p>
            <p>
              <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
              {" · "}
              <Link href="/data-deletion" className="underline underline-offset-2">Delete your data</Link>
            </p>
          </div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
