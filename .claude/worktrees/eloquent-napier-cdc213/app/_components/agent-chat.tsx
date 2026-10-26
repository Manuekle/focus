"use client";

import {
  Client,
  type ClientAuth,
  type ClientSession,
  type HandleMessageStreamEvent,
  isCurrentTurnBoundaryEvent,
  type SessionState,
} from "eve/client";
import { useEveAgent } from "eve/react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { useSound } from "@/components/sound-provider";
import { Add01Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { type FormEvent, type ReactNode, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { useI18n, useT } from "@/lib/i18n/provider";
import { toolModeContext } from "@/lib/chat-tool-modes";
import { mentionedAgentContext } from "@/lib/chat-agent-context";
import { cn } from "@/lib/utils";
import { saveConversation } from "@/lib/dashboard-store";
import { dailyGreeting } from "@/lib/chat-greeting";
import type { AgentInputResponse } from "./agent-message";
import {
  PaymentEventsContext,
  paymentAmount,
  paymentPaidContext,
  type ChatPayment,
} from "@/components/agents/payment-events";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  ModelPicker,
  ProviderStatusBadge,
  useModelCatalog,
} from "@/components/ai-elements/model-picker";
import { SuggestionChip } from "@/components/ui/suggestion-chip";
import { AgentLoading, type AgentLoadingMode } from "./chat/agent-loading";
import { useLoadingHold } from "@/lib/hooks/use-loading-hold";
import { ChatInput, type ChatInputSubmitPayload } from "./chat/chat-input";
import { restoreEveChat, isSessionOwnershipError, type SavedEveChat } from "@/lib/eve-chat-restore";
import { loadSessionAnswers, saveSessionAnswers, type SessionAnswers } from "@/lib/chat-input-answers";
import { conversationMovedOn, inputRequestPhase, type InputAnswer } from "@/lib/chat-input-request";
import type { EveDynamicToolPart, EveMessage } from "eve/react";
import {
  consumeOnboardingChatDraft,
  eveChatStorageKey,
  NEW_CHAT_EVENT,
  useBrowserStorageScope,
} from "@/lib/browser-storage-scope";

// Formatting, diagrams and artifacts load with the first actual message,
// rather than delaying an empty chat and its input.
const AgentMessage = lazy(() => import("./agent-message").then((module) => ({ default: module.AgentMessage })));

const AGENT_NAME = "oruka";
/** How long a tab keeps following a turn it lost the stream of. A step can take
 *  minutes (a long report, a slow subagent); a turn that is still silent after
 *  this is better retried by hand than listened to forever. */
const FOLLOW_BUDGET_MS = 10 * 60 * 1000;
const MONITORING_HREF = process.env.NEXT_PUBLIC_MONITORING_URL;
const PROMPT_TABS: readonly { id: string; label: string; prompts: readonly string[] }[] = [
  {
    id: "chat",
    label: "chat.tabChat",
    prompts: ["chat.promptChat1", "chat.promptChat2", "chat.promptChat3"],
  },
  {
    id: "automate",
    label: "chat.tabAutomate",
    prompts: ["chat.promptAutomate1", "chat.promptAutomate2", "chat.promptAutomate3"],
  },
  {
    id: "analyze",
    label: "chat.tabAnalyze",
    prompts: ["chat.promptAnalyze1", "chat.promptAnalyze2", "chat.promptAnalyze3"],
  },
];

type AgentStatus = ReturnType<typeof useEveAgent>["status"];
export type AgentAuthMode = "basic" | "local" | "session" | "misconfigured";

type BasicCredentials = {
  readonly password: string;
  readonly username: string;
};

type MessageLike = {
  readonly role: string;
  readonly parts: readonly { readonly type: string; readonly text?: string }[];
};

/**
 * The conversation's name for the history list, or "" when nothing has been
 * said that could name it.
 *
 * Empty rather than a written-out "New conversation": the title is persisted,
 * and a sentence frozen into the store keeps the language it was saved in —
 * the row would still read "Nueva conversación" after switching to English.
 * `chatTitle` reads a blank title as unnamed and each list supplies its own
 * localized fallback.
 */
function deriveTitle(messages: readonly MessageLike[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser?.parts.find((p) => p.type === "text")?.text?.trim();
  if (!text) return "";
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}

function deriveLastMessage(messages: readonly MessageLike[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return "";
  const textPart = lastAssistant.parts.find((p) => p.type === "text");
  const text = textPart?.text ?? "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function Pill({
  children,
  href,
  title,
}: {
  readonly children: ReactNode;
  readonly href?: string;
  readonly title?: string;
}) {
  const className =
    "inline-flex items-center rounded-md border border-[var(--btn-outline-border)] bg-card/50 px-2.5 py-0.5 font-medium text-muted-foreground text-xs shadow-[var(--shadow-inset)] transition-[background-color,border-color,color] duration-150 hover:text-foreground";
  if (href) {
    return (
      <a
        className={cn(className, "hover:bg-accent")}
        href={href}
        rel="noreferrer"
        target="_blank"
        title={title}
      >
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

export function AgentChat({ authMode }: { readonly authMode: AgentAuthMode }) {
  const [credentials, setCredentials] = useState<BasicCredentials>();
  const storageScope = useBrowserStorageScope();

  if (authMode === "misconfigured") {
    return <AuthConfigurationError />;
  }

  if (authMode === "basic" && !credentials) {
    return <BasicAuthForm onAuthenticated={setCredentials} />;
  }

  const auth: ClientAuth | undefined = credentials
    ? { basic: { username: credentials.username, password: credentials.password } }
    : undefined;

  return (
    <AgentSession
      auth={auth}
      onSignOut={credentials ? () => setCredentials(undefined) : undefined}
      storageScope={storageScope}
    />
  );
}

function AgentSession({
  auth,
  onSignOut,
  storageScope,
}: {
  readonly auth?: ClientAuth;
  readonly onSignOut?: () => void;
  readonly storageScope: string;
}) {
  const storageKey = eveChatStorageKey(storageScope);
  const [saved, setSaved] = useState<SavedEveChat>();
  const showLoading = useLoadingHold(saved === undefined);
  const [resetKey, setResetKey] = useState(0);
  // Start with "connecting" on both server and client to avoid hydration mismatch.
  // After hydration, check localStorage to see if we're restoring a saved session.
  const [loadingMode, setLoadingMode] = useState<AgentLoadingMode>("connecting");

  useEffect(() => {
    const saved = loadSavedChat(storageKey);
    if (saved.session?.sessionId) {
      setLoadingMode("restoring");
    }
  }, [storageKey]);

  useEffect(() => {
    const controller = new AbortController();
    void restoreSavedChat(auth, controller.signal, storageKey).then((restored) => {
      // A cancelled restore still resolves, and in development it resolves
      // *second*: React mounts every effect, tears it down and mounts it
      // again, so the aborted first pass finishes after the real one and hands
      // the UI its empty result last. That is what emptied the chat when a
      // conversation was opened from the history list — the events were in
      // storage the whole time, and a manual reload brought them back.
      if (controller.signal.aborted) return;
      setSaved(restored);
    });
    return () => controller.abort();
  }, [auth, resetKey, storageKey]);

  // The sidebar's "new chat" is a link to `/chat`: clicking it while already
  // there navigates nowhere, so it dispatches NEW_CHAT_EVENT instead and the
  // live session resets here — same clearing `handleNewChat` does, plus a
  // remount so the composer, model choice and refs start fresh.
  useEffect(() => {
    const onNewChat = () => {
      clearSavedChat(storageKey);
      setSaved({});
      setResetKey((k) => k + 1);
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, [storageKey]);

  // Stable, because the follow effect in ConnectedAgentSession depends on it
  // and a new identity per render would restart the stream it is reading.
  const handleReattach = useCallback((restored: SavedEveChat) => {
    setSaved(restored);
    setResetKey((k) => k + 1);
  }, []);

  if (showLoading || !saved) {
    return <AgentLoading mode={loadingMode} />;
  }

  return (
    <ConnectedAgentSession
      auth={auth}
      key={resetKey}
      onReattach={handleReattach}
      onSignOut={onSignOut}
      onReset={() => {
        clearSavedChat(storageKey);
        setSaved({});
        setResetKey((k) => k + 1);
      }}
      saved={saved}
      storageKey={storageKey}
      storageScope={storageScope}
    />
  );
}

function ConnectedAgentSession({
  auth,
  onReattach,
  onReset,
  onSignOut,
  saved,
  storageKey,
  storageScope,
}: {
  readonly auth?: ClientAuth;
  /** Remount on a transcript that caught up with the server. */
  readonly onReattach: (restored: SavedEveChat) => void;
  readonly onReset: () => void;
  readonly onSignOut?: () => void;
  readonly saved: SavedEveChat;
  readonly storageKey: string;
  readonly storageScope: string;
}) {
  const { t, locale } = useI18n();
  const [clientSession] = useState(() => {
    const client = new Client({
      host: window.location.origin,
      auth,
      maxReconnectAttempts: 20,
      preserveCompletedSessions: true,
      redirect: "error",
    });
    return client.session(saved.session);
  });
  const eventsRef = useRef<HandleMessageStreamEvent[]>([...(saved.events ?? [])]);
  const sessionRef = useRef<SessionState>(clientSession.state);
  const knownSessionRef = useRef<SessionState | undefined>(
    clientSession.state.sessionId ? clientSession.state : undefined,
  );
  /**
   * eve's client resets the session to empty when a stream ends without a
   * turn boundary — which is exactly what a dropped stream is. Saving that
   * threw the conversation's id away: the tab could not follow the turn still
   * running on the server, a reload came back to half a transcript, and the
   * next message opened a brand-new session. While the transcript is mid-turn,
   * keep the last id this tab knew.
   */
  const rememberSession = (next: SessionState): SessionState => {
    if (next.sessionId) {
      knownSessionRef.current = next;
      return next;
    }
    const last = eventsRef.current.at(-1);
    const known = knownSessionRef.current;
    if (known && last !== undefined && !isCurrentTurnBoundaryEvent(last)) {
      return { ...known, streamIndex: eventsRef.current.length };
    }
    return next;
  };
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = (immediately = false) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const write = () =>
      saveChat(storageKey, { events: eventsRef.current, session: sessionRef.current });
    if (immediately) {
      write();
    } else {
      persistTimerRef.current = setTimeout(write, 100);
    }
  };

  useEffect(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    },
    [],
  );

  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    session: clientSession,
    onEvent(event) {
      eventsRef.current.push(event);
      sessionRef.current = rememberSession(clientSession.state);
      persist();
    },
    onFinish(snapshot) {
      eventsRef.current = [...snapshot.events];
      sessionRef.current = rememberSession(snapshot.session);
      persist(true);
    },
    onSessionChange(session) {
      sessionRef.current = rememberSession(session);
      persist(true);
    },
  });
  const agentBusy = agent.status === "submitted" || agent.status === "streaming";

  // ── Following a turn the browser lost ───────────────────────────────────
  // The turn runs on the server whether or not this tab is listening. Two
  // ways the tab stops listening while it is still going: the stream is cut
  // mid-turn (a proxy timeout, a laptop waking up — Chrome reports it as
  // "network error", which eve's client does not treat as a disconnect and
  // does not retry), or the page is reloaded mid-turn and the restore gives
  // up after a second and a half. Either way the chat used to sit on a dead
  // spinner or a red "La solicitud falló" over a reply that had in fact been
  // written. So: read the session stream from where this transcript stops
  // until the turn ends, then remount on the caught-up transcript.
  const [resumeOnMount] = useState(() => isTurnInFlight(saved));
  const streamDropped = agent.error !== undefined && isStreamDrop(agent.error);
  // Ownership rejection is permanent for this session id (a pre-ownership id
  // with no owner, or another user's session): the fix is a fresh session,
  // never a retry of the dead id.
  const ownershipError =
    agent.error !== undefined && isSessionOwnershipError(agent.error);
  // "unavailable": nothing to follow — the drop happened before the server
  // ever named a session, so the ordinary error is the honest message.
  const [followEnded, setFollowEnded] = useState<"failed" | "unavailable" | null>(null);
  const [followNonce, setFollowNonce] = useState(0);
  const following = !agentBusy && (resumeOnMount || streamDropped) && followEnded === null;
  const offerFollowRetry = (streamDropped || resumeOnMount) && followEnded === "failed";
  const isBusy = agentBusy || following;

  useEffect(() => {
    if (!following) return;
    const session = { ...clientSession.state, ...sessionRef.current };
    if (!session.sessionId) {
      void Promise.resolve().then(() => setFollowEnded("unavailable"));
      return;
    }
    const controller = new AbortController();
    const before = eventsRef.current.length;
    const client = new Client({
      host: window.location.origin,
      auth,
      redirect: "error",
      preserveCompletedSessions: true,
    });
    void restoreEveChat(
      { events: [...eventsRef.current], session },
      client.session(session),
      AbortSignal.any([controller.signal, AbortSignal.timeout(FOLLOW_BUDGET_MS)]),
      (chat) => saveChat(storageKey, chat),
    ).then(
      (restored) => {
        if (controller.signal.aborted) return;
        if ((restored.events?.length ?? 0) > before) onReattach(restored);
        else setFollowEnded("failed");
      },
      (error) => {
        if (controller.signal.aborted) return;
        // Ownership rejection is permanent for this session id (a pre-ownership
        // id with no owner, or another user's session): drop the dead id and
        // remount empty so the next send starts a fresh session.
        if (isSessionOwnershipError(error)) {
          clearSavedChat(storageKey);
          onReattach({});
          return;
        }
        setFollowEnded("failed");
      },
    );
    return () => controller.abort();
    // `followNonce` is the retry button; the rest is stable for this mount.
  }, [following, followNonce, auth, clientSession, onReattach, storageKey]);

  // ── Answers to the agent's questions ────────────────────────────────────
  // Eve keeps a button answer only in its in-memory projection, so a reload or
  // a conversation reopened from Historial forgot it. Kept here per session;
  // see lib/chat-input-request.ts.
  const [answers, setAnswers] = useState<SessionAnswers>(() =>
    loadSessionAnswers(saved.session?.sessionId),
  );
  const pendingQuestion = findPendingQuestion(agent.data.messages, answers);

  // ── Model choice ────────────────────────────────────────────────────────
  const { data: catalog, loading: catalogLoading } = useModelCatalog();
  const [chatModel, setChatModel] = useState<string | null>(null);

  const registerModel = useCallback(
    (model: string | null) => {
      setChatModel(model);
      const sessionId = sessionRef.current.sessionId;
      if (model === null) {
        if (!sessionId) return;
        void fetch(`/api/chat-model?sessionId=${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        }).catch(() => {});
        return;
      }
      void fetch("/api/chat-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, sessionId }),
      }).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    const sessionId = sessionRef.current.sessionId;
    if (!chatModel || !sessionId) return;
    void fetch("/api/chat-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: chatModel, sessionId }),
    }).catch(() => {});
  }, [chatModel, agent.status]);

  const chatHealth = catalog && !chatModel && catalog.chatDefault
    ? { ...catalog, ...catalog.chatDefault } : catalog;

  const modelPicker = (
    <ModelPicker
      models={catalog?.models ?? []}
      value={chatModel}
      onChange={registerModel}
      autoLabel={catalog?.chatDefault?.modelId ?? catalog?.taskResolved?.chat?.modelId ?? catalog?.tasks?.chat}
      loading={catalogLoading}
      disabled={isBusy}
      provider={catalog?.provider ?? "gateway"}
    />
  );

  const isEmpty = agent.data.messages.length === 0;

  const [promptTab, setPromptTab] = useState(PROMPT_TABS[0].id);
  const activePromptTab = PROMPT_TABS.find((t) => t.id === promptTab) ?? PROMPT_TABS[0];
  const [onboardingDraft, setOnboardingDraft] = useState<string>();

  // Read only after hydration, so the server and first client render agree.
  // The draft is consumed once and never becomes part of durable chat state.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setOnboardingDraft(consumeOnboardingChatDraft(storageScope));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [storageScope]);

  // Save conversation summary to dashboard store
  const { cue } = useSound();
  const prevStatusRef = useRef(agent.status);
  useEffect(() => {
    const wasBusy = prevStatusRef.current === "submitted" || prevStatusRef.current === "streaming";
    const isReady = agent.status === "ready";
    if (wasBusy && isReady && agent.data.messages.length > 0) {
      // One cue when the reply has finished streaming — never per token or
      // per tool call, which fire in bursts and wear any sound out.
      cue("ready", { emphasis: "subtle" });
      try {
        const summary = {
          title: deriveTitle(agent.data.messages),
          channel: "web" as const,
          lastMessage: deriveLastMessage(agent.data.messages),
          lastMessageAt: new Date().toISOString(),
          messageCount: agent.data.messages.length,
          sessionId: sessionRef.current.sessionId,
        };
        saveConversation(summary, storageScope);
      } catch {
        // Best-effort
      }
    }
    prevStatusRef.current = agent.status;
  }, [agent.status, agent.data.messages, storageScope, cue]);

  // A turn that failed. A dropped stream is not one: the follow-up below
  // reconnects to the turn still running on the server, and an error cue
  // over a reply that then arrives would be a false alarm.
  const cuedErrorRef = useRef(agent.error);
  useEffect(() => {
    if (!agent.error || agent.error === cuedErrorRef.current) return;
    cuedErrorRef.current = agent.error;
    if (!isStreamDrop(agent.error)) cue("error");
  }, [agent.error, cue]);

  // The agent stopped to ask something and is blocked until it is answered.
  // Seeded with the question already open on mount: a reopened conversation
  // is not news.
  const pendingRequestId = pendingQuestion?.request.requestId;
  const cuedQuestionRef = useRef(pendingRequestId);
  useEffect(() => {
    if (!pendingRequestId || pendingRequestId === cuedQuestionRef.current) return;
    cuedQuestionRef.current = pendingRequestId;
    cue("attention", { emphasis: "subtle" });
  }, [pendingRequestId, cue]);

  const sendTurn = agent.send;
  const send = useCallback(async (input: Parameters<typeof sendTurn>[0]) => {
    const result = sendTurn(input);
    void persistSessionWhenAccepted(clientSession, eventsRef, sessionRef, storageKey);
    await result;
  }, [clientSession, sendTurn, storageKey]);
  const recordAnswers = useCallback((responses: readonly AgentInputResponse[]) => {
    const recorded: Record<string, InputAnswer> = {};
    for (const response of responses) {
      recorded[response.requestId] = {
        ...(response.optionId ? { optionId: response.optionId } : {}),
        ...(response.text ? { text: response.text } : {}),
      };
    }
    setAnswers((current) => ({ ...current, ...recorded }));
    const sessionId = sessionRef.current.sessionId;
    if (sessionId) saveSessionAnswers(sessionId, recorded);
  }, []);
  const handleInputResponses = useCallback(
    async (inputResponses: readonly AgentInputResponse[], message?: string) => {
      recordAnswers(inputResponses);
      await send(message ? { inputResponses, message } : { inputResponses });
    },
    [recordAnswers, send],
  );

  // ── A payment confirmed in the transcript ───────────────────────────────
  // On WhatsApp the agent thanks a buyer the moment the processor confirms;
  // in this chat the checkout is right here, so the chat itself takes the
  // turn: the person's words, plus the payment as one-turn context the agent
  // verifies with payment_status before believing it. Queued while a reply is
  // still streaming, sent once the agent is free.
  const paidQueueRef = useRef<ChatPayment[]>([]);
  const [paidTick, setPaidTick] = useState(0);
  const onPaymentPaid = useCallback((payment: ChatPayment) => {
    paidQueueRef.current.push(payment);
    setPaidTick((tick) => tick + 1);
  }, []);
  const paymentEvents = useMemo(() => ({ onPaid: onPaymentPaid }), [onPaymentPaid]);
  useEffect(() => {
    if (isBusy) return;
    const payment = paidQueueRef.current.shift();
    if (!payment) return;
    void send({
      message: t("payment.paidMessage"),
      clientContext: [paymentPaidContext(payment, paymentAmount(payment, locale))],
    });
  }, [paidTick, isBusy, send, t, locale]);

  const handleInputSubmit = async (payload: ChatInputSubmitPayload) => {
    const text = payload.text.trim();
    if ((!text && payload.files.length === 0) || isBusy) return;

    // Convert any attached files to base64 Data URLs
    const fileParts = await Promise.all(
      payload.files.map(async (file) => {
        const dataUrl = await fileToDataUrl(file);
        return {
          type: "file" as const,
          mediaType: file.type || "application/octet-stream",
          data: dataUrl,
          filename: file.name,
        };
      }),
    );

    // One-turn context: the @mention, the Tools-menu mode, or both. The mode
    // used to be collected by the composer and dropped here, which made the
    // whole menu decorative — see lib/chat-tool-modes.ts.
    const contextParts = [
      mentionedAgentContext(payload.mentionedAgent),
      toolModeContext(payload.toolMode),
    ].filter((part): part is string => Boolean(part));
    const clientContext = contextParts.length > 0 ? contextParts : undefined;

    // Typing the answer to an open question instead of clicking it: eve resolves
    // a reply that names an option on its own, but only the click used to be
    // remembered, so the card forgot what was chosen. Record the match too.
    if (pendingQuestion && fileParts.length === 0) {
      const optionId = matchOption(pendingQuestion.request.options, text);
      if (optionId) recordAnswers([{ requestId: pendingQuestion.request.requestId, optionId }]);
    }

    if (fileParts.length === 0) {
      await send({
        message: text,
        ...(clientContext ? { clientContext } : {}),
      });
    } else {
      const parts = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...fileParts,
      ];
      await send({
        message: parts,
        ...(clientContext ? { clientContext } : {}),
      });
    }
  };

  const handleStop = async () => {
    if (!(await waitForSessionId(clientSession, 1_000))) {
      agent.stop();
      return;
    }

    try {
      await clientSession.cancel();
    } catch {
      agent.stop();
    }
  };

  const handleNewChat = async () => {
    if (isBusy) await handleStop();
    agent.stop();
    agent.reset();
    clearSavedChat(storageKey);
    eventsRef.current = [];
    setChatModel(null);
    onReset();
  };

  const handleSignOut = async () => {
    if (isBusy) await handleStop();
    agent.stop();
    agent.reset();
    clearSavedChat(storageKey);
    onSignOut?.();
  };

  const composer = (
    <ChatInput
      initialText={onboardingDraft}
      onSubmit={handleInputSubmit}
      onStop={handleStop}
      isBusy={isBusy}
      placeholder={
        pendingQuestion ? t("chat.inputAnswerPlaceholder") : t("chat.sendPlaceholder") || "Ask anything…"
      }
      isEmpty={isEmpty}
    />
  );

  return (
    <div className="page-enter relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* The grid stays behind the greeting, at the same quiet intensity
          as the chat loader. */}
      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 bg-pattern bg-pattern-grid bg-pattern-fade bg-pattern-chat" />
      ) : null}
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-2.5">
            <StatusDot status={agent.status} />
            <span className="truncate font-medium text-sm">{AGENT_NAME}</span>
          </span>
          <span className="flex items-center gap-2">
            <ProviderStatusBadge data={chatHealth} />
            {modelPicker}
            <Button
              onClick={() => void handleNewChat()}
              size="sm"
              title={t("chat.newConversation")}
              variant="ghost"
            >
              <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("chat.newChat")}</span>
            </Button>
            {onSignOut ? (
              <Button
                onClick={() => void handleSignOut()}
                size="icon-sm"
                title={t("chat.signOut")}
                variant="ghost"
              >
                <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={1.75} />
                <span className="sr-only">{t("chat.signOut")}</span>
              </Button>
            ) : null}
          </span>
        </header>
      )}

      {(agent.error && !following) || offerFollowRetry ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <Alert
            tone="error"
            role="alert"
            title={
              offerFollowRetry && !ownershipError
                ? t("chat.connectionLost")
                : ownershipError
                  ? t("chat.sessionExpired")
                  : t("chat.requestFailed")
            }
            action={
              ownershipError ? (
                <Button onClick={() => void handleNewChat()} size="sm" variant="outline">
                  {t("chat.newChat")}
                </Button>
              ) : offerFollowRetry ? (
                <Button
                  onClick={() => {
                    setFollowEnded(null);
                    setFollowNonce((n) => n + 1);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {t("apiError.retry")}
                </Button>
              ) : null
            }
          >
            {offerFollowRetry && !ownershipError
              ? t("chat.connectionLostDesc")
              : ownershipError
                ? t("chat.sessionExpiredDesc")
                : agent.error?.message}
          </Alert>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            <PaymentEventsContext.Provider value={paymentEvents}>
            {agent.data.messages.map((message, index) => (
              <Suspense
                key={message.id}
                fallback={
                  <Message from={message.role}>
                    <MessageContent>
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") || t("chat.loadingRestoring")}
                      </div>
                    </MessageContent>
                  </Message>
                }
              >
                <AgentMessage
                  answers={answers}
                  canRespond={!isBusy}
                  isLast={index === agent.data.messages.length - 1}
                  isStreaming={
                    (agent.status === "streaming" || following) &&
                    index === agent.data.messages.length - 1
                  }
                  message={message}
                  onInputResponses={handleInputResponses}
                />
              </Suspense>
            ))}
            </PaymentEventsContext.Provider>
            {following && agent.data.messages.at(-1)?.role !== "assistant" ? (
              <p className="flex items-center gap-2 pl-1 text-muted-foreground text-xs">
                <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
                {t("chat.reconnecting")}
              </p>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          // `relative` paints this (logo, greeting, composer, suggestions)
          // above the absolutely positioned pattern overlay: both are
          // positioned at z-index auto, so tree order decides.
          "relative mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? "y-fade flex min-h-0 max-w-xl flex-1 flex-col items-center gap-5 overflow-y-auto py-5 sm:gap-8 sm:pb-[10dvh] [&>div]:shrink-0 [&>div:first-child]:mt-auto [&>div:last-child]:mb-auto"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center gap-6 text-center">
            {/* Daily rotating greeting — Claude-style short question, new one
                every day, no repeats within a 7-day cycle (see
                lib/chat-greeting.ts). It stands bare, in the same Cooper display
                as the assistants' "Let's build" titles; the sidebar already
                carries the logo. */}
            <h1 className="font-cooper text-[2rem] leading-tight tracking-[-0.02em] text-balance text-foreground">
              {dailyGreeting(new Date(), locale)}
            </h1>
            <p className="max-w-sm text-balance text-sm leading-relaxed text-muted-foreground">
              {t("chat.tagline")}
            </p>
            {MONITORING_HREF ? (
              <Pill href={MONITORING_HREF} title={t("chat.hostMetrics")}>
                {t("chat.liveMetrics")}
              </Pill>
            ) : null}
            {onSignOut ? (
              <Button onClick={() => void handleSignOut()} size="sm" variant="ghost">
                <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={1.75} />
                {t("chat.signOut")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
        {isEmpty ? (
          <div className="flex w-full flex-col items-center gap-5">
            <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
              <ProviderStatusBadge data={chatHealth} />
              {modelPicker}
            </div>
            <SlidingTabs
              onValueChange={setPromptTab}
              tabs={PROMPT_TABS.map(({ id, label }) => ({ id, label: t(label) }))}
              value={promptTab}
            />
            <div className="flex flex-wrap items-center justify-center gap-2">
              {activePromptTab.prompts.map((promptKey) => (
                <SuggestionChip
                  key={promptKey}
                  disabled={isBusy}
                  onClick={() => void send({ message: t(promptKey) })}
                >
                  {t(promptKey)}
                </SuggestionChip>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BasicAuthForm({
  onAuthenticated,
}: {
  readonly onAuthenticated: (credentials: BasicCredentials) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string>();
  const [isSafeOrigin, setIsSafeOrigin] = useState<boolean>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsSafeOrigin(
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]",
    );
  }, []);

  if (isSafeOrigin === undefined) {
    return <AgentLoading />;
  }

  if (!isSafeOrigin) {
    return <SecureConnectionRequired />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = {
      username: String(form.get("username") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    if (!credentials.username || !credentials.password) return;

    setError(undefined);
    setIsSubmitting(true);
    try {
      const client = new Client({
        host: window.location.origin,
        auth: { basic: credentials },
        redirect: "error",
      });
      await client.info();
      onAuthenticated(credentials);
    } catch {
      setError(t("auth.incorrectCredentials"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="y-fade flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto bg-background px-4 py-6 text-foreground">
      <section className="my-auto w-full max-w-sm shrink-0 rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-elevated)]">
        <p className="text-xs font-medium text-muted-foreground">oruka</p>
        <h1 className="mt-3 text-lg font-medium tracking-[-0.02em]">{t("auth.signIn")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("auth.signInDescription")}
        </p>
        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t("auth.username")}</span>
            <Input autoComplete="username" name="username" required />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t("auth.password")}</span>
            <Input autoComplete="current-password" name="password" required type="password" />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? t("auth.checking") : t("auth.continue")}
          </Button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          {t("auth.credentialsNote")}
        </p>
      </section>
    </div>
  );
}

function SecureConnectionRequired() {
  const t = useT();
  return (
    <div className="y-fade flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto bg-background px-4 py-6 text-foreground">
      <Alert tone="error" role="alert" className="my-auto w-full max-w-lg shrink-0">
        <h1 className="font-medium">{t("auth.httpsRequired")}</h1>
        <p className="mt-0.5 text-muted-foreground">{t("auth.httpsRequiredDesc")}</p>
      </Alert>
    </div>
  );
}

function AuthConfigurationError() {
  const t = useT();
  return (
    <div className="y-fade flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto bg-background px-4 py-6 text-foreground">
      <Alert tone="error" role="alert" className="my-auto w-full max-w-lg shrink-0">
        <h1 className="font-medium">{t("auth.notConfigured")}</h1>
        <p className="mt-0.5 text-muted-foreground">{t("auth.notConfiguredDesc")}</p>
      </Alert>
    </div>
  );
}

function loadSavedChat(storageKey: string): SavedEveChat {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SavedEveChat) : {};
  } catch {
    return {};
  }
}

async function restoreSavedChat(
  auth: ClientAuth | undefined,
  abortSignal: AbortSignal,
  storageKey: string,
): Promise<SavedEveChat> {
  const saved = loadSavedChat(storageKey);
  const events = [...(saved.events ?? [])];
  const lastEvent = events.at(-1);

  if (
    !saved.session?.sessionId ||
    (lastEvent !== undefined && isCurrentTurnBoundaryEvent(lastEvent))
  ) {
    return saved;
  }

  // Two shapes of restore share this path, and they want different budgets.
  // Reattaching after a reload picks up a turn that was in flight, so a stale
  // session id has to fail fast. Replaying a conversation opened from the
  // history list starts at index zero and reads every event the session ever
  // produced, which is a lot of small writes and worth waiting for — the
  // person just clicked it.
  const replaying = events.length === 0;
  const signal = AbortSignal.any([
    abortSignal,
    AbortSignal.timeout(replaying ? 8_000 : 1_500),
  ]);

  const client = new Client({
    host: window.location.origin, auth, redirect: "error", preserveCompletedSessions: true,
  });
  try {
    return await restoreEveChat(saved, client.session(saved.session), signal, (chat) =>
      saveChat(storageKey, chat),
    );
  } catch (error) {
    // Ownership rejection is permanent for this session id: drop the dead id
    // so the mount starts fresh instead of reattaching to it on every load.
    if (isSessionOwnershipError(error)) {
      clearSavedChat(storageKey);
      return {};
    }
    throw error;
  }
}

async function persistSessionWhenAccepted(
  session: ClientSession,
  eventsRef: { readonly current: readonly HandleMessageStreamEvent[] },
  sessionRef: { current: SessionState },
  storageKey: string,
) {
  if (!(await waitForSessionId(session, 5_000))) return;
  sessionRef.current = session.state;
  saveChat(storageKey, { events: eventsRef.current, session: session.state });
}

async function waitForSessionId(session: ClientSession, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!session.state.sessionId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return Boolean(session.state.sessionId);
}

function saveChat(storageKey: string, chat: SavedEveChat) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch {
    // Best-effort
  }
}

function clearSavedChat(storageKey: string) {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Best-effort
  }
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone = "bg-emerald-500";

  return (
    <span className="relative flex size-1.5">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-40 motion-reduce:hidden",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full transition-colors", tone)} />
    </span>
  );
}

/** A saved transcript whose last event is not a turn boundary: the tab stopped
 *  listening while the server was still working. */
function isTurnInFlight(saved: SavedEveChat): boolean {
  const last = saved.events?.at(-1);
  return Boolean(saved.session?.sessionId) && last !== undefined && !isCurrentTurnBoundaryEvent(last);
}

/** A stream the browser lost, as opposed to a turn the server failed. Chrome
 *  says "network error" for a body cut mid-chunk, Safari "Load failed",
 *  Firefox "NetworkError when attempting to fetch resource". */
function isStreamDrop(error: Error): boolean {
  return /network ?error|failed to fetch|fetch failed|load failed|terminated|incomplete/i.test(error.message);
}

type PendingQuestion = {
  readonly part: EveDynamicToolPart;
  readonly request: NonNullable<NonNullable<NonNullable<EveDynamicToolPart["toolMetadata"]>["eve"]>["inputRequest"]>;
};

/** The question in the newest message still waiting on the person, if any. */
function findPendingQuestion(
  messages: readonly EveMessage[],
  answers: SessionAnswers,
): PendingQuestion | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;
  for (const part of last.parts) {
    if (part.type !== "dynamic-tool") continue;
    const request = part.toolMetadata?.eve?.inputRequest;
    if (!request) continue;
    const phase = inputRequestPhase({
      state: part.state,
      answer: part.toolMetadata?.eve?.inputResponse ?? answers[request.requestId],
      movedOn: conversationMovedOn(last, true, part),
    });
    if (phase === "pending") return { part, request };
  }
  return undefined;
}

/** The option a typed reply names — by id, label, or 1-based position — the
 *  same three ways eve itself resolves a text reply to a pending request. */
function matchOption(options: PendingQuestion["request"]["options"], text: string): string | undefined {
  const value = text.trim().toLowerCase();
  if (!value || !options?.length) return undefined;
  const byName = options.find(
    (option) => option.id.toLowerCase() === value || option.label.trim().toLowerCase() === value,
  );
  if (byName) return byName.id;
  const position = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return options[position - 1]?.id;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
