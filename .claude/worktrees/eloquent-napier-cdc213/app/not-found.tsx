"use client";

// A 404 is a page a person reads, not a status code. It renders inside the
// root layout, so the locale provider is available and both languages get the
// same sentence — which is why this is a client component.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";

export default function NotFound() {
  const t = useT();
  const router = useRouter();

  // Nobody should sit on a dead end: after 3s without a touch, key or scroll
  // the page goes home. Home, not back — history can lead to another 404 and
  // loop, while "/" always resolves (the landing, or the login on the admin
  // host). Never on "/" itself, so a failing root can't reload forever.
  useEffect(() => {
    if (window.location.pathname === "/") return;
    const timer = window.setTimeout(() => window.location.replace("/"), 3000);
    const stop = () => window.clearTimeout(timer);
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, stop, { once: true, passive: true });
    return () => {
      stop();
      for (const name of events) window.removeEventListener(name, stop);
    };
  }, []);

  const handleBack = () => {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <div className="flex flex-col items-center gap-4">
        <p aria-hidden="true" className="font-numeral text-6xl leading-none text-muted-foreground/60 select-none">
          404
        </p>
        <div className="space-y-2">
          <h1 className="text-xl font-medium tracking-[-0.02em]">{t("notFound.title")}</h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("notFound.description")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild>
          <Link href="/">{t("notFound.home")}</Link>
        </Button>
        <Button variant="outline" onClick={handleBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
          {t("notFound.back")}
        </Button>
      </div>
    </div>
  );
}
