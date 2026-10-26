"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { ScoreRing } from "@/components/ui/score-ring";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { GradeBreakdown, type CreativeGrade } from "./creative-grade";

/**
 * "Revisar antes de publicar": paste the words of an ad, get the same nine
 * readings a live ad gets — and the policy flag — before Meta's own review
 * sees it. Words only: a draft has no creative on Meta yet.
 */
export function AdReviewDrawer({
  onOpenChange,
  open,
  ready,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  /** A TypeSafe key is set. The drawer is only offered when it is. */
  readonly ready: boolean;
}) {
  const t = useT();
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [grade, setGrade] = useState<CreativeGrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const review = async () => {
    setBusy(true);
    setError(null);
    const result = await fetchJson<{ grade: CreativeGrade }>("/api/ads/review", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primaryText, headline }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGrade(result.data.grade);
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle icon={<HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.75} />}>
            {t("ads.review.title")}
          </DrawerTitle>
          <DrawerDescription>{t("ads.review.description")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="ad-review-text">
                {t("ads.review.textLabel")}
              </label>
              <Textarea
                id="ad-review-text"
                maxLength={3000}
                onChange={(e) => setPrimaryText(e.target.value)}
                placeholder={t("ads.review.textPlaceholder")}
                rows={6}
                value={primaryText}
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="ad-review-headline">
                {t("ads.review.headlineLabel")}
              </label>
              <Input
                id="ad-review-headline"
                maxLength={300}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder={t("ads.review.headlinePlaceholder")}
                value={headline}
              />
            </div>

            {grade ? (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <ScoreRing
                    aria-label={t("ads.creatives.gradeAria", { grade: grade.overall.toFixed(1) })}
                    decimals={1}
                    dimension={48}
                    max={5}
                    size="xs"
                    value={grade.overall}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{t("ads.review.result", { grade: grade.overall.toFixed(1) })}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{t(`ads.creatives.format.${grade.format}`)}</Badge>
                      <Badge variant="secondary">{t(`ads.creatives.funnel.${grade.funnel}`)}</Badge>
                    </div>
                  </div>
                </div>
                <GradeBreakdown grade={grade} />
              </div>
            ) : null}
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t("ads.review.close")}
          </Button>
          <Button disabled={!ready || busy || !primaryText.trim()} onClick={() => void review()} type="button">
            {busy ? <Spinner /> : null}
            {t(grade ? "ads.review.again" : "ads.review.action")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
