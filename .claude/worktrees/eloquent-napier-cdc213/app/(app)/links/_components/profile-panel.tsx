"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/provider";
import type { LinkPage } from "@/lib/types";
import { Field, PanelShell } from "./panel";

/** What an empty profile field falls back to. The business profile owns the
 *  name, the line of description and the logo; this page borrows them. */
export type Defaults = {
  readonly address: string;
  readonly description: string;
  readonly email: string;
  readonly phone: string;
  readonly title: string;
  readonly websiteUrl: string;
};

/** Marks a field whose value is coming from the business profile right now. */
function SyncedChip() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
      <HugeiconsIcon icon={Loading03Icon} size={10} strokeWidth={2} />
      {t("links.synced")}
    </span>
  );
}

export function ProfilePanel({
  defaults,
  hasLogo,
  onChange,
  page,
}: {
  readonly defaults: Defaults;
  readonly hasLogo: boolean;
  readonly onChange: (updater: (current: LinkPage) => LinkPage) => void;
  readonly page: LinkPage;
}) {
  const t = useT();
  const titleInherited = !page.profile.title.trim();
  const descriptionInherited = !page.profile.description.trim();

  return (
    <PanelShell title={t("links.sectionProfile")} description={t("links.profileHint")}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        {hasLogo ? (
          // Served by an authenticated route with no static allowlist entry.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/api/business-profile/logo"
            alt=""
            className="size-11 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-muted text-sm font-medium text-muted-foreground">
            {(defaults.title[0] ?? "?").toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{defaults.title}</p>
          <p className="text-xs text-muted-foreground">{t("links.logoFromBusiness")}</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href="/knowledge">{t("links.editBusiness")}</a>
        </Button>
      </div>

      <Field label={t("links.pageTitle")} hint={titleInherited ? <SyncedChip /> : t("links.syncedHint")}>
        <Input
          value={page.profile.title}
          placeholder={defaults.title}
          maxLength={72}
          onChange={(event) =>
            onChange((current) => ({ ...current, profile: { ...current.profile, title: event.target.value } }))
          }
        />
      </Field>

      <Field label={t("links.description")} hint={descriptionInherited ? <SyncedChip /> : t("links.syncedHint")}>
        <Textarea
          value={page.profile.description}
          placeholder={defaults.description}
          maxLength={240}
          rows={3}
          onChange={(event) =>
            onChange((current) => ({ ...current, profile: { ...current.profile, description: event.target.value } }))
          }
        />
      </Field>

      <Field label={t("links.address")}>
        {/* The prefix belongs to the field, not to a div that looks like one:
            `InputGroup` is what gives it the app's focus ring. */}
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>/l/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={page.slug}
            aria-label={t("links.address")}
            maxLength={48}
            onChange={(event) => onChange((current) => ({ ...current, slug: event.target.value }))}
          />
        </InputGroup>
      </Field>
    </PanelShell>
  );
}
