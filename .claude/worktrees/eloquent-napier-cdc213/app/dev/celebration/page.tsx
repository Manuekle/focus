"use client";

import { useState } from "react";
import { useCelebrate } from "@/components/use-celebrate";
import { useSound } from "@/components/sound-provider";
import { SoundToggle } from "@/components/sound-toggle";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AiImagineIcon } from "@hugeicons/core-free-icons";
import { useI18n } from "@/lib/i18n/provider";

/** Dev-only: exercise repeated async successes without creating real agents. */
export default function CelebrationPreview() {
  const { locale } = useI18n();
  const tr = (es: string, en: string) => locale === "es" ? es : en;
  const celebrate = useCelebrate();
  const { enabled, volume } = useSound();
  const [completed, setCompleted] = useState(0);
  const [busy, setBusy] = useState(false);
  const hire = async () => {
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setCompleted((count) => count + 1);
    setBusy(false);
    celebrate();
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">oruka · {tr("vista de desarrollo", "development preview")}</span>
          <ThemeToggle />
        </div>
        <div className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="rounded-[14px] border border-border/50 bg-card p-6">
            <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground">
              <HugeiconsIcon icon={AiImagineIcon} size={24} strokeWidth={1.75} />
            </div>
            <h1 className="text-xl font-medium">{tr("Tu equipo sigue creciendo", "Your team keeps growing")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {tr("Prueba la celebración de una contratación sin crear agentes.", "Preview a hiring celebration without creating agents.")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void hire()}>
                {busy ? tr("Contratando…", "Hiring…") : tr("Probar contratación", "Preview hiring")}
              </Button>
              <Button variant="outline" onClick={(event) => celebrate({ from: event.currentTarget })}>
                {tr("Desde el botón", "From the button")}
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground" role="status">
              {tr("Celebraciones completadas", "Completed celebrations")}: {completed}
            </p>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <SoundToggle />
            <span className="text-xs text-muted-foreground">
              {enabled ? Math.round(volume * 100) + "%" : tr("Silenciado", "Muted")}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
