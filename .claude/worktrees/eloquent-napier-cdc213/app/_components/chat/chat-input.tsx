"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AiSearch01Icon,
  BulbIcon,
  CodeIcon,
  GlobalSearchIcon,
  Image01Icon,
  Mic02Icon,
  MicOff02Icon,
  PaperclipIcon,
  CallSpark02Icon,
  StopIcon,
  ToolCaseIcon,
  XIcon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SendButton } from "@/components/ui/send-button";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  appendDictation,
  recognitionLang,
} from "@/lib/voice-dictation";
import { useVoiceTranscription } from "./use-voice-transcription";
import { ChatDropdown } from "./chat-dropdown";
import { ActionSwapRollIcon } from "@/components/motion/action-swap-roll";
import {
  ChatAttachmentsPreview,
  type PendingAttachment,
} from "./chat-attachments";
import {
  AgentMentionDropdown,
  type DropdownActionItem,
} from "./agent-mention-dropdown";
import { type MentionableAgent } from "@/lib/chat-agents";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useMicrophone } from "voice-glow";
import { VoiceBeamGlow } from "@/components/ui/voice-beam";
import { useToast } from "@/components/toast-provider";
import { useSound } from "@/components/sound-provider";
import { readApiError } from "@/lib/api-error-message";

import type { ChatToolMode } from "@/lib/chat-tool-modes";

export type ChatInputSubmitPayload = {
  readonly text: string;
  readonly files: File[];
  readonly mentionedAgent?: MentionableAgent | null;
  /** Which entry of the Tools menu is active. Typed against the catalog so a
   *  menu entry the runtime has no instruction for cannot be added here —
   *  see lib/chat-tool-modes.ts. */
  readonly toolMode?: ChatToolMode | null;
};

const MIN_CHARS = 1;
const MAX_CHARS = 4000;
/** The composer's round side actions: the outline Button at the send
 *  button's size and corner, quiet until hovered. */
const COMPOSER_ACTION = "size-9 shrink-0 rounded-xl p-0 text-muted-foreground hover:text-foreground md:size-9";

/** What the composer records dictation as, best first. Chrome and Firefox
 *  take opus in a webm container; Safari only offers mp4/AAC. Scribe accepts
 *  both, so the first supported one wins and an empty list falls back to the
 *  browser's own default. */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

/** The filename the clip is posted under — Scribe reads the container from
 *  the content type, but a sensible extension keeps logs readable. */
function clipFilename(mimeType: string): string {
  return mimeType.includes("mp4") ? "dictation.mp4" : "dictation.webm";
}

function buildToolsMenu(t: (key: string) => string): ReadonlyArray<{
  readonly id: ChatToolMode;
  readonly label: string;
  readonly icon: typeof Image01Icon;
  readonly promptPrefix: string;
}> {
  return [
    {
      id: "image",
      label: t("chat.toolImage"),
      icon: Image01Icon,
      promptPrefix: t("chat.promptPrefixImage"),
    },
    {
      id: "web",
      label: t("chat.toolWeb"),
      icon: GlobalSearchIcon,
      promptPrefix: t("chat.promptPrefixWeb"),
    },
    {
      id: "code",
      label: t("chat.toolCode"),
      icon: CodeIcon,
      promptPrefix: t("chat.promptPrefixCode"),
    },
    {
      id: "research",
      label: t("chat.toolResearch"),
      icon: AiSearch01Icon,
      promptPrefix: t("chat.promptPrefixResearch"),
    },
    {
      id: "reason",
      label: t("chat.toolReason"),
      icon: BulbIcon,
      promptPrefix: t("chat.promptPrefixReason"),
    },
  ];
}

export function ChatInput({
  onSubmit,
  onStop,
  isBusy,
  placeholder,
  initialText,
  isEmpty = false,
}: {
  readonly onSubmit: (payload: ChatInputSubmitPayload) => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly isBusy: boolean;
  readonly placeholder?: string;
  readonly initialText?: string;
  readonly isEmpty?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { toast } = useToast();
  const { cue } = useSound();
  const TOOLS_MENU = buildToolsMenu(t);
  const reducedMotion = useReducedMotion();
  const [text, setText] = useState(initialText ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [activeToolMode, setActiveToolMode] = useState<ChatToolMode | null>(null);

  // Microphone for the voice glow under the composer. Nothing is recorded or
  // transcribed: the stream is handed to `VoiceBeamGlow` so the beam reacts to
  // the room, and it is released the moment listening stops. The browser only
  // hands a stream over inside a user gesture, so it is opened from the button
  // click, never on mount.
  const mic = useMicrophone();
  // Real-time dictation through the browser's Web Speech recognition — the
  // primary path. Final transcripts commit into the composer's own `text`
  // state; interim ones render as a temporary suffix (see `displayText`) and
  // are never committed, so a final result cannot duplicate shown text.
  const voice = useVoiceTranscription({
    lang: recognitionLang(locale),
    onFinalChunk: (chunk) => {
      setText((prev) => appendDictation(prev, chunk, MAX_CHARS));
      // The state flush lands after this callback — resize on the next frame.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
        }
      });
    },
  });
  // Browsers without Web Speech fall back to the old clip flow: record while
  // the mic is open, post to /api/chat/transcribe when it stops.
  const legacyListening = mic.state === "live" && !voice.isSupported;
  const isListening = voice.isListening || legacyListening;
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Capture and recording are two separate capabilities: a browser can hand
  // over a stream and still have no MediaRecorder to encode it with, and the
  // legacy fallback needs both. `voice.isSupported` resolves after mount —
  // false on the server — so gating the button on it keeps the first client
  // render identical to the server's and hydration stays quiet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canDictate =
    mounted && (voice.isSupported || (mic.supported && typeof MediaRecorder !== "undefined"));

  // Interim dictation renders as a live suffix of the textarea. It is display
  // only — `text` holds just the committed words.
  const liveInterim = voice.isListening ? voice.interimTranscript.trim() : "";
  const interimSuffix =
    !liveInterim || text.endsWith(" ") || text.endsWith("\n") || !text
      ? liveInterim
      : ` ${liveInterim}`;
  const displayText = `${text}${interimSuffix}`;

  useEffect(() => {
    if (!voice.error) return;
    if (voice.error === "not-allowed" || voice.error === "audio-capture") {
      toast({ title: t("chat.micDenied"), status: "error" });
    } else if (voice.error === "unsupported") {
      toast({ title: t("chat.voiceNotSupported"), status: "error" });
    } else if (voice.error === "no-speech" || voice.error === "aborted") {
      // Part of dictating, not a failure — stay silent.
    } else {
      toast({ title: t("chat.transcriptionFailed"), status: "error" });
    }
  }, [voice.error, t, toast]);

  // Mentions
  const [mentionableAgents, setMentionableAgents] = useState<MentionableAgent[]>([]);
  const [mentionState, setMentionState] = useState<{ filter: string; index: number } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [activeMentionAgent, setActiveMentionAgent] = useState<MentionableAgent | null>(null);
  const isMentionOpen = mentionState !== null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch("/api/chat/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { agents?: MentionableAgent[] } | null) => setMentionableAgents(data?.agents ?? []))
      .catch(() => setMentionableAgents([]));
  }, []);

  useEffect(() => {
    // A composer that unmounts mid-dictation drops the clip: `onstop` fires on
    // a component that is gone, and the hook releases the device itself.
    return () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (initialText !== undefined) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);


  const addFiles = (files: FileList | File[]) => {
    const newItems: PendingAttachment[] = Array.from(files).map((file) => {
      const isImage = file.type.startsWith("image/");
      return {
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        isImage,
      };
    });
    setPendingAttachments((prev) => [...prev, ...newItems]);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleRemoveAttachment = (id: string) => {
    const found = pendingAttachments.find((item) => item.id === id);
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
    if (found?.previewUrl) {
      // Revoke after the chip's exit animation (~150ms) so the preview
      // doesn't blank out mid-fade.
      const previewUrl = found.previewUrl;
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 250);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFiles(pastedFiles);
    }
  };

  /** Auto-expand the textarea to its content, up to the max height. */
  const resizeTextarea = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value;
    // The textarea shows committed text plus the live interim suffix — peel
    // the suffix back off so manual edits land on the real composer value.
    if (liveInterim && value.endsWith(liveInterim)) {
      value = value.slice(0, value.length - liveInterim.length).replace(/\s+$/, "");
    }
    if (value.length > MAX_CHARS) return;
    setText(value);

    resizeTextarea();

    // Detect `@` mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf("@");

    if (lastAt !== -1 && (lastAt === 0 || /\s/.test(textBeforeCursor[lastAt - 1]))) {
      const filter = textBeforeCursor.slice(lastAt + 1);
      if (!/\s/.test(filter)) {
        setToolsMenuOpen(false);
        setMentionState({ filter, index: lastAt });
        setMentionSelectedIndex(0);
        return;
      }
    }
    setMentionState(null);
  };

  const handleSelectMentionAgent = (agentItem: MentionableAgent) => {
    const textBeforeAt = text.slice(0, mentionState?.index ?? text.length);
    const textAfterCursor = mentionState
      ? text.slice(mentionState.index + 1 + mentionState.filter.length)
      : "";
    const nextText = `${textBeforeAt}@${agentItem.handle} ${textAfterCursor}`;
    setText(nextText);
    setActiveMentionAgent(agentItem);
    setMentionState(null);
    setToolsMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleSelectAction = (actionItem: DropdownActionItem) => {
    if (actionItem.promptPrefix) {
      if (!text.trim()) {
        setText(actionItem.promptPrefix);
      } else if (!text.startsWith(actionItem.promptPrefix)) {
        setText(`${actionItem.promptPrefix}${text}`);
      }
    }
    setMentionState(null);
    setToolsMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIndex((prev) => prev + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // The send button taps on its own press; Enter is the same send and
      // was the one way to send that made no sound at all.
      const sendable = !isBusy && (text.trim().length >= MIN_CHARS || pendingAttachments.length > 0);
      if (sendable) cue("tap", { input: "keyboard" });
      void handleSend();
    }
  };

  const handleSelectTool = (tool: (typeof TOOLS_MENU)[number]) => {
    // The tool shows up as a non-editable inline label above the textarea —
    // no prompt text is inserted into the message anymore, so nothing is
    // left behind when the tool is removed.
    setActiveToolMode(tool.id);
    setToolsMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    // Dictation must not keep writing into the next message: stop first, so
    // pending finals commit into this message and the interim suffix drops.
    if (voice.isListening) voice.stopListening();
    if (legacyListening && recorderRef.current) recorderRef.current.stop();
    const rawText = text.trim();
    if ((rawText.length < MIN_CHARS && pendingAttachments.length === 0) || isBusy) return;

    let targetAgent = activeMentionAgent;
    if (!targetAgent) {
      for (const a of mentionableAgents) {
        if (rawText.toLowerCase().includes(`@${a.handle.toLowerCase()}`)) {
          targetAgent = a;
          break;
        }
      }
    }

    const filesToSend = pendingAttachments.map((item) => item.file);

    setText("");
    setPendingAttachments([]);
    setMentionState(null);
    setActiveToolMode(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await onSubmit({
      text: rawText,
      files: filesToSend,
      mentionedAgent: targetAgent,
      toolMode: activeToolMode,
    });
  };

  /** Posts one clip and drops the text into the composer. */
  const transcribeClip = async (clip: Blob) => {
    if (clip.size === 0) return;
    setIsTranscribing(true);
    try {
      const body = new FormData();
      body.append("audio", clip, clipFilename(clip.type));
      const response = await fetch("/api/chat/transcribe", { method: "POST", body });
      if (!response.ok) {
        const { message } = await readApiError(response, t);
        toast({ title: message, status: "error" });
        return;
      }
      const transcript = ((await response.json()) as { text?: string }).text?.trim();
      if (!transcript) {
        toast({ title: t("chat.transcriptionEmpty"), status: "error" });
        return;
      }
      // Dictation is added to what is already typed, never on top of it: the
      // person may have written half the message before reaching for the mic.
      setText((prev) => {
        const kept = prev.replace(/\s+$/, "");
        const next = kept ? `${kept} ${transcript}` : transcript;
        return next.slice(0, MAX_CHARS);
      });
      textareaRef.current?.focus();
      resizeTextarea();
    } catch {
      // A network failure, or a route that never answered — `readApiError`
      // only covers a response we actually received.
      toast({ title: t("chat.transcriptionFailed"), status: "error" });
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = (stream: MediaStream) => {
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const clip = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];
      recorderRef.current = null;
      // The device is released as soon as the clip is closed, so the browser's
      // recording indicator goes out while the transcription is still running.
      mic.stop();
      void transcribeClip(clip);
    };
    recorderRef.current = recorder;
    recorder.start();
  };

  const handleToggleMic = async () => {
    // Primary path: the browser transcribes live while the glow stream keeps
    // the beam reacting. `mic.start()` asks for permission when needed.
    if (voice.isSupported) {
      if (voice.isListening) {
        voice.stopListening();
        mic.stop();
        return;
      }
      let stream: MediaStream | null = null;
      try {
        stream = await mic.start();
      } catch {
        stream = null;
      }
      if (!stream) return;
      voice.startListening();
      return;
    }
    // Fallback for browsers without Web Speech: record a clip, transcribe it
    // server-side when the mic closes.
    if (legacyListening) {
      // `stop()` fires `onstop`, which is where the clip is closed and posted.
      if (recorderRef.current) recorderRef.current.stop();
      else mic.stop();
      return;
    }
    const stream = await mic.start();
    if (stream) startRecording(stream);
  };

  const micLabel =
    mic.state === "denied"
      ? t("chat.micDenied")
      : isTranscribing
        ? t("chat.transcribing")
        : isListening
          ? voice.isSupported
            ? t("chat.stopDictation")
            : t("chat.stopListening")
          : voice.isSupported
            ? t("chat.dictate")
            : t("chat.listen");

  const activeToolLabel = TOOLS_MENU.find((tool) => tool.id === activeToolMode)?.label ?? "Tools";

  return (
    // The glow sits on the composer's bottom edge: it reacts to the
    // microphone while listening, and gathers into one travelling beam while
    // the agent is working. Off the rest of the time, so an idle composer
    // stays still. The dropdowns are Radix portals, so the package's
    // `overflow: hidden` root does not clip them.
    <VoiceBeamGlow
      stream={isListening ? mic.stream : null}
      colorVariant="mono"
      borderRadius={20}
      strength={isListening ? undefined : 0.45}
      glowHeight={isListening ? undefined : 0.45}
      glowWidth={isListening ? undefined : 0.4}
      processingLevel={0.28}
      processing={isBusy || isTranscribing}
      active={isListening || isBusy || isTranscribing}
    >
      {/* Double border, same treatment as the agent cards on /agents: a muted
          outer frame (`rounded-[20px] border-border/70 p-1.5`) holding the
          actual composer panel (`rounded-[14px] border-border/50 bg-card`)
          with a 6px muted gap between the two lines. */}
      <div
      ref={containerRef}
      className="relative w-full rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)] transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-[var(--field-focus-border)] focus-within:shadow-[var(--shadow-float),var(--field-focus-halo)]"
    >
      {/* Attachment chips live in the outer frame's gap — inside the first
          border, outside the inner composer panel. Renders null when empty. */}
      <ChatAttachmentsPreview
        attachments={pendingAttachments}
        onRemove={handleRemoveAttachment}
      />

      <div className="rounded-[14px] border border-border/50 bg-card p-4 shadow-xs">
      {/* Hidden File Picker */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
        accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx"
      />

      {/* Active tool / agent as an inline, non-editable label — blue text
          with its icon beside it, sitting in the input flow above the
          textarea. It is a separate element (not part of the textarea
          value), so it can't be selected or edited with the message text,
          and it animates in and out instead of appearing abruptly. */}
      <AnimatePresence>
        {activeMentionAgent || activeToolMode ? (
          <motion.div
            initial={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -4, scale: 0.96, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={
              reducedMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    y: -4,
                    scale: 0.96,
                    filter: "blur(4px)",
                    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
                  }
            }
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="flex w-full items-center gap-1.5 px-1 pb-1.5 select-none"
          >
            <HugeiconsIcon
              icon={
                activeMentionAgent
                  ? CallSpark02Icon
                  : TOOLS_MENU.find((tool) => tool.id === activeToolMode)?.icon ?? ToolCaseIcon
              }
              size={14}
              strokeWidth={2}
              className="text-primary shrink-0"
            />
            <span className="text-primary max-w-44 truncate text-[13px] font-medium">
              {activeMentionAgent ? `@${activeMentionAgent.name}` : activeToolLabel}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setActiveMentionAgent(null);
                    setActiveToolMode(null);
                  }}
                  className="text-primary/50 rounded-md p-0.5 transition-colors hover:bg-primary/10 hover:text-primary"
                  aria-label={t("chat.removeMode")}
                >
                  <HugeiconsIcon icon={XIcon} size={11} strokeWidth={2.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("chat.removeMode")}</TooltipContent>
            </Tooltip>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Textarea — shows committed text plus the live interim dictation
          suffix while listening. One composer, one state. */}
      <textarea
        ref={textareaRef}
        value={displayText}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder ?? "Ask anything…"}
        rows={1}
        className="w-full resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none max-h-56"
      />

      {/* Mention dropdown with smooth open/close motion */}
      <AgentMentionDropdown
        open={isMentionOpen}
        anchorRef={containerRef}
        agents={mentionableAgents}
        filter={mentionState?.filter ?? ""}
        selectedIndex={mentionSelectedIndex}
        onSelectAgent={handleSelectMentionAgent}
        onSelectAction={handleSelectAction}
        onClose={() => setMentionState(null)}
        onTriggerFilePicker={() => fileInputRef.current?.click()}
        isEmpty={isEmpty}
      />

      {/* Bottom action bar with Tooltips */}
      <TooltipProvider delayDuration={150}>
        <div className="relative flex items-center gap-2 pt-4 px-0.5">
          {/* Attach button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                className={COMPOSER_ACTION}
                aria-label={t("chat.attachFile")}
              >
                <HugeiconsIcon icon={PaperclipIcon} size={16} strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("chat.attachFiles")}</TooltipContent>
          </Tooltip>

          {/* Tools button */}
          <div className="relative" ref={toolsMenuRef}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setMentionState(null);
                    setToolsMenuOpen((prev) => !prev);
                  }}
                  className={cn(COMPOSER_ACTION, "relative z-40", toolsMenuOpen && "bg-[var(--btn-outline-bg-hover)] text-foreground")}
                  aria-label={t("chat.tools")}
                  aria-haspopup="dialog"
                  aria-expanded={toolsMenuOpen}
                >
                  <HugeiconsIcon icon={ToolCaseIcon} size={16} strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("chat.tools")}</TooltipContent>
            </Tooltip>

            <ChatDropdown
              open={toolsMenuOpen}
              onClose={() => setToolsMenuOpen(false)}
              anchorRef={toolsMenuRef}
              side={isEmpty ? "bottom" : "top"}
              label={t("chat.tools")}
              className="w-60"
            >
              <div className="y-fade min-h-0 overflow-y-auto overscroll-contain select-none p-1.5">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 border-b border-border/30 mb-1">
                  {t("chat.toolsHeader")}
                </div>
                <div className="space-y-0.5">
                  {TOOLS_MENU.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTool(item)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors",
                        activeToolMode === item.id
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <HugeiconsIcon icon={item.icon} size={15} strokeWidth={1.75} className="shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  ))}

                  <div className="my-1 border-t border-border/30" />

                  <button
                    type="button"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      const next = text.endsWith(" ") || !text ? `${text}@` : `${text} @`;
                      setText(next);
                      setMentionState({ filter: "", index: next.length - 1 });
                      textareaRef.current?.focus();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                  >
                    <HugeiconsIcon icon={CallSpark02Icon} size={15} strokeWidth={1.75} className="text-primary shrink-0" />
                    <span>{t("chat.callAgent")}</span>
                  </button>
                </div>
              </div>
            </ChatDropdown>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Character counter if text is getting long */}
          {text.length > 2000 && (
            <span className="text-[11px] font-mono text-muted-foreground/60 mr-1">
              {text.length}/{MAX_CHARS}
            </span>
          )}

          {/* Microphone — live dictation into the composer. Hidden until
              mount (`canDictate` above) and on a browser with no capture or
              recognition at all. While listening the icon switches to
              mic-off and the tooltip offers to stop. */}
          {canDictate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={isListening ? "destructive" : "outline"}
                  size="icon"
                  onClick={() => void handleToggleMic()}
                  disabled={mic.state === "requesting" || isTranscribing}
                  aria-pressed={isListening}
                  aria-label={isListening ? t("chat.stopDictation") : t("chat.dictate")}
                  className={cn(COMPOSER_ACTION, isListening && "text-[var(--btn-destructive-fg)]")}
                >
                  <ActionSwapRollIcon
                    value={isListening || mic.state === "denied" ? "off" : "on"}
                    className="size-4"
                  >
                    <HugeiconsIcon
                      icon={
                        isListening || mic.state === "denied" ? MicOff02Icon : Mic02Icon
                      }
                      size={16}
                      strokeWidth={2}
                    />
                  </ActionSwapRollIcon>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{micLabel}</TooltipContent>
            </Tooltip>
          ) : null}

          {/* Send / Stop button with Tooltip */}
          {isBusy ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => void onStop()}
                  // Stopping a reply is a dismissal, not a commit.
                  data-cuelume-close
                  variant="destructive"
                  size="icon"
                  className="size-9 rounded-2xl p-0 md:size-9"
                  aria-label={t("chat.stopResponse")}
                >
                  <HugeiconsIcon icon={StopIcon} size={14} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("chat.stopResponse")}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <SendButton
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={text.trim().length < MIN_CHARS && pendingAttachments.length === 0}
                  aria-label={t("chat.send")}
                />
              </TooltipTrigger>
              <TooltipContent side="top">{t("chat.send")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
      </div>
    </div>
    </VoiceBeamGlow>
  );
}
