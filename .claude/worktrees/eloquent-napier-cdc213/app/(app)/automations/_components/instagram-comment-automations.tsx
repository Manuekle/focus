"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  Comment01Icon,
  Delete01Icon,
  FavouriteIcon,
  Image01Icon,
  InstagramIcon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
  SentIcon,
  Tick02Icon,
  UserAdd01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { ErrorBanner } from "@/components/ui/error-banner";
import { CommentAutomationCardsSkeleton, SkeletonBar } from "@/components/ai-elements/skeleton";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import { cn } from "@/lib/utils";
import type { CommentAutomation, CommentAutomationInput } from "@/lib/instagram-comment-automations";
import { Card, CardDescription, CardHeader, CardSeparator, CardTitle } from "../../../_components/dashboard-card";
import { RowAction } from "@/components/ui/row-action";

// Comment automations, ManyChat style: someone comments a keyword on a post
// and gets a DM. The list is cards because the useful glance is "which post,
// which words, is it working"; the editor is a drawer with the conversation
// previewed beside the form, since what the owner is really writing is what
// the commenter will read, in order.

// Meta's own limits (lib/instagram-comment-automations.ts).
const MAX_TEXT = 1000;
const MAX_BUTTON = 20;

type Media = { id: string; caption?: string; thumbnailUrl?: string; permalink?: string; timestamp?: string };

type ListResponse = { automations: CommentAutomation[]; instagram: { connected: boolean; username: string | null } };

type Draft = {
  name: string;
  status: "active" | "paused";
  mediaId: string | null;
  media?: { caption?: string; thumbnailUrl?: string; permalink?: string };
  keywords: string[];
  publicReplyOn: boolean;
  publicReplies: string;
  openingMessage: string;
  buttonLabel: string;
  requireFollow: boolean;
  followMessage: string;
  followButtonLabel: string;
  finalMessage: string;
};

function draftFrom(automation: CommentAutomation): Draft {
  return {
    name: automation.name,
    status: automation.status,
    mediaId: automation.mediaId,
    media: automation.media,
    keywords: [...automation.keywords],
    publicReplyOn: automation.publicReplies.length > 0,
    publicReplies: automation.publicReplies.join("\n"),
    openingMessage: automation.openingMessage,
    buttonLabel: automation.buttonLabel,
    requireFollow: automation.requireFollow,
    followMessage: automation.followMessage,
    followButtonLabel: automation.followButtonLabel,
    finalMessage: automation.finalMessage,
  };
}

function inputFrom(draft: Draft): CommentAutomationInput {
  return {
    name: draft.name,
    status: draft.status,
    mediaId: draft.mediaId,
    ...(draft.mediaId && draft.media ? { media: draft.media } : {}),
    keywords: draft.keywords,
    publicReplies: draft.publicReplyOn ? draft.publicReplies.split("\n").map((line) => line.trim()).filter(Boolean) : [],
    openingMessage: draft.openingMessage,
    buttonLabel: draft.buttonLabel,
    requireFollow: draft.requireFollow,
    followMessage: draft.followMessage,
    followButtonLabel: draft.followButtonLabel,
    finalMessage: draft.finalMessage,
  };
}

export function InstagramCommentAutomations() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);

  const newDraft = useCallback(
    (): Draft => ({
      name: t("igComments.defaultName"),
      status: "active",
      mediaId: null,
      keywords: [t("igComments.defaultKeyword")],
      publicReplyOn: true,
      publicReplies: t("igComments.defaultPublicReplies"),
      openingMessage: t("igComments.defaultOpening"),
      buttonLabel: t("igComments.defaultButton"),
      requireFollow: false,
      followMessage: t("igComments.defaultFollow"),
      followButtonLabel: t("igComments.defaultFollowButton"),
      finalMessage: t("igComments.defaultFinal"),
    }),
    [t],
  );

  const load = useCallback(async () => {
    const result = await fetchJson<ListResponse>("/api/instagram/comment-automations", t);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (automation: CommentAutomation, active: boolean) => {
    const result = await fetchJson<{ automation: CommentAutomation }>(`/api/instagram/comment-automations/${automation.id}`, t, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: active ? "active" : "paused" }),
    });
    if (result.ok) await load();
    else toast({ title: uiErrorMessage(t, result.error), status: "error" });
  };

  const remove = async (automation: CommentAutomation) => {
    const ok = await confirm({
      title: t("igComments.deleteTitle"),
      description: t("igComments.deleteBody", { name: automation.name }),
      confirmLabel: t("igComments.delete"),
    });
    if (!ok) return;
    const result = await fetchJson(`/api/instagram/comment-automations/${automation.id}`, t, { method: "DELETE" });
    if (result.ok) await load();
    else toast({ title: uiErrorMessage(t, result.error), status: "error" });
  };

  const automations = data?.automations ?? [];
  const connected = data?.instagram.connected ?? true;
  const account = data?.instagram.username ?? null;

  return (
    <div className="space-y-6">
      {confirmDialog}
      <ErrorBanner error={error} onRetry={() => void load()} onDismiss={() => setError(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("igComments.intro")}</p>
        <Button className="self-start" onClick={() => setEditing({ id: null, draft: newDraft() })} disabled={!data}>
          <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
          {t("igComments.new")}
        </Button>
      </div>

      {data && !connected ? (
        <Alert
          tone="warning"
          role={null}
          title={t("igComments.notConnectedTitle")}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/numbers">
                <HugeiconsIcon icon={InstagramIcon} size={14} strokeWidth={1.75} />
                {t("igComments.connect")}
              </Link>
            </Button>
          }
        >
          {t("igComments.notConnectedBody")}
        </Alert>
      ) : null}

      {/* Only before the first one, as its title says: once a rule exists the
          owner has been through this, and the card list should lead. */}
      {data && connected && automations.length === 0 ? (
        <Alert tone="info" role={null} title={t("igComments.setupTitle")}>
          {t("igComments.setupBody")}
        </Alert>
      ) : null}

      {!data && !error ? <CommentAutomationCardsSkeleton /> : null}

      {data && automations.length === 0 ? (
        <Card className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="grid gap-6 overflow-hidden rounded-[14px] border border-border/50 bg-card p-6 shadow-xs md:grid-cols-[minmax(0,1fr)_300px] md:items-center">
            <div className="max-w-md">
              <p className="text-base font-medium text-foreground">{t("igComments.emptyTitle")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("igComments.emptyBody")}</p>
              <Button className="mt-4" onClick={() => setEditing({ id: null, draft: newDraft() })}>
                <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
                {t("igComments.emptyCta")}
              </Button>
            </div>
            <ConversationPreview draft={newDraft()} account={account} compact />
          </div>
        </Card>
      ) : null}

      {automations.length > 0 ? (
        <div className="space-y-3">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              onEdit={() => setEditing({ id: automation.id, draft: draftFrom(automation) })}
              onToggle={(active) => void toggle(automation, active)}
              onDelete={() => void remove(automation)}
            />
          ))}
        </div>
      ) : null}

      <Editor
        state={editing}
        account={account}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          toast({ title: t("igComments.saved") });
          await load();
        }}
      />
    </div>
  );
}

function PostThumb({ media, size = 36 }: { readonly media?: { thumbnailUrl?: string }; readonly size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]"
      style={{ width: size, height: size }}
    >
      {media?.thumbnailUrl ? (
        // Instagram's CDN, with expiring signed URLs: not something next/image should cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        <HugeiconsIcon icon={InstagramIcon} size={16} strokeWidth={1.75} />
      )}
    </div>
  );
}

/**
 * One comment rule, drawn exactly like a flow card on the tab beside it: the
 * header says what it is and whether it runs, the line under it what fires
 * it and what it sends, then the three counts, and the actions sit in the
 * strip below the panel.
 */
function AutomationCard({
  automation,
  onEdit,
  onToggle,
  onDelete,
}: {
  readonly automation: CommentAutomation;
  readonly onEdit: () => void;
  readonly onToggle: (active: boolean) => void;
  readonly onDelete: () => void;
}) {
  const { t } = useI18n();
  const { stats } = automation;
  const active = automation.status === "active";
  return (
    <Card className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <div className="flex flex-col">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader>
            <PostThumb media={automation.mediaId ? automation.media : undefined} />
            <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <CardTitle className="truncate">{automation.name}</CardTitle>
                <StatusBadge status={automation.status} />
              </div>
              <CardDescription className="line-clamp-1">
                {automation.mediaId ? automation.media?.caption || t("igComments.onePost") : t("igComments.anyPost")}
              </CardDescription>
            </button>
          </CardHeader>

          <CardSeparator />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-xs text-muted-foreground">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={1.75} />
              {automation.keywords.length
                ? automation.keywords.map((keyword) => (
                    <code key={keyword} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground shadow-[var(--shadow-inset)]">
                      {keyword}
                    </code>
                  ))
                : t("igComments.anyComment")}
            </span>
            {automation.publicReplies.length ? (
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={1.75} />
                {t("igComments.flagPublic")}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={SentIcon} size={14} strokeWidth={1.75} />
              {t("igComments.flagDm")}
            </span>
            {automation.requireFollow ? (
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={UserAdd01Icon} size={14} strokeWidth={1.75} />
                {t("igComments.flagFollow")}
              </span>
            ) : null}
          </div>

          <CardSeparator />

          <dl className="grid grid-cols-3 gap-4 px-5 py-3">
            {[
              [t("igComments.statComments"), stats.comments],
              [t("igComments.statDms"), stats.dmsSent],
              [t("igComments.statCompleted"), stats.completed],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0">
                <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                <dd className="font-numeral mt-0.5 text-base font-medium tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          {stats.lastError ? (
            <div className="px-5 pb-4">
              <Alert tone="error" size="sm" role={null}>
                {t("igComments.lastError", { error: stats.lastError })}
              </Alert>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-1 px-2 pt-2 pb-0.5">
          <RowAction icon={PencilEdit01Icon} label={t("igComments.edit")} onClick={onEdit} />
          <RowAction
            icon={active ? PauseIcon : PlayIcon}
            label={active ? t("automations.pause") : t("automations.activate")}
            onClick={() => onToggle(!active)}
          />
          <RowAction icon={Delete01Icon} label={t("igComments.delete")} destructive onClick={onDelete} />
        </div>
      </div>
    </Card>
  );
}

function Field({ label, hint, children, counter }: { readonly label: string; readonly hint?: string; readonly counter?: string; readonly children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
        {label}
        {counter ? <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{counter}</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/**
 * One step of the sequence the commenter goes through. The steps are an
 * ordered list joined by a rail, so the form reads in the same order as the
 * conversation beside it; a step switched off keeps its place, dimmed.
 */
function Step({
  index,
  title,
  description,
  aside,
  off,
  last,
  children,
}: {
  readonly index: number;
  readonly title: string;
  readonly description?: string;
  readonly aside?: React.ReactNode;
  readonly off?: boolean;
  readonly last?: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4">
      {!last ? <span aria-hidden="true" className="absolute top-9 bottom-1 left-3.5 w-px -translate-x-1/2 bg-border" /> : null}
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors",
          off ? "border-dashed border-border text-muted-foreground" : "border-border bg-muted text-foreground shadow-[var(--shadow-inset)]",
        )}
      >
        {index}
      </span>
      <div className={cn("min-w-0 space-y-3", last ? "pb-1" : "pb-8")}>
        <div className="flex items-start justify-between gap-4 pt-1">
          <div className="min-w-0">
            <h3 className={cn("text-sm font-medium", off ? "text-muted-foreground" : "text-foreground")}>{title}</h3>
            {description ? <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
          </div>
          {aside ? <div className="shrink-0 pt-px">{aside}</div> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function KeywordInput({ value, onChange }: { readonly value: string[]; readonly onChange: (next: string[]) => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState("");
  const add = (raw: string) => {
    const words = raw.split(",").map((word) => word.trim()).filter(Boolean);
    if (!words.length) return;
    const lower = new Set(value.map((word) => word.toLowerCase()));
    onChange([...value, ...words.filter((word) => !lower.has(word.toLowerCase()))].slice(0, 20));
    setPending("");
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/30">
      {value.map((word) => (
        <span key={word} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {word}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("igComments.removeKeyword", { word })}
            onClick={() => onChange(value.filter((item) => item !== word))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={pending}
        onChange={(event) => setPending(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(pending);
          } else if (event.key === "Backspace" && !pending && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(pending)}
        placeholder={value.length ? "" : t("igComments.keywordsPlaceholder")}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function MediaPicker({ draft, onPick }: { readonly draft: Draft; readonly onPick: (media: Media | null) => void }) {
  const { t } = useI18n();
  const [media, setMedia] = useState<Media[] | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [open, setOpen] = useState(Boolean(draft.mediaId));

  useEffect(() => {
    if (!open || media) return;
    void fetchJson<{ media: Media[] }>("/api/instagram/media", t).then((result) => {
      if (result.ok) setMedia(result.data.media);
      else setError(result.error);
    });
  }, [open, media, t]);

  return (
    <div className="space-y-3">
      <SlidingTabs
        value={open || draft.mediaId ? "one" : "any"}
        onValueChange={(next) => {
          if (next === "one") {
            setOpen(true);
            return;
          }
          setOpen(false);
          onPick(null);
        }}
        tabs={[
          { id: "any", label: t("igComments.allPosts") },
          { id: "one", label: t("igComments.choosePost") },
        ]}
      />
      {open ? (
        error ? (
          <p className="text-xs text-[color:var(--status-failed-fg)]">{uiErrorMessage(t, error)}</p>
        ) : !media ? (
          <div className="grid grid-cols-4 gap-2 @min-[480px]/ig-editor:grid-cols-6" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonBar key={index} className="aspect-square h-auto w-full rounded-lg" />
            ))}
          </div>
        ) : media.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("igComments.noPosts")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 @min-[480px]/ig-editor:grid-cols-6">
            {media.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.caption}
                onClick={() => onPick(item)}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-lg border-2 transition",
                  draft.mediaId === item.id ? "border-foreground" : "border-transparent opacity-80 hover:opacity-100",
                )}
              >
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt={item.caption ?? ""} referrerPolicy="no-referrer" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center bg-muted text-muted-foreground">
                    <HugeiconsIcon icon={Image01Icon} size={16} strokeWidth={1.75} />
                  </span>
                )}
                {draft.mediaId === item.id ? (
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                    <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function Editor({
  state,
  account,
  onClose,
  onSaved,
}: {
  readonly state: { id: string | null; draft: Draft } | null;
  readonly account: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(state?.draft ?? null);
  // What the drawer shows: the last opened rule, kept while it slides out.
  const [shown, setShown] = useState(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setShown(state);
    setDraft(state.draft);
    setError(null);
  }, [state]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  const save = async () => {
    if (!shown || !draft) return;
    setSaving(true);
    const result = await fetchJson<{ automation: CommentAutomation }>(
      shown.id ? `/api/instagram/comment-automations/${shown.id}` : "/api/instagram/comment-automations",
      t,
      { method: shown.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inputFrom(draft)) },
    );
    setSaving(false);
    if (result.ok) await onSaved();
    else setError(uiErrorMessage(t, result.error));
  };

  const count = (value: string, max: number) => `${value.length}/${max}`;

  return (
    <Drawer open={Boolean(state)} onOpenChange={(open) => (!open && !saving ? onClose() : undefined)} panelClassName="max-w-5xl">
      <DrawerContent className="max-w-5xl">
        <DrawerHeader className="pr-12">
          <DrawerTitle icon={<HugeiconsIcon icon={InstagramIcon} size={18} strokeWidth={1.75} />}>
            {shown?.id ? t("igComments.editTitle") : t("igComments.newTitle")}
          </DrawerTitle>
          <DrawerDescription>{t("igComments.editorDescription")}</DrawerDescription>
        </DrawerHeader>
        {/* The panel's own width decides the two columns, not the viewport:
            the drawer is narrower than the window it opens in. */}
        <DrawerBody className="@container/ig-editor min-h-0 p-0">
          {draft ? (
            <div className="grid @min-[760px]/ig-editor:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
              <div className="min-w-0 space-y-8 p-5 @min-[760px]/ig-editor:p-6">
                <Field label={t("igComments.name")}>
                  <Input value={draft.name} maxLength={80} onChange={(event) => set("name", event.target.value)} />
                </Field>

                <ol>
                  <Step index={1} title={t("igComments.stepPost")} description={t("igComments.stepPostHint")}>
                    <MediaPicker
                      draft={draft}
                      onPick={(media) =>
                        setDraft((current) =>
                          current
                            ? media
                              ? { ...current, mediaId: media.id, media: { caption: media.caption, thumbnailUrl: media.thumbnailUrl, permalink: media.permalink } }
                              : { ...current, mediaId: null, media: undefined }
                            : current,
                        )
                      }
                    />
                  </Step>

                  <Step index={2} title={t("igComments.stepKeywords")} description={t("igComments.stepKeywordsHint")}>
                    <KeywordInput value={draft.keywords} onChange={(next) => set("keywords", next)} />
                  </Step>

                  <Step
                    index={3}
                    title={t("igComments.stepPublic")}
                    description={t("igComments.stepPublicHint")}
                    off={!draft.publicReplyOn}
                    aside={<Switch checked={draft.publicReplyOn} onCheckedChange={(value) => set("publicReplyOn", value)} label={t("igComments.stepPublic")} />}
                  >
                    {draft.publicReplyOn ? (
                      <Textarea rows={3} value={draft.publicReplies} onChange={(event) => set("publicReplies", event.target.value)} />
                    ) : null}
                  </Step>

                  <Step index={4} title={t("igComments.stepDm")} description={t("igComments.stepDmHint")}>
                    <Field label={t("igComments.openingMessage")} counter={count(draft.openingMessage, MAX_TEXT)}>
                      <Textarea rows={3} maxLength={MAX_TEXT} value={draft.openingMessage} onChange={(event) => set("openingMessage", event.target.value)} />
                    </Field>
                    <Field label={t("igComments.buttonLabel")} counter={count(draft.buttonLabel, MAX_BUTTON)}>
                      <Input maxLength={MAX_BUTTON} value={draft.buttonLabel} onChange={(event) => set("buttonLabel", event.target.value)} />
                    </Field>
                  </Step>

                  <Step
                    index={5}
                    title={t("igComments.stepFollow")}
                    description={t("igComments.stepFollowHint")}
                    off={!draft.requireFollow}
                    aside={<Switch checked={draft.requireFollow} onCheckedChange={(value) => set("requireFollow", value)} label={t("igComments.stepFollow")} />}
                  >
                    {draft.requireFollow ? (
                      <>
                        <Field label={t("igComments.followMessage")} counter={count(draft.followMessage, MAX_TEXT)}>
                          <Textarea rows={2} maxLength={MAX_TEXT} value={draft.followMessage} onChange={(event) => set("followMessage", event.target.value)} />
                        </Field>
                        <Field label={t("igComments.followButtonLabel")} counter={count(draft.followButtonLabel, MAX_BUTTON)}>
                          <Input maxLength={MAX_BUTTON} value={draft.followButtonLabel} onChange={(event) => set("followButtonLabel", event.target.value)} />
                        </Field>
                      </>
                    ) : null}
                  </Step>

                  <Step index={6} title={t("igComments.stepFinal")} description={t("igComments.stepFinalHint")} last>
                    <Field label={t("igComments.finalMessage")} counter={count(draft.finalMessage, MAX_TEXT)}>
                      <Textarea rows={3} maxLength={MAX_TEXT} value={draft.finalMessage} onChange={(event) => set("finalMessage", event.target.value)} />
                    </Field>
                  </Step>
                </ol>
              </div>

              <aside
                aria-label={t("igComments.preview")}
                className="border-t border-border/60 bg-muted/30 p-5 @min-[760px]/ig-editor:border-t-0 @min-[760px]/ig-editor:border-l @min-[760px]/ig-editor:p-6"
              >
                <div className="@min-[760px]/ig-editor:sticky @min-[760px]/ig-editor:top-6">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">{t("igComments.preview")}</p>
                  <ConversationPreview draft={draft} account={account} />
                </div>
              </aside>
            </div>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          {error ? <p className="mr-auto text-xs text-[color:var(--status-failed-fg)]">{error}</p> : null}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("igComments.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={15} strokeWidth={2} /> : null}
            {t("igComments.save")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// Instagram's own outgoing bubble: the violet-to-blue of its direct messages.
const OUTGOING = "bg-[linear-gradient(135deg,#a033ff_0%,#6a3bf5_55%,#4f5bf2_100%)] text-white";

function Avatar({ name, size = 32, customer }: { readonly name: string; readonly size?: number; readonly customer?: boolean }) {
  return customer ? (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" style={{ width: size, height: size }}>
      <HugeiconsIcon icon={UserIcon} size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-foreground font-semibold text-background uppercase"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1) || "@"}
    </span>
  );
}

/** One comment row, laid out the way Instagram lays it out. */
function CommentRow({ name, text, customer, reply }: { readonly name: string; readonly text: string; readonly customer?: boolean; readonly reply?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={name} customer={customer} size={reply ? 24 : 32} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug break-words text-foreground">
          <span className="font-semibold">{name}</span> {text}
        </p>
        <p className="mt-1 flex gap-3 text-[11px] font-medium text-muted-foreground">
          <span>{t("igComments.previewTime")}</span>
          <span>{t("igComments.previewReply")}</span>
        </p>
      </div>
      <HugeiconsIcon icon={FavouriteIcon} size={12} strokeWidth={1.75} className="mt-1.5 shrink-0 text-muted-foreground" />
    </div>
  );
}

/** A message from the account, with or without the button Meta attaches. */
function IncomingMessage({ account, text, button }: { readonly account: string; readonly text: string; readonly button?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Avatar name={account} size={22} />
      {button === undefined ? (
        <p className="max-w-[82%] rounded-[18px] bg-muted px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words text-foreground">{text || "…"}</p>
      ) : (
        <div className="w-[82%] rounded-[18px] bg-muted p-1.5">
          <p className="px-2 pt-1 pb-2 text-[13px] leading-snug font-semibold whitespace-pre-wrap break-words text-foreground">{text || "…"}</p>
          <p className="truncate rounded-[11px] bg-background/70 px-3 py-2 text-center text-[13px] font-semibold text-foreground dark:bg-foreground/10">
            {button || "…"}
          </p>
        </div>
      )}
    </div>
  );
}

function OutgoingMessage({ text }: { readonly text: string }) {
  return (
    <div className="flex justify-end">
      <p className={cn("max-w-[78%] rounded-[18px] px-3 py-2 text-[13px] leading-snug break-words", OUTGOING)}>{text || "…"}</p>
    </div>
  );
}

/**
 * What the commenter sees, in order, as the owner writes it: the comments
 * sheet under the post, then the private conversation. Both copy Instagram's
 * own layout — the reply nested under the comment with the account's name,
 * the context line Meta prints above a comment reply, and the button inside
 * the message card — so what the owner checks here is what arrives.
 */
function ConversationPreview({ draft, account, compact }: { readonly draft: Draft; readonly account: string | null; readonly compact?: boolean }) {
  const { t } = useI18n();
  const handle = account || t("igComments.previewYou");
  const keyword = draft.keywords[0] ?? t("igComments.previewAnyComment");
  const publicReply = useMemo(() => draft.publicReplies.split("\n").map((line) => line.trim()).find(Boolean), [draft.publicReplies]);
  const frame = "overflow-hidden rounded-[22px] border border-border bg-background shadow-[var(--shadow-float)]";
  return (
    <div className={cn("space-y-3", compact && "pointer-events-none select-none")} aria-hidden={compact ? true : undefined}>
      <div className={frame}>
        <div className="border-b border-border/70 px-4 pt-2 pb-2.5 text-center">
          <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-8 rounded-full bg-border" />
          <p className="text-[13px] font-semibold text-foreground">{t("igComments.previewComments")}</p>
        </div>
        <div className="space-y-3 p-4">
          <CommentRow name={t("igComments.previewUser")} text={keyword} customer />
          {draft.publicReplyOn && publicReply ? (
            <div className="pl-[42px]">
              <CommentRow name={handle} text={publicReply} reply />
            </div>
          ) : null}
        </div>
      </div>

      <div className={frame}>
        <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-2.5">
          <Avatar name={handle} size={28} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">{handle}</p>
            <p className="text-[11px] text-muted-foreground">{t("igComments.previewBusinessChat")}</p>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <p className="px-2 text-center text-[11px] leading-snug text-muted-foreground">
            {/* The account's name is bold inside Meta's sentence, wherever the language puts it. */}
            {t("igComments.previewContext", { account: "\u0000" })
              .split("\u0000")
              .flatMap((part, index) => (index === 0 ? [part] : [<span key={index} className="font-semibold text-foreground">{handle}</span>, part]))}{" "}
            <span className="font-semibold text-foreground">{t("igComments.previewSeePost")}</span>
          </p>
          <IncomingMessage account={handle} text={draft.openingMessage} button={draft.buttonLabel} />
          {!compact ? (
            <>
              <OutgoingMessage text={draft.buttonLabel} />
              {draft.requireFollow ? (
                <>
                  <IncomingMessage account={handle} text={draft.followMessage} button={draft.followButtonLabel} />
                  <OutgoingMessage text={draft.followButtonLabel} />
                </>
              ) : null}
              <IncomingMessage account={handle} text={draft.finalMessage} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
