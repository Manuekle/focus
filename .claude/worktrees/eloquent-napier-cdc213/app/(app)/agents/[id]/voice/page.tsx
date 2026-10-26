"use client";

import "../../../product.css";
import styles from "./voice.module.css";
import { WhatsAppVoicePanel } from "./whatsapp-voice-panel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CallOutgoing01Icon,
  TelephoneIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { ConversationBar } from "@/components/elevenlabs/conversation-bar";
import { VoiceOrb } from "@/components/elevenlabs/voice-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { AgentSessionSkeleton } from "@/components/product-loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { useI18n, useT } from "@/lib/i18n/provider";
import { countryOptions } from "@/lib/countries";
import { fetchJson, isApiError, type UiError } from "@/lib/api-error-message";
import { cn } from "@/lib/utils";
import type { Agent, AgentVoice } from "@/lib/types";
import { toCapabilityIds } from "@/lib/agent-capabilities";
import { transferPhone } from "@/lib/voice-handoff";
import { PageContainer } from "../../../../_components/page-container";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../_components/dashboard-card";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { Spinner } from "@/components/ui/spinner";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";

type VoiceOption = { readonly voiceId: string; readonly name: string; readonly category?: string };
type PhoneNumber = {
  readonly phoneNumberId: string;
  readonly phoneNumber: string;
  readonly label?: string;
  readonly assignedAgentId?: string;
};
type TranscriptLine = { readonly id: number; readonly source: "user" | "ai"; readonly text: string };
// "auto" first and default: on a call this app dials, the destination's dial
// code decides the language (lib/phone-language.ts). Picking a concrete one
// fixes it for every call instead. Inbound calls always run on the fixed one —
// the number is routed straight to ElevenLabs and this app never sees the
// session start, so there is nothing to derive it from in time.
const LANGUAGES = ["auto", "es", "en", "pt", "fr", "it", "de"] as const;

export default function AgentVoicePage() {
  const params = useParams<{ id: string }>();
  return <AgentVoiceWorkspace key={params.id} agentId={params.id} />;
}

function AgentVoiceWorkspace({ agentId }: { readonly agentId: string }) {
  const t = useT();
  const router = useRouter();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  // Stacked below `lg`, the settings column buried the orb and the call
  // controls entirely — so a phone shows the call or the settings, not both.
  const [mobilePane, setMobilePane] = useState<"call" | "settings">("call");
  const lineId = useRef(0);

  const load = useCallback(async () => {
    const result = await fetchJson<{ agents?: Agent[] }>("/api/agents", t);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setAgent(result.data.agents?.find((a) => a.id === agentId) ?? null);
    setLoading(false);
  }, [agentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const appendLine = useCallback((source: "user" | "ai", text: string) => {
    lineId.current += 1;
    setTranscript((lines) => [...lines, { id: lineId.current, source, text }]);
  }, []);

  if (loading) return <AgentSessionSkeleton kind="voice" />;

  if (!agent) {
    return (
      <PageContainer maxWidth="max-w-6xl">
        {error ? <ErrorBanner error={error} onRetry={() => void load()} /> : null}
        <Card>
          <CardHeader>
            <CardTitle>{t("voice.notFound")}</CardTitle>
            <CardDescription>{t("voice.notFoundDesc")}</CardDescription>
          </CardHeader>
          <div className="p-5 pt-0">
            <Button asChild variant="outline">
              <Link href="/agents">{t("voice.backToAgents")}</Link>
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  // The two-column split is a container query, not a viewport one. `lg:`
  // measures the window, which is the wrong ruler here: the shell's 240px
  // sidebar sits outside `main`, so a 1024px window left the call pane 344px
  // wide while the media query insisted there was room for two columns — and
  // the connect bar, which cannot go below ~380px, was clipped by the
  // `overflow-hidden` above it. 820px is the narrowest container that fits the
  // 420px config column next to a usable call pane.
  return (
    <div className="@container content-enter flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Toolbar — same pattern as /automations/[id] */}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push(`/agents/${agent.id}`)}
                aria-label={t("voice.backToAgent")}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("voice.backToAgent")}</TooltipContent>
          </Tooltip>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-lg font-medium tracking-[-0.02em]">{agent.name}</h1>
            <StatusBadge
              status={agent.voice?.elevenlabsAgentId ? "active" : "paused"}
              label={agent.voice?.elevenlabsAgentId ? t("voice.badgeLive") : t("voice.badgeOff")}
            />
          </div>

          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            {t("voice.eyebrow")}
          </span>
        </div>

        {error ? (
          <ErrorBanner
            layout="strip"
            error={error}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border px-3 py-2 @min-[820px]:hidden">
        <SlidingTabs
          value={mobilePane}
          onValueChange={(id) => setMobilePane(id as "call" | "settings")}
          tabs={[
            { id: "call", label: t("voice.paneCall") },
            { id: "settings", label: t("voice.paneSettings") },
          ]}
        />
      </div>

      <ConversationProvider
        onMessage={({ message, source }) => appendLine(source, message)}
        onDisconnect={() => appendLine("ai", t("voice.transcriptEnded"))}
        onError={(message: string) =>
          setError({ code: "upstream_failed", message, status: 0 })
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden @min-[820px]:flex-row">
          {/* Call + live transcript. Hidden with CSS rather than unmounted:
              switching tabs mid-call must not tear the call down. */}
          <div
            className={cn(
              styles.callPane,
              "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              mobilePane === "call" ? "flex" : "hidden @min-[820px]:flex",
            )}
          >
            <CallStage
              agent={agent}
              transcript={transcript}
              onClear={() => setTranscript([])}
              onError={setError}
              onConfigure={() => setMobilePane("settings")}
            />
          </div>

          {/* Config column — scrolls independently */}
          <section
            aria-label={t("voice.paneSettings")}
            className={cn(
              "min-h-0 min-w-0 w-full flex-1 bg-muted/20 @min-[820px]:w-[420px] @min-[820px]:flex-none @min-[820px]:border-l @min-[820px]:border-border",
              mobilePane === "settings" ? "block" : "hidden @min-[820px]:block",
            )}
          >
            <div className="y-fade h-full overflow-y-auto overscroll-contain p-4">
              <div className="space-y-4">
                <VoiceSettings agent={agent} onSaved={setAgent} onError={setError} />
                <PhonePanel agent={agent} onSaved={setAgent} onError={setError} />
                <WhatsAppVoicePanel agentId={agent.id} />
                <SavedCallsLink agentId={agent.id} />
              </div>
            </div>
          </section>
        </div>
      </ConversationProvider>
    </div>
  );
}

/**
 * The playground half: orb, connect bar, live transcript.
 *
 * Transcript lives here, attached to the call — always visible while talking,
 * auto-scrolls, labels who said what (tú / agent).
 */
function CallStage({
  agent,
  transcript,
  onClear,
  onError,
  onConfigure,
}: {
  readonly agent: Agent;
  readonly transcript: TranscriptLine[];
  readonly onClear: () => void;
  readonly onError: (error: UiError) => void;
  readonly onConfigure: () => void;
}) {
  const t = useT();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { getInputVolume, getOutputVolume, getId } = useConversationControls();
  const taggedCallRef = useRef<string | null>(null);
  const reduced = useReducedMotion();

  const ready = Boolean(agent.voice?.enabled && agent.voice?.elevenlabsAgentId);

  const agentState = useMemo(() => {
    if (status === "connecting") return "thinking" as const;
    if (status !== "connected") return null;
    return isSpeaking ? ("talking" as const) : ("listening" as const);
  }, [status, isSpeaking]);

  const getToken = useCallback(async () => {
    const response = await fetch(`/api/agents/${agent.id}/voice/token`, { method: "POST" });
    if (!response.ok) throw new Error(`token request failed: ${response.status}`);
    const data = (await response.json()) as { token: string };
    return data.token;
  }, [agent.id]);

  // A denied or missing microphone is the common way a call fails to start,
  // and it fails before the session exists — so `ConversationProvider`'s
  // `onError` never sees it. Without this the button simply did nothing.
  const onStartError = useCallback(
    (error: unknown) => {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "NotFoundError");
      onError({ messageKey: denied ? "voice.micDenied" : "voice.startFailed" });
    },
    [onError],
  );

  // livekit-client (the WebRTC transport under @elevenlabs/react) logs
  // "error reading from signal stream" through console.error every time a
  // call ends — its signaling socket closing mid-read is expected teardown
  // (see startReadingLoop in livekit-client's dist bundle: caught, logged,
  // then closes cleanly), not an actual failure. Next's dev overlay treats
  // any console.error as a crash, though, so it paints this as one on every
  // hangup. Filtered narrowly, by exact message, only for this component's
  // lifetime — every other console.error still gets through untouched.
  useEffect(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("error reading from signal stream")) {
        return;
      }
      original(...args);
    };
    return () => {
      console.error = original;
    };
  }, []);

  // Tags this conversation "test" the moment it connects — before the
  // post_call_transcription webhook can arrive — same reason the "Llamada de
  // prueba" button tags its own outbound call server-side. Without this, a
  // call placed from inside the browser defaults to "real" once the webhook
  // shows up with no matching pending row.
  useEffect(() => {
    if (status !== "connected") return;
    const conversationId = getId();
    if (!conversationId || taggedCallRef.current === conversationId) return;
    taggedCallRef.current = conversationId;
    void fetch(`/api/agents/${agent.id}/voice/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch(() => {
      // Best-effort — worst case this call falls back to "real" once the
      // webhook lands with no matching pending row.
    });
  }, [status, getId, agent.id]);

  const statusLabel =
    status === "connected"
      ? isSpeaking
        ? t("voice.stateTalking")
        : t("voice.stateListening")
      : status === "connecting"
        ? t("voice.stateConnecting")
        : t("voice.stateIdle");

  const isLive = status === "connected" || status === "connecting";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Orb + controls */}
      <div className={cn(styles.controls, "flex shrink-0 flex-col items-center px-4 py-5")}>
        <VoiceOrb
          className={styles.orb}
          agentState={agentState}
          getInputVolume={getInputVolume}
          getOutputVolume={getOutputVolume}
        />
        <p className={cn(styles.status, "mt-3 inline-flex items-center gap-2 text-[13px] text-muted-foreground")}>
          {isLive ? (
            <span
              className={cn(
                "size-2 rounded-full",
                status === "connected" && isSpeaking ? "animate-pulse bg-emerald-500" : "bg-amber-500",
              )}
            />
          ) : null}
          {statusLabel}
        </p>

        {ready ? (
          <ConversationBar
            className={cn(styles.actions, "p-0 pt-4")}
            getConversationToken={getToken}
            label={agent.name}
            labels={{
              start: t("voice.browserStart"), end: t("voice.browserEnd"),
              mute: t("voice.browserMute"), unmute: t("voice.browserUnmute"),
              showText: t("voice.browserShowText"), hideText: t("voice.browserHideText"),
              message: t("voice.browserMessage"), send: t("voice.browserSend"),
            }}
            onStartError={onStartError}
          />
        ) : (
          <div className={cn(styles.blocked, "mt-4 flex flex-col items-center gap-3")}>
            <p className="text-muted-foreground max-w-[36ch] text-center text-[13px]">
              {t("voice.stageBlocked")}
            </p>
            <Button variant="outline" size="sm" onClick={onConfigure} className="@min-[820px]:hidden">
              {t("voice.paneSettings")}
            </Button>
          </div>
        )}
      </div>

      {/* Live transcript — always visible, scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border bg-card">
        <div className="flex shrink-0 items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 rounded-full",
                isLive ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/30",
              )}
            />
            <p className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              {t("voice.transcript")}
            </p>
            {isLive ? (
              <span className="pill pill-sm tone-pill tone-success font-mono tracking-wide">
                LIVE
              </span>
            ) : null}
          </div>
          {transcript.length > 0 ? (
            <Button onClick={onClear} size="sm" variant="ghost" className="h-7 text-xs">
              {t("voice.transcriptClear")}
            </Button>
          ) : null}
        </div>
        <Conversation initial={reduced ? "instant" : "smooth"} resize={reduced ? "instant" : "smooth"} className="min-h-0" aria-label={t("voice.transcript")}>
          <ConversationContent className="gap-3 px-5 pt-0 pb-5">
          {transcript.length === 0 ? (
            <div className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
              <p className="text-[13px] text-muted-foreground">{t("voice.transcriptEmpty")}</p>
              <p className="mt-1 max-w-[32ch] text-[12px] leading-relaxed text-muted-foreground">
                {isLive ? t("voice.transcriptLiveHint") : t("voice.transcriptIdleHint")}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {transcript.map((line) => (
                  <motion.li
                    key={line.id}
                    // A live transcript appends a line every few seconds. The
                    // slide-in is the one piece of motion on this page that
                    // repeats indefinitely, so it is also the one that has to
                    // stop for `prefers-reduced-motion` (WCAG 2.3.3).
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      "flex flex-col gap-1",
                      line.source === "user" ? "items-end" : "items-start",
                    )}
                  >
                    <span className="font-mono text-[10px] tracking-wide text-muted-foreground">
                      {line.source === "user" ? t("voice.transcriptYou") : agent.name}
                    </span>
                    {line.source === "user" ? (
                      <span className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[13px] leading-relaxed text-primary-foreground shadow-sm">
                        {line.text}
                      </span>
                    ) : (
                      <StreamingResponse
                        status="complete"
                        showActions={false}
                        announce={false}
                        className="max-w-[85%]"
                        contentClassName="text-[13px] leading-relaxed"
                      >
                        {line.text}
                      </StreamingResponse>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
              {isLive && isSpeaking ? (
                <motion.li
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-1 items-start"
                >
                  <span className="font-mono text-[10px] tracking-wide text-muted-foreground">
                    {agent.name}
                  </span>
                  <StreamingResponse status="streaming" showActions={false} announce={false} className="max-w-[85%]">
                    <span className="inline-flex gap-1 py-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.3s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.15s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-foreground/40" />
                    </span>
                  </StreamingResponse>
                </motion.li>
              ) : null}
            </ul>
          )}
          </ConversationContent>
          <ConversationScrollButton aria-label={t("voice.latestMessages")} />
        </Conversation>
      </div>
    </div>
  );
}

/** Voice, first message and language — the three things the mirror agent needs
 *  that this app's agent record does not already carry. */
function VoiceSettings({
  agent,
  onSaved,
  onError,
}: {
  readonly agent: Agent;
  readonly onSaved: (agent: Agent) => void;
  readonly onError: (error: UiError | null) => void;
}) {
  const t = useT();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [configured, setConfigured] = useState(true);
  // The missing scope, not the sentence: a translated string frozen in state
  // keeps the language it was produced in, so switching to English would leave
  // the Spanish line on screen. See the note on `UiError`.
  const [voicesMissingScope, setVoicesMissingScope] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState(agent.voice?.voiceId ?? "");
  const [firstMessage, setFirstMessage] = useState(agent.voice?.firstMessage ?? "");
  const [language, setLanguage] = useState(agent.voice?.language ?? "auto");
  const [transferPhoneNumber, setTransferPhoneNumber] = useState(agent.voice?.transferPhoneNumber ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJson<{ configured: boolean; voices: VoiceOption[] }>(
        "/api/elevenlabs/voices",
        t,
      );
      if (cancelled) return;
      if (!result.ok) {
        // The route names the missing scope in `field`; `perm` is the fallback
        // for an upstream message that arrived through some other code. With
        // neither, this is an ordinary failure and gets the ordinary banner —
        // the permission panel would be a guess about what went wrong.
        const detail = (isApiError(result.error) ? result.error.detail : undefined) ?? "";
        const scope =
          (isApiError(result.error) ? result.error.field : undefined) ??
          detail.match(/permission (\w+)/)?.[1];
        if (scope) {
          setVoicesMissingScope(scope);
          return;
        }
        onError(result.error);
        return;
      }
      setConfigured(result.data.configured);
      setVoices(result.data.voices);
      if (!result.data.voices.some((v) => v.voiceId === voiceId)) {
        setVoiceId(result.data.voices[0]?.voiceId ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: the list is an account-level catalogue, not per-render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    try { transferPhone(transferPhoneNumber); } catch {
      onError({ messageKey: "voice.transferPhoneInvalid" });
      return;
    }
    setSaving(true);
    onError(null);
    const body: Partial<AgentVoice> = { enabled: true, voiceId, firstMessage, language, transferPhoneNumber };
    const result = await fetchJson<{ agent: Agent }>(`/api/agents/${agent.id}/voice`, t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onSaved(result.data.agent);
  }, [agent.id, firstMessage, language, transferPhoneNumber, onError, onSaved, t, voiceId]);

  return (
    <Card>
      <CardHeader className="flex-col gap-1">
        <CardTitle>{t("voice.configTitle")}</CardTitle>
        <CardDescription>{t("voice.configDesc")}</CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-4 p-5 pt-0">
        {voicesMissingScope ? (
          <div className="flex gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={16}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug">
                {t("apiError.elevenlabs_permission", { field: voicesMissingScope })}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {t("voice.permissionHint")}{" "}
                <Link href="/settings" className="underline underline-offset-2">
                  {t("nav.settings")}
                </Link>{" "}
                {t("common.or")}{" "}
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {t("voice.permissionHintOpen")}
                </a>
                .
              </p>
            </div>
          </div>
        ) : null}
        {!configured ? (
          <p className="text-muted-foreground text-[13px]">
            {t("voice.needsKey")}{" "}
            <Link className="underline underline-offset-2" href="/settings">
              {t("voice.needsKeyLink")}
            </Link>
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[13px]">{t("voice.fieldVoice")}</span>
          <Select onValueChange={setVoiceId} value={voiceId} disabled={!!voicesMissingScope}>
            <SelectTrigger
              aria-label={t("voice.fieldVoice")} className="w-full">
              <SelectValue placeholder={t("voice.fieldVoicePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {voices.map((voice) => (
                <SelectItem key={voice.voiceId} value={voice.voiceId}>
                  {voice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[13px]">
            {t("voice.fieldFirstMessage")}{" "}
            <span className="font-normal text-muted-foreground">{t("common.optional")}</span>
          </span>
          <Textarea
            className="min-h-[76px]"
            onChange={(event) => setFirstMessage(event.target.value)}
            placeholder={t("voice.fieldFirstMessagePlaceholder")}
            value={firstMessage}
          />
          <span className="text-muted-foreground text-[12px]">
            {t("voice.fieldFirstMessageHelp")} {t("voice.fieldFirstMessageEmpty")}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[13px]">{t("voice.fieldLanguage")}</span>
          <Select onValueChange={setLanguage} value={language}>
            <SelectTrigger
              aria-label={t("voice.fieldLanguage")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`voice.lang.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-[12px]">
            {t("voice.fieldLanguageHelp")}
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="voice-transfer-phone" className="font-medium text-[13px]">{t("voice.transferPhone")}</label>
          <Input id="voice-transfer-phone" type="tel" autoComplete="tel" value={transferPhoneNumber}
            onChange={(event) => setTransferPhoneNumber(event.target.value)}
            aria-describedby="voice-transfer-hint" />
          <span id="voice-transfer-hint" className="text-muted-foreground text-[12px]">
            {t(toCapabilityIds(agent.tools).includes("handoff") ? "voice.transferPhoneHelp" : "voice.transferNeedsCapability")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={saving || !configured || Boolean(voicesMissingScope) || !voiceId} onClick={() => void save()}>
            {saving ? (
              <Spinner />
            ) : (
              <HugeiconsIcon icon={VolumeHighIcon} size={16} strokeWidth={1.75} />
            )}
            {agent.voice?.elevenlabsAgentId ? t("voice.resync") : t("voice.enable")}
          </Button>
          {agent.voice?.syncedAt ? (
            <span className="text-muted-foreground text-[12px]">
              {t("voice.syncedAt")} {new Date(agent.voice.syncedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {agent.voice?.toolsWarning ? (
          // The one failure that is invisible on a call: the agent still
          // answers, still sounds right, and books nothing. Said here rather
          // than left to be discovered by a customer who was promised a turno.
          <Alert tone="warning" size="sm" role={null}>
            {agent.voice.toolsWarning}
          </Alert>
        ) : null}

        <p className="text-muted-foreground text-[12px] leading-relaxed">
          {t("voice.mirrorNote")}
        </p>
      </div>
    </Card>
  );
}

/** The phone half: import the Twilio number, route it here, place a test call. */
function PhonePanel({
  agent,
  onSaved,
  onError,
}: {
  readonly agent: Agent;
  readonly onSaved: (agent: Agent) => void;
  readonly onError: (error: UiError | null) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [busy, setBusy] = useState<"import" | "assign" | "call" | null>(null);
  const [toNumber, setToNumber] = useState("");
  const [callResult, setCallResult] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<"ready" | "trial" | "inactive" | "unknown">("unknown");
  const [countryIso, setCountryIso] = useState("ar");
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const dialCode = countries.find((c) => c.iso2 === countryIso)?.dial ?? "+54";

  const assigned = numbers.find((n) => n.phoneNumberId === agent.voice?.phoneNumberId);
  const mirrorId = agent.voice?.elevenlabsAgentId;

  const loadNumbers = useCallback(async () => {
    const result = await fetchJson<{ numbers: PhoneNumber[] }>(
      "/api/elevenlabs/phone-numbers",
      t,
    );
    // A failure here is not worth a banner on load — the panel already reads
    // as "no number yet", and the import button surfaces the real error the
    // moment someone tries.
    if (result.ok) setNumbers(result.data.numbers);
  }, [t]);

  useEffect(() => {
    void loadNumbers();
  }, [loadNumbers]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ state: typeof accountState }>(`/api/agents/${agent.id}/voice/call`, t).then((result) => {
      if (!cancelled && result.ok) setAccountState(result.data.state);
    });
    return () => { cancelled = true; };
  }, [agent.id, t]);


  const importNumber = useCallback(async () => {
    setBusy("import");
    onError(null);
    const result = await fetchJson<{ phoneNumberId: string }>("/api/elevenlabs/phone-numbers", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ elevenlabsAgentId: mirrorId }),
    });
    if (!result.ok) {
      setBusy(null);
      onError(result.error);
      return;
    }
    const saved = await fetchJson<{ agent: Agent }>(`/api/agents/${agent.id}/voice`, t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId: result.data.phoneNumberId }),
    });
    setBusy(null);
    if (!saved.ok) {
      onError(saved.error);
      return;
    }
    onSaved(saved.data.agent);
    void loadNumbers();
  }, [agent.id, loadNumbers, mirrorId, onError, onSaved, t]);

  const assign = useCallback(
    async (phoneNumberId: string) => {
      setBusy("assign");
      onError(null);
      const saved = await fetchJson<{ agent: Agent }>(`/api/agents/${agent.id}/voice`, t, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumberId }),
      });
      setBusy(null);
      if (!saved.ok) {
        onError(saved.error);
        return;
      }
      onSaved(saved.data.agent);
      void loadNumbers();
    },
    [agent.id, loadNumbers, onError, onSaved, t],
  );

  const call = useCallback(async () => {
    setBusy("call");
    setCallResult(null);
    onError(null);
    const fullNumber = toNumber.trim() ? (toNumber.trim().startsWith("+") ? toNumber.trim() : `${dialCode}${toNumber.trim().replace(/^0+/, "")}`) : "";
    const result = await fetchJson<{ ok: boolean; message: string }>(
      `/api/agents/${agent.id}/voice/call`,
      t,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toNumber: fullNumber }),
      },
    );
    setBusy(null);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setCallResult(result.data.ok ? t("voice.callPlaced") : result.data.message);
  }, [agent.id, dialCode, onError, t, toNumber]);

  return (
    <Card>
      <CardHeader className="flex-col gap-1">
        <CardTitle>{t("voice.phoneTitle")}</CardTitle>
        <CardDescription>{t("voice.phoneDesc")}</CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-4 p-5 pt-0">
        {accountState === "trial" || accountState === "inactive" ? (
          <Alert tone="warning" size="sm" role={null}>
            {t(accountState === "trial" ? "apiError.twilio_trial_audio" : "apiError.twilio_account_inactive")}{" "}
            <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {t("voice.twilioConsole")}
            </a>
          </Alert>
        ) : null}
        {assigned ? (
          <div className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-medium text-[14px]">{assigned.phoneNumber}</p>
              <p className="text-muted-foreground text-[12px]">{t("voice.phoneRouted")}</p>
            </div>
            <StatusBadge status={accountState === "trial" || accountState === "inactive" ? "warning" : "connected"} label={t(accountState === "trial" || accountState === "inactive" ? "voice.phoneLimited" : "voice.phoneActive")} />
          </div>
        ) : numbers.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-[13px]">{t("voice.phonePick")}</p>
            {numbers.map((number) => (
              <div
                className="border-border flex items-center justify-between rounded-lg border px-3 py-2"
                key={number.phoneNumberId}
              >
                <span className="text-[14px]">{number.phoneNumber}</span>
                <Button
                  disabled={busy !== null || !mirrorId}
                  onClick={() => void assign(number.phoneNumberId)}
                  size="sm"
                  variant="outline"
                >
                  {t("voice.phoneUse")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t("voice.phoneEmpty")}</p>
        )}

        {!assigned ? (
          <div className="flex flex-col gap-2">
            <Button
              disabled={busy !== null || !mirrorId}
              onClick={() => void importNumber()}
              variant="outline"
            >
              {busy === "import" ? (
                <Spinner />
              ) : null}
              {t("voice.phoneImport")}
            </Button>
            <p className="text-muted-foreground text-[12px] leading-relaxed">
              {t("voice.phoneImportHelp")}{" "}
              <Link className="underline underline-offset-2" href="/settings">
                {t("voice.needsKeyLink")}
              </Link>
            </p>
          </div>
        ) : null}

        <div className="border-border border-t pt-4">
          <p className="mb-2 font-medium text-[13px]">{t("voice.callTitle")}</p>
          {/* The `sm:flex-nowrap` here read the window, but this row never
              sees the window: it lives in a config column that is 420px wide
              on every desktop. One line left the number input ~120px wide
              between the country select and the button. The button gets its
              own row at every size instead. */}
          <div className="flex flex-wrap gap-2">
            <Select value={countryIso} onValueChange={setCountryIso}>
              <SelectTrigger aria-label={t("common.country")} className="w-[4.5rem] shrink-0 justify-center px-2">
                <span className="flex items-center gap-2">
                  {(() => {
                    const selected = countries.find((c) => c.iso2 === countryIso) ?? countries[0];
                    return selected ? (
                      <Image
                        src={selected.flag}
                        alt={selected.name}
                        width={24}
                        height={16}
                        unoptimized
                        className="h-4 w-6 rounded-[2px] object-cover"
                      />
                    ) : null;
                  })()}
                  <span className="sr-only">
                    <SelectValue />
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.iso2} value={c.iso2}>
                    <span className="flex items-center gap-2">
                      <Image
                        src={c.flag}
                        alt=""
                        width={18}
                        height={12}
                        unoptimized
                        className="h-3 w-[18px] rounded-[1px] object-cover"
                      />
                      <span>{c.dial}</span>
                      <span className="text-muted-foreground truncate">{c.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t("common.phoneNumber")}
              onChange={(event) => setToNumber(event.target.value)}
              placeholder="11 5555 0000"
              value={toNumber}
              inputMode="tel"
              className="min-w-0 flex-1"
            />
            <Button
              disabled={busy !== null || !assigned || !toNumber.trim() || accountState === "trial" || accountState === "inactive"}
              onClick={() => void call()}
              className="w-full"
            >
              {busy === "call" ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={CallOutgoing01Icon} size={16} strokeWidth={1.75} />
              )}
              {t("voice.callAction")}
            </Button>
          </div>
          {callResult ? (
            <p className="text-muted-foreground mt-2 text-[13px]">{callResult}</p>
          ) : (
            <p className="text-muted-foreground mt-2 text-[12px]">{t("voice.callHelp")}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The way into the call history, which lives on its own page now.
 *
 * The config column is where someone sets the agent up; a scrolling list of
 * every call it ever handled competed with that for the same narrow space and
 * won, pushing the settings out of view. One line that says how many calls
 * there are, and a page to read them on, serves both.
 */
function SavedCallsLink({ agentId }: { readonly agentId: string }) {
  const t = useT();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJson<{ calls: unknown[] }>(`/api/agents/${agentId}/voice/calls`, t);
      if (!cancelled && result.ok) setCount(result.data.calls.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, t]);

  return (
    <Card>
      <Link
        className="flex items-center gap-3 p-5 transition-colors hover:bg-accent/40"
        href={`/agents/${agentId}/voice/history`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <HugeiconsIcon icon={TelephoneIcon} size={18} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] font-medium">{t("voice.savedCallsTitle")}</span>
          <span className="text-muted-foreground truncate text-[12px]">
            {count === null
              ? t("voice.savedCallsDesc")
              : count === 0
                ? t("voice.savedCallsEmpty")
                : t("voice.savedCallsCount").replace("{count}", String(count))}
          </span>
        </span>
        <HugeiconsIcon
          className="text-muted-foreground shrink-0"
          icon={ArrowRight01Icon}
          size={16}
          strokeWidth={1.75}
        />
      </Link>
    </Card>
  );
}
