"use client";

import { useState } from "react";
import { FacebookIcon } from "../../components/icons/social-icons";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { signInWithFacebook } from "./session-client";

/** "Continue with Facebook", in Facebook's own blue. */
export function FacebookButton({ next, className, label = "Continue with Facebook" }: { readonly next: string; readonly className?: string; readonly label?: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      type="button"
      disabled={leaving}
      onClick={() => {
        setLeaving(true);
        signInWithFacebook(next);
      }}
      className={cn(
        "flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#1877F2] px-4 text-sm font-medium text-white transition-[background-color,transform] duration-150",
        "hover:bg-[#166FE5] active:scale-[0.98] disabled:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1877F2]",
        className,
      )}
    >
      {leaving ? <Spinner className="size-4" /> : <FacebookIcon width={18} height={18} />}
      {label}
    </button>
  );
}
