"use client";

import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { PlayIcon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LiquidSlider } from "@/components/ui/liquid-slider";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { SOUND_THEMES, useSound, type CueName, type SoundTheme } from "@/components/sound-provider";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** A press, a pick, a switch and an outcome: enough of a material to judge it by. */
const PREVIEW: readonly (readonly [CueName, number])[] = [
  ["tap", 0],
  ["select", 240],
  ["toggle", 480],
  ["success", 760],
];

/**
 * Mute switch, material and volume for the cuelume interaction sounds.
 *
 * Lives on Account rather than Settings: it's a preference of whoever is
 * signed in, not a credential this installation runs on.
 */
export function SoundSettings({ className }: { readonly className?: string }) {
  const t = useT();
  const { enabled, volume, theme, setEnabled, setVolume, setTheme, cue } = useSound();
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const preview = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = PREVIEW.map(([name, at]) => window.setTimeout(() => cue(name), at));
  };

  return (
    <div className={cn("mb-4 break-inside-avoid rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]", className)}>
      <div className="flex flex-col">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={VolumeHighIcon} size={16} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{t("sound.title")}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("sound.description")}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              label={t(enabled ? "sound.turnOff" : "sound.turnOn")}
            />
          </div>

          <div className={cn("mt-5 flex flex-col gap-2.5", !enabled && "pointer-events-none opacity-50")} aria-disabled={!enabled}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">{t("sound.theme")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={preview}
                disabled={!enabled}
                // The preview is the sound; a tap ahead of it would be the
                // first note of every material.
                data-cuelume-silent
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={2} />
                {t("sound.preview")}
              </Button>
            </div>
            <SlidingTabs
              // Each tab presses in its own material, so picking one is
              // already hearing it.
              tabs={SOUND_THEMES.map((id) => ({
                id,
                label: t(`sound.theme.${id}`),
                data: { "data-cuelume-theme": id },
              }))}
              value={theme}
              onValueChange={(id) => setTheme(id as SoundTheme)}
            />
            <p className="text-xs text-muted-foreground">{t(`sound.themeHint.${theme}`)}</p>
          </div>
        </div>
        {/* Volume slider — footer strip outside the inner border */}
        <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-1.5">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">{t("sound.volume")}</span>
          <LiquidSlider
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={!enabled}
            label={t("sound.volume")}
            onValueChange={setVolume}
          />
          <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
