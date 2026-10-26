"use client";

import "../product.css";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowLeft01Icon, ArrowRight01Icon, Delete01Icon, DocumentAttachmentIcon, PinIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { ChannelIcon } from "../../_components/channel-badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { ChatsSkeleton, SkeletonBar } from "@/components/ai-elements/skeleton";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { ProductFigure } from "@/components/hairline/product-figure";
import { LoadingRegion } from "@/components/product-loading";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useI18n, useT } from "@/lib/i18n/provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { fullTime, relativeTime } from "@/lib/format";
import { chatTitle, deleteChat, getChats, mergeChats, saveConversation } from "@/lib/dashboard-store";
import { eveChatStorageKey, useBrowserStorageScope } from "@/lib/browser-storage-scope";
import { clearOpenChat, openSessionId, stageChatSession } from "@/lib/chat-session-stage";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import type { ChannelConversation, ChannelId, ChatHistoryEntry } from "@/lib/types";

const PAGE_SIZE = 20;
const CHANNELS: readonly (ChannelId | "all")[] = ["all", "web", "whatsapp", "instagram"];
const keyOf = (chat: ChatHistoryEntry) => chat.sessionId ?? chat.id;

export default function ChatsPage() {
  return <Suspense fallback={<LoadingRegion className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"><ChatsSkeleton /></LoadingRegion>}><History /></Suspense>;
}

function History() {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const storageScope = useBrowserStorageScope();
  const chatStorageKey = eveChatStorageKey(storageScope);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const [chats, setChats] = useState<ChatHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const search = params.get("q") ?? "";
  const channel = params.get("channel");
  const filter = CHANNELS.includes(channel as ChannelId) ? channel as ChannelId : "all";
  const selectedKey = params.get("conversation");
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const selected = chats.find((chat) => keyOf(chat) === selectedKey);

  // Native history updates Next's URL hooks without fetching the route on each
  // keystroke. Opening a conversation adds a Back-button entry.
  const navigate = (updates: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    const url = `/history${next.size ? `?${next}` : ""}`;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  const refresh = useCallback(async () => {
    const result = await fetchJson<{ chats: ChatHistoryEntry[] }>("/api/history", t);
    if (result.ok) {
      const server = new Map(result.data.chats.map((chat) => [keyOf(chat), chat]));
      setChats(mergeChats(getChats(storageScope), result.data.chats).map((chat) => {
        const entry = server.get(keyOf(chat));
        return entry ? { ...chat, conversationId: entry.conversationId,
          contactId: entry.contactId, contactStatus: entry.contactStatus,
          contactName: entry.contactName, contactAddress: entry.contactAddress,
          agentName: entry.agentName, pinned: entry.pinned ?? false,
        } : chat;
      }));
      setError(null);
    } else {
      setChats((current) => current.length ? current : getChats(storageScope));
      setError(result.error);
    }
    setLoading(false);
  }, [storageScope, t]);
  usePolling(refresh, 30_000);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return chats.filter((chat) => (filter === "all" || chat.channel === filter) && (!query ||
      [chat.title, chat.contactName, chat.contactAddress, chat.agentName, chat.lastMessage]
        .some((value) => value?.toLocaleLowerCase().includes(query))))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  }, [chats, search, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const titleOf = (chat: ChatHistoryEntry) => chat.channel === "web"
    ? chatTitle(chat) || t("chats.newConversation")
    : chat.contactName || chat.contactAddress || chatTitle(chat) || t(`chats.filter${chat.channel === "whatsapp" ? "WhatsApp" : "Instagram"}`);
  const channelLabel = (id: ChannelId) => t(`chats.filter${id === "web" ? "Web" : id === "whatsapp" ? "WhatsApp" : "Instagram"}`);

  const open = (chat: ChatHistoryEntry) => {
    navigate({ conversation: keyOf(chat) }, true);
    requestAnimationFrame(() => detailHeading.current?.focus());
  };
  const close = () => {
    navigate({ conversation: null });
    requestAnimationFrame(() => selectedKey && rowRefs.current.get(selectedKey)?.focus());
  };
  const pin = async (chat: ChatHistoryEntry) => {
    setBusy(true);
    const result = await fetchJson("/api/contacts", t, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: keyOf(chat), togglePin: true }),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    saveConversation({ ...chat, pinned: !chat.pinned }, storageScope);
    setChats((current) => current.map((item) => keyOf(item) === keyOf(chat) ? { ...item, pinned: !item.pinned } : item));
  };
  // Handing the conversation to a person pauses the agent for this contact;
  // resuming gives it back. Same status the inbox's "Reanudar agente" sets.
  const setAgentPaused = async (chat: ChatHistoryEntry, paused: boolean) => {
    if (!chat.contactId) return;
    setBusy(true);
    const status = paused ? "waiting_human" : "open";
    const result = await fetchJson("/api/contacts", t, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId: chat.contactId, status }),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setChats((current) => current.map((item) => keyOf(item) === keyOf(chat) ? { ...item, contactStatus: status } : item));
    toast({ title: t(paused ? "chats.tookOver" : "chats.resumed"), status: "success" });
  };
  const remove = async (chat: ChatHistoryEntry) => {
    if (!(await confirm({ title: t("chats.confirmDelete"), description: t("chats.deleteDescription") }))) return;
    setBusy(true);
    const result = await fetchJson(`/api/contacts?chatId=${encodeURIComponent(keyOf(chat))}`, t, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    deleteChat(chat.id, storageScope);
    if (chat.sessionId && openSessionId(chatStorageKey) === chat.sessionId) clearOpenChat(chatStorageKey);
    setChats((current) => current.filter((item) => keyOf(item) !== keyOf(chat)));
    close();
    toast({ title: t("common.deleted"), description: t("common.deletedDescription"), status: "success" });
  };

  if (loading) return <LoadingRegion className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"><ChatsSkeleton /></LoadingRegion>;

  const address = selected?.contactAddress && selected.contactAddress !== titleOf(selected) ? selected.contactAddress : null;

  // Laid out the way /calendar, /links and /email-templates are: no page
  // padding and no floating card. A header bar, the conversation rail and
  // the reader, divided by hairlines and reaching every edge under the shell.
  return (
    <div className="content-enter flex h-full min-h-0 flex-col overflow-hidden">
      {confirmDialog}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          {selectedKey ? (
            <button
              type="button"
              onClick={close}
              aria-label={t("chats.backToList")}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:hidden"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          <div className={cn("size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]", selectedKey ? "hidden md:flex" : "flex")}>
            {selected ? <ChannelIcon channel={selected.channel} className="size-[15px]" /> : <HugeiconsIcon icon={DocumentAttachmentIcon} size={15} strokeWidth={1.75} />}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 ref={detailHeading} tabIndex={-1} className="truncate text-lg font-medium tracking-[-0.02em] outline-none">
              {selected ? titleOf(selected) : t("chats.title")}
            </h1>
            {selected ? (
              <span className="pill pill-sm tone-pill tone-expired hidden font-mono tracking-[0.1em] uppercase sm:inline-flex">
                {channelLabel(selected.channel)}
              </span>
            ) : null}
            {address ? <span className="hidden truncate font-mono text-[11px] text-muted-foreground lg:inline">{address}</span> : null}
          </div>

          {selected ? (
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t(selected.pinned ? "chats.unpin" : "chats.pin")} aria-pressed={!!selected.pinned} disabled={busy} onClick={() => void pin(selected)}>
                    <HugeiconsIcon icon={PinIcon} size={16} strokeWidth={1.75} className={selected.pinned ? "text-foreground" : "text-muted-foreground"} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t(selected.pinned ? "chats.unpin" : "chats.pin")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("chats.delete")} disabled={busy} onClick={() => void remove(selected)}>
                    <HugeiconsIcon icon={Delete01Icon} size={16} strokeWidth={1.75} className="text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("chats.delete")}</TooltipContent>
              </Tooltip>
              {selected.channel === "web" && selected.sessionId ? <>
                <span className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" aria-label={t("chats.continueWeb")} className="px-2.5 sm:px-3" onClick={() => { stageChatSession(selected, chatStorageKey); router.push("/chat"); }}>
                  <span className="hidden sm:inline">{t("chats.continueWeb")}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
                </Button>
              </> : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <ErrorBanner
            layout="strip"
            error={error}
            onRetry={() => void refresh()}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label={t("chats.conversations")} className={cn("w-full min-w-0 shrink-0 flex-col border-border bg-card/30 md:flex md:w-80 md:border-r", selectedKey ? "hidden" : "flex")}>
          <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <MicroLabel>{t("chats.conversations")}</MicroLabel>
              <span role="status" className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {t(filtered.length === 1 ? "chats.resultCountOne" : "chats.resultCount", { count: filtered.length })}
              </span>
            </div>
            <div className="relative">
              <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={search}
                placeholder={t("chats.searchPlaceholder")}
                aria-label={t("chats.searchLabel")}
                onChange={(event) => navigate({ q: event.target.value, page: null, conversation: null })}
                className="h-8 w-full rounded-lg border border-border bg-card pr-2.5 pl-7.5 text-sm shadow-[var(--shadow-inset)] transition-colors duration-150 outline-none placeholder:text-muted-foreground focus:border-input"
              />
            </div>
            <SlidingTabs tabs={CHANNELS.map((id) => ({ id, label: id === "all" ? t("chats.filterAll") : channelLabel(id) }))} value={filter} onValueChange={(id) => navigate({ channel: id === "all" ? null : id, page: null, conversation: null })} />
          </div>

          <div className="y-fade min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-hide">
            {filtered.length ? <ul className="flex flex-col gap-0.5">
              {visible.map((chat) => {
                const current = selectedKey === keyOf(chat);
                return <li key={keyOf(chat)}>
                  <button
                    type="button"
                    ref={(node) => { if (node) rowRefs.current.set(keyOf(chat), node); else rowRefs.current.delete(keyOf(chat)); }}
                    onClick={() => open(chat)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-start outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-ring",
                      "transition-[background-color,box-shadow] duration-150 ease-out",
                      current ? "bg-card shadow-[var(--shadow-inset)]" : "hover:bg-accent/60",
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted transition-colors duration-150", current ? "text-foreground" : "text-muted-foreground")}>
                      <ChannelIcon channel={chat.channel} className="size-[15px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-snug", current ? "font-medium text-foreground" : "text-foreground/85")}>{titleOf(chat)}</span>
                        {chat.pinned ? <HugeiconsIcon icon={PinIcon} size={11} strokeWidth={1.75} aria-label={t("chats.pinned")} className="shrink-0 text-muted-foreground" /> : null}
                        <time dateTime={chat.lastMessageAt} title={fullTime(chat.lastMessageAt, locale)} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relativeTime(chat.lastMessageAt, locale)}</time>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">{channelLabel(chat.channel)}{chat.agentName ? ` · ${chat.agentName}` : ""}</span>
                      <span className="mt-0.5 line-clamp-2 block break-words text-[11px] leading-snug text-muted-foreground">{chat.lastMessage || t("chats.noMessages")}</span>
                    </span>
                  </button>
                </li>;
              })}
            </ul> : <div className="flex flex-col items-center px-4 py-8 text-center">
              <ProductFigure kind="empty-archive" className="mb-3 w-28" />
              <p className="text-sm font-medium">{t("chats.noResults")}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{search ? t("chats.noResultsSearch") : t("chats.noChatsInChannel")}</p>
              {search || filter !== "all" ? <Button className="mt-4" size="sm" variant="outline" onClick={() => navigate({ q: null, channel: null, page: null })}>{t("chats.clearFilters")}</Button> : null}
            </div>}
          </div>

          {pageCount > 1 ? <nav aria-label={t("chats.pages")} className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-2 py-1.5">
            <Button variant="ghost" size="icon" aria-label={t("chats.previousPage")} disabled={currentPage === 1} onClick={() => navigate({ page: String(currentPage - 1) })}><HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} /></Button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{currentPage} / {pageCount}</span>
            <Button variant="ghost" size="icon" aria-label={t("chats.nextPage")} disabled={currentPage === pageCount} onClick={() => navigate({ page: String(currentPage + 1) })}><HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.75} /></Button>
          </nav> : null}
        </aside>

        <section aria-label={t("chats.detail")} className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", selectedKey ? "flex" : "hidden")}>
          {selected ? <div key={keyOf(selected)} className="content-enter flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-2">
              {selected.channel !== "web" && selected.contactId ? <div className="flex min-w-48 flex-1 items-center gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  {t(selected.contactStatus === "waiting_human" ? "chats.teammateHandling" : "chats.agentHandling")}
                </p>
                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" disabled={busy}
                  onClick={() => void setAgentPaused(selected, selected.contactStatus !== "waiting_human")}>
                  {t(selected.contactStatus === "waiting_human" ? "chats.resumeAgent" : "chats.takeOver")}
                </Button>
              </div> : <p className="min-w-48 flex-1 truncate text-xs text-muted-foreground">{t("chats.readOnly")}</p>}
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {address ? <span className="font-mono lg:hidden">{address} · </span> : null}
                <time dateTime={selected.lastMessageAt}>{fullTime(selected.lastMessageAt, locale)}</time>
                {selected.agentName ? ` · ${selected.agentName}` : ""}
              </p>
            </div>
            <HistoryTranscript chat={selected} onReplied={() => {
              setChats((current) => current.map((item) => keyOf(item) === keyOf(selected) ? { ...item, contactStatus: "waiting_human" } : item));
              void refresh();
            }} />
          </div> : <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
            <ProductFigure kind="archive" className="mb-4 w-44 max-w-full" />
            <h2 className="text-sm font-medium">{t(selectedKey ? "chats.unavailable" : "chats.selectConversation")}</h2>
            <p className="mt-1.5 max-w-[38ch] text-[12px] leading-relaxed text-muted-foreground">{t(selectedKey ? "chats.unavailableDescription" : "chats.selectDescription")}</p>
            {selectedKey ? <Button className="mt-4" size="sm" variant="outline" onClick={close}>{t("chats.backToList")}</Button> : null}
          </div>}
        </section>
      </div>
    </div>
  );
}

function MicroLabel({ children }: { readonly children: ReactNode }) {
  return <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{children}</span>;
}

function HistoryTranscript({ chat, onReplied }: { readonly chat: ChatHistoryEntry; readonly onReplied: () => void }) {
  const t = useT();
  const [conversation, setConversation] = useState<ChannelConversation | null>(null);
  const [loading, setLoading] = useState(!!chat.conversationId);
  const [error, setError] = useState<UiError | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!chat.conversationId) return;
    const result = await fetchJson<{ conversation: ChannelConversation }>(`/api/conversations/${encodeURIComponent(chat.conversationId)}`, t);
    if (!alive.current) return;
    if (result.ok) { setConversation(result.data.conversation); setError(null); }
    else setError(result.error);
    setLoading(false);
  }, [chat.conversationId, t]);
  usePolling(load, 5_000, !!chat.conversationId);
  return <div className="y-fade min-h-0 flex-1 overflow-y-auto scrollbar-hide" aria-busy={loading}>
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
      <ErrorBanner error={error} onRetry={() => void load()} />
      {loading ? <div role="status" aria-label={t("chats.loadingMessages")} className="space-y-5"><SkeletonBar className="ms-auto h-16 w-2/3 rounded-2xl" /><SkeletonBar className="h-24 w-4/5 rounded-2xl" /></div>
        : conversation?.turns.length ? <ol className="space-y-5">
          {conversation.turns.map((turn, index) => <li key={index} className={cn("flex flex-col", turn.role === "user" ? "items-end" : "items-start")}>
            <p className="mb-1.5 text-[11px] text-muted-foreground">{turn.role === "user" ? t(chat.channel === "web" ? "chats.you" : "chats.contact") : turn.human ? t("chats.teammate") : turn.agentName || t("chats.agent")}</p>
            <div className={cn("max-w-full break-words rounded-2xl px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere] sm:max-w-[90%]", turn.role === "user" ? "bg-muted" : "w-full")}>
              {turn.role === "assistant" ? <MessageResponse>{turn.content}</MessageResponse> : <p className="whitespace-pre-wrap">{turn.content}</p>}
            </div>
          </li>)}
        </ol> : !error ? <div className="space-y-4 py-6">
          <p className="text-sm text-muted-foreground">{t("chats.transcriptUnavailable")}</p>
          {chat.lastMessage ? <blockquote className="whitespace-pre-wrap break-words rounded-xl bg-muted p-4 text-sm leading-6 [overflow-wrap:anywhere]"><p className="mb-2 text-xs text-muted-foreground">{t("chats.lastMessage")}</p>{chat.lastMessage}</blockquote> : null}
        </div> : null}
    </div>
    {chat.channel !== "web" && chat.contactId && chat.conversationId ? (
      <ReplyComposer conversationId={chat.conversationId} onSent={() => { void load(); onReplied(); }} />
    ) : null}
  </div>;
}

/** A person on the team writes to the customer on their own channel. */
function ReplyComposer({ conversationId, onSent }: { readonly conversationId: string; readonly onSent: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const result = await fetchJson(`/api/conversations/${encodeURIComponent(conversationId)}/reply`, t, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: message }),
    });
    setSending(false);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setText("");
    onSent();
  };
  return <form className="shrink-0 border-t border-border bg-card/40 px-4 py-3 sm:px-6"
    onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <div className="mx-auto w-full max-w-3xl space-y-2">
      <ErrorBanner error={error} onRetry={() => void send()} />
      <label htmlFor={`reply-${conversationId}`} className="sr-only">{t("chats.replyLabel")}</label>
      <Textarea id={`reply-${conversationId}`} value={text} rows={2} maxLength={4000}
        placeholder={t("chats.replyPlaceholder")} disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
        }} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">{t("chats.replyHint")}</p>
        <Button type="submit" size="sm" disabled={!text.trim() || sending}>{t(sending ? "chats.replySending" : "chats.replySend")}</Button>
      </div>
    </div>
  </form>;
}
