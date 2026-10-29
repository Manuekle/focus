"use client";

import { useEffect, useState } from "react";
import { LoginDialog } from "./login-dialog";
import { GENERATION_LIMIT_EVENT } from "./generation-feedback";
import { useSession } from "./session-client";

export function GenerationLimitDialog() {
  const [open, setOpen] = useState(false);
  const { session } = useSession();
  const remaining = session?.quota?.remaining;
  useEffect(() => {
    if (remaining === 0) setOpen(true);
  }, [remaining]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(GENERATION_LIMIT_EVENT, show);
    return () => window.removeEventListener(GENERATION_LIMIT_EVENT, show);
  }, []);
  return <LoginDialog open={open} onOpenChange={setOpen} next="/flipbook" reason="quota" />;
}
