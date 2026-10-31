"use client";

import { useState } from "react";
import { FacebookIcon } from "../../components/icons/social-icons";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { signInWithFacebook } from "./session-client";

/** "Continue with Facebook", as the app's own primary button. */
export function FacebookButton({ next, className, label = "Continue with Facebook", size = "lg" }: {
  readonly next: string;
  readonly className?: string;
  readonly label?: string;
  /** `lg` fills a dialog; `default` sits inline beside other controls. */
  readonly size?: "default" | "lg";
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <Button
      size={size}
      disabled={leaving}
      aria-busy={leaving || undefined}
      onClick={() => {
        setLeaving(true);
        signInWithFacebook(next);
      }}
      className={cn("w-full gap-2", className)}
    >
      {leaving ? <Spinner className="size-4" /> : <FacebookIcon width={16} height={16} />}
      {label}
    </Button>
  );
}
