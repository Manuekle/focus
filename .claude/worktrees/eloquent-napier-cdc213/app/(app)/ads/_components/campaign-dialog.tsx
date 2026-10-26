"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Megaphone01Icon } from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";

/**
 * Create and edit a Meta campaign.
 *
 * Two things Meta decides for us, and the form follows rather than pretending
 * otherwise:
 *
 *   - A campaign's **objective** is fixed at creation. Editing shows it as a
 *     read-only line instead of a select that would fail on save.
 *   - **Special ad categories** are likewise create-only, for the same reason.
 *
 * Budgets are typed in major units — what the operator's currency actually
 * looks like — and the route converts. Nothing in the browser ever multiplies
 * by 100.
 */

export type CampaignDraft = {
  readonly id: string;
  readonly name: string;
  readonly objective: string;
  /** Minor units, straight off Meta. */
  readonly daily_budget?: string;
  readonly lifetime_budget?: string;
};

const OBJECTIVE_OPTIONS = [
  { value: "OUTCOME_SALES", key: "ads.objSales" },
  { value: "OUTCOME_LEADS", key: "ads.objLeads" },
  { value: "OUTCOME_TRAFFIC", key: "ads.objTraffic" },
  { value: "OUTCOME_ENGAGEMENT", key: "ads.objEngagement" },
  { value: "OUTCOME_AWARENESS", key: "ads.objAwareness" },
  { value: "OUTCOME_APP_PROMOTION", key: "ads.objApp" },
] as const;

const SPECIAL_OPTIONS = [
  { value: "HOUSING", key: "ads.specialHousing" },
  { value: "EMPLOYMENT", key: "ads.specialEmployment" },
  { value: "CREDIT", key: "ads.specialCredit" },
  { value: "ISSUES_ELECTIONS_POLITICS", key: "ads.specialPolitics" },
  { value: "ONLINE_GAMBLING_AND_GAMING", key: "ads.specialGambling" },
] as const;

type BudgetKind = "none" | "daily" | "lifetime";

/** Meta's minor units back to something a person types. */
function toMajor(minor?: string): string {
  if (!minor) return "";
  const n = parseInt(minor, 10);
  return Number.isFinite(n) ? String(n / 100) : "";
}

function initialBudgetKind(campaign?: CampaignDraft): BudgetKind {
  if (campaign?.daily_budget) return "daily";
  if (campaign?.lifetime_budget) return "lifetime";
  return campaign ? "none" : "daily";
}

export function CampaignDialog({
  campaign,
  onOpenChange,
  onSaved,
  open,
}: {
  /** Absent for a new campaign. */
  readonly campaign?: CampaignDraft;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (created: boolean) => void;
  readonly open: boolean;
}) {
  const t = useT();
  const editing = campaign !== undefined;

  const [name, setName] = useState(campaign?.name ?? "");
  const [objective, setObjective] = useState<string>(
    campaign?.objective ?? "OUTCOME_TRAFFIC",
  );
  const [special, setSpecial] = useState<string>("NONE");
  const [budgetKind, setBudgetKind] = useState<BudgetKind>(initialBudgetKind(campaign));
  const [budget, setBudget] = useState(
    toMajor(campaign?.daily_budget ?? campaign?.lifetime_budget),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const budgetNeeded = budgetKind !== "none";
  const budgetValue = Number(budget);
  const budgetValid = !budgetNeeded || (Number.isFinite(budgetValue) && budgetValue > 0);
  const canSave = name.trim().length > 0 && budgetValid && !saving;

  const submit = async () => {
    setSaving(true);
    setError(null);

    const budgetFields =
      budgetKind === "daily"
        ? { dailyBudget: budgetValue }
        : budgetKind === "lifetime"
          ? { lifetimeBudget: budgetValue }
          : {};

    const result = editing
      ? await fetchJson("/api/ads", t, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: campaign.id, name: name.trim(), ...budgetFields }),
        })
      : await fetchJson("/api/ads", t, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            objective,
            ...budgetFields,
            specialAdCategories: special === "NONE" ? [] : [special],
          }),
        });

    setSaving(false);
    if (!result.ok) {
      // Meta's own sentence rides in `error.detail`, which the banner prints
      // under the translated line. For "budget below the account minimum" that
      // second line is the entire answer.
      setError(result.error);
      return;
    }
    onSaved(!editing);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle icon={<HugeiconsIcon icon={Megaphone01Icon} size={18} strokeWidth={1.75} />}>
            {t(editing ? "ads.editTitle" : "ads.createTitle")}
          </DrawerTitle>
          <DrawerDescription>
            {t(editing ? "ads.editDescription" : "ads.createDescription")}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="campaign-name">
                {t("ads.fieldName")}
              </label>
              <Input
                id="campaign-name"
                onChange={(e) => setName(e.target.value)}
                placeholder={t("ads.fieldNamePlaceholder")}
                value={name}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="campaign-objective">
                {t("ads.fieldObjective")}
              </label>
              {editing ? (
                /* Meta fixes the objective at creation. A select here would only
                   offer a change that the save is going to refuse. */
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
                  {t(
                    OBJECTIVE_OPTIONS.find((o) => o.value === campaign.objective)?.key ??
                      "ads.objTraffic",
                  )}
                  <span className="mt-0.5 block text-xs">{t("ads.objectiveLocked")}</span>
                </p>
              ) : (
                <Select onValueChange={setObjective} value={objective}>
                  <SelectTrigger className="w-full" id="campaign-objective">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBJECTIVE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-medium text-sm" htmlFor="campaign-budget-kind">
                  {t("ads.fieldBudgetType")}
                </label>
                <Select
                  onValueChange={(next) => setBudgetKind(next as BudgetKind)}
                  value={budgetKind}
                >
                  <SelectTrigger className="w-full" id="campaign-budget-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t("ads.budgetDaily")}</SelectItem>
                    <SelectItem value="lifetime">{t("ads.budgetLifetime")}</SelectItem>
                    <SelectItem value="none">{t("ads.budgetAtAdSet")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-sm" htmlFor="campaign-budget">
                  {t("ads.fieldBudgetAmount")}
                </label>
                <Input
                  disabled={!budgetNeeded}
                  id="campaign-budget"
                  inputMode="decimal"
                  min="0"
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={budgetNeeded ? budget : ""}
                />
              </div>
            </div>

            {!editing && (
              <div className="space-y-1.5">
                <label className="font-medium text-sm" htmlFor="campaign-special">
                  {t("ads.fieldSpecialCategory")}
                </label>
                <Select onValueChange={setSpecial} value={special}>
                  <SelectTrigger className="w-full" id="campaign-special">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t("ads.specialNone")}</SelectItem>
                    {SPECIAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {t("ads.specialCategoryHint")}
                </p>
              </div>
            )}

            {!editing && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
                {t("ads.createdPausedHint")}
              </p>
            )}
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSave} onClick={() => void submit()} type="button">
            {t(editing ? "common.save" : "ads.createAction")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
