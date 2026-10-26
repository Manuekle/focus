"use client";

import "../../product.css";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  ArrowLeft01Icon,
  AiElementsIcon,
  AiImagineIcon,
  BubbleChatIcon,
  Call02Icon,
  Cancel01Icon,
  PanelLeftIcon,
} from "@hugeicons/core-free-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { DockReopenButton } from "@/app/_components/dock-reopen-button";
import { DockResizeHandle, useDockWidth } from "@/components/dock-resize";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModelCatalog } from "@/components/ai-elements/model-picker";
import { useCelebrate } from "@/components/use-celebrate";
import { useT, useAppLocale } from "@/lib/i18n/provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { cn } from "@/lib/utils";
import {
  emptyBrief,
  normalizeBrief,
  readiness,
} from "@/lib/agent-brief";
import { toCapabilityIds } from "@/lib/agent-capabilities";
import type { Agent, AgentBrief, ChannelId } from "@/lib/types";
import type { BlueprintSection, SectionId } from "../_components/agent-blueprint";
import { AgentSettingsNavigation, AgentReadiness } from "../_components/agent-settings-navigation";
import {
  AgentSectionPanel,
  type AgentDraft,
  type BusinessContext,
} from "../_components/agent-section-panel";
import { AgentAssistant, seedKey, type AssistantPatch } from "../_components/agent-assistant";
import type { CapabilityOption } from "../_components/capability-picker";
import { Button } from "@/components/ui/button";
import { AgentToolbarActionsSkeleton, WorkspaceSkeleton } from "@/components/ai-elements/skeleton";
import { AgentSharedAvatar, AgentSharedTitle, useAgentNavigation } from "../_components/agent-navigation";

// Direct section editing with the assistant docked beside it, the way the
// automation editor docks its own: the settings and the interview are on
// screen together, so a proposal lands in the section you are looking at.
// The dock stays mounted when closed, so its conversation survives.

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DOCK_OPEN_KEY = "oruka:agent-dock-open";
const DOCK_WIDTH_KEY = "oruka:agent-dock-width";
const DOCK_MIN = 340;
const DOCK_MAX = 620;
/** Editor width from which the dock sits beside the settings instead of over them. */
const DOCK_INLINE_FROM = 1180;

const SECTION_ORDER: readonly SectionId[] = [
  "identity",
  "brief",
  "rules",
  "capabilities",
  "prompt",
  "channels",
  "model",
  "voice",
  "business",
];

export default function AgentBuilderPage() {
  const params = useParams<{ id: string }>();
  // A second agent reached before the first request resolves must not inherit
  // that agent's draft, loading header or pending request.
  return <AgentBuilder key={params.id} id={params.id} />;
}

function AgentBuilder({ id }: { readonly id: string }) {
  const t = useT();
  const { locale } = useAppLocale();
  const router = useRouter();
  const celebrate = useCelebrate();
  const navigation = useAgentNavigation();
  const [preview] = useState(() => navigation.read().agents?.find((item) => item.id === id));
  const loadController = useRef<AbortController | null>(null);
  const backToList = () => router.push("/agents", { scroll: false, transitionTypes: ["oruka-agent"] });

  const { data: catalog, loading: catalogLoading } = useModelCatalog(undefined, true);

  const [agent, setAgent] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [changingStatus, setChangingStatus] = useState(false);

  const [dockOpen, setDockOpen] = useState(true);
  const { width: dockWidth, resizing: isResizing, startResize } = useDockWidth({ storageKey: DOCK_WIDTH_KEY, min: DOCK_MIN, max: DOCK_MAX, initial: 380 });
  const editorRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SectionId>("identity");

  const [capabilities, setCapabilities] = useState<CapabilityOption[]>([]);
  const [channels, setChannels] = useState<ChannelId[]>([]);
  const [assignments, setAssignments] = useState<Partial<Record<ChannelId, string>>>({});
  const [business, setBusiness] = useState<BusinessContext>({
    name: "",
    description: "",
    knowledgeDocuments: 0,
    hasProfile: false,
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<(() => void) | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const selectSection = (next: SectionId) => setSection(next);

  useEffect(() => {
    try {
      // A seeded interview (from "create with the assistant") always opens it.
      if (sessionStorage.getItem(seedKey(id))) return;
      const stored = localStorage.getItem(DOCK_OPEN_KEY);
      // Where the dock would float over the settings, opening it by default
      // would hide the section someone came here to edit.
      const narrow = (editorRef.current?.clientWidth ?? window.innerWidth) < DOCK_INLINE_FROM;
      if (stored === "0" || (stored === null && narrow)) setDockOpen(false);
    } catch {
      // Private mode / blocked storage — defaults are fine.
    }
  }, [id]);

  const setDockOpenPersisted = (open: boolean) => {
    setDockOpen(open);
    try {
      localStorage.setItem(DOCK_OPEN_KEY, open ? "1" : "0");
    } catch {
      // Best-effort.
    }
  };

  // ── Loading ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const result = await fetchJson<{ agents?: Agent[] }>("/api/agents", t, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!result.ok) {
      // A load that failed is not the same as an agent that isn't there.
      setError(result.error);
      navigation.discardAgents();
      setIsLoading(false);
      return;
    }
    navigation.rememberAgents(result.data.agents ?? []);
    const found = result.data.agents?.find((a) => a.id === id);
    if (!found) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    // Keep the read-only header's snapshot intact during navigation. A fast
    // response must not urgently unmount it and cut the shared morph short.
    startTransition(() => {
      setError(null);
      setAgent(found);
      setDraft((current) =>
      // A refresh must never overwrite what is being typed — only the first
      // load seeds the draft.
      current ?? {
        name: found.name,
        description: found.description,
        systemPrompt: found.systemPrompt,
        brief: found.brief ? normalizeBrief(found.brief) : emptyBrief(),
        tools: toCapabilityIds(found.tools),
        model: found.model ?? null,
      },
      );
      setIsLoading(false);
    });
  }, [id, t, navigation]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [caps, routing, profile, knowledge] = await Promise.all([
        fetchJson<{ capabilities: CapabilityOption[] }>("/api/agents/capabilities", t),
        fetchJson<{ channels: ChannelId[]; assignments: Partial<Record<ChannelId, string>> }>(
          "/api/channels/agents",
          t,
        ),
        fetchJson<{
          identity?: { name?: string; description?: string };
          record?: { profile?: { name?: string; description?: string } } | null;
        }>("/api/business-profile", t),
        fetchJson<{ documents?: unknown[] }>("/api/knowledge", t),
      ]);
      if (cancelled) return;
      startTransition(() => {
        if (caps.ok) setCapabilities(caps.data.capabilities);
        if (routing.ok) {
          setChannels(routing.data.channels);
          setAssignments(routing.data.assignments);
        }
        setBusiness({
        name: profile.ok ? (profile.data.identity?.name ?? profile.data.record?.profile?.name ?? "") : "",
        description: profile.ok
          ? (profile.data.identity?.description ?? profile.data.record?.profile?.description ?? "")
          : "",
        knowledgeDocuments: knowledge.ok ? (knowledge.data.documents?.length ?? 0) : 0,
        hasProfile: profile.ok ? Boolean(profile.data.record) : false,
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // ── Autosave ───────────────────────────────────────────────────────

  const scheduleSave = useCallback(
    (next: AgentDraft) => {
      setSaveStatus("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const revision = ++saveRevision.current;
      pendingSave.current = () => {
        pendingSave.current = null;
        // Serialize writes so a slower older save cannot replace a newer draft.
        saveQueue.current = saveQueue.current.then(async () => {
          const result = await fetchJson<{ agent?: Agent }>("/api/agents", t, {
            method: "PUT",
            keepalive: true,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agentId: id,
              name: next.name,
              description: next.description,
              tools: next.tools,
              model: next.model,
              brief: next.brief,
              locale,
              // Only sent when the owner took the prompt over; otherwise the
              // server composes it from the brief and this field would pin an
              // already-stale copy.
              ...(next.brief.promptCustomized ? { systemPrompt: next.systemPrompt } : {}),
            }),
          });
          if (revision !== saveRevision.current) return;
          if (!result.ok) {
            // An autosave that quietly gave up left the workspace looking saved.
            setSaveStatus("error");
            setError(result.error);
            return;
          }
          const saved = result.data.agent;
          if (saved) {
            navigation.rememberAgent(saved);
            setAgent(saved);
            // The composed prompt comes back from the server, which is the
            // only place composition happens — mirroring it in the browser
            // would be a second implementation to keep in step.
            setDraft((current) =>
              current && !current.brief.promptCustomized
                ? { ...current, systemPrompt: saved.systemPrompt }
                : current,
            );
          }
          setError(null);
          setSaveStatus("saved");
        });
      };
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        pendingSave.current?.();
      }, 700);
    },
    [id, locale, t, navigation],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Leaving for chat, voice or the list must send the last keystrokes too.
      pendingSave.current?.();
    };
  }, []);

  const update = useCallback(
    (patch: Partial<AgentDraft>) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  /** Apply a proposal from the interview. Capabilities arrive as the complete
   *  list the assistant wants, so they replace rather than merge. */
  const applyPatch = useCallback(
    (patch: AssistantPatch) => {
      setDraft((current) => {
        if (!current) return current;
        const brief: AgentBrief = normalizeBrief({
          ...current.brief,
          ...(patch.brief ?? {}),
          updatedAt: new Date().toISOString(),
        });
        // `normalizeBrief` drops the flag unless it is set, so a customized
        // prompt stays customized across a patch.
        const next: AgentDraft = {
          ...current,
          name: patch.name?.trim() || current.name,
          description: patch.description?.trim() || current.description,
          brief: current.brief.promptCustomized ? { ...brief, promptCustomized: true } : brief,
          tools: patch.capabilities ? [...patch.capabilities] : current.tools,
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const assignChannel = async (channel: ChannelId, agentId: string | null) => {
    const result = await fetchJson<{ assignments: Partial<Record<ChannelId, string>> }>(
      "/api/channels/agents",
      t,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, agentId }),
      },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAssignments(result.data.assignments);
  };

  const toggleStatus = async (from: HTMLElement | null) => {
    if (changingStatus || saveStatus === "saving") return;
    setChangingStatus(true);
    const result = await fetchJson<{ agent?: Agent }>("/api/agents", t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: id, toggleStatus: true }),
    });
    setChangingStatus(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = result.data.agent;
    if (saved) {
      navigation.rememberAgent(saved);
      setAgent(saved);
    }
    // Turning an agent on is the moment it starts working for you. Turning it
    // off is not, and neither is saving a field.
    if (saved?.status === "active") celebrate(from ? { from } : undefined);
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-10 py-14 text-center shadow-[var(--shadow-soft)]">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={AiImagineIcon} size={20} strokeWidth={1.75} />
          </div>
          <p className="text-sm font-medium">{t("builder.notFound")}</p>
          <Button variant="outline" className="mt-2" onClick={() => router.push("/agents")}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
            {t("builder.backToList")}
          </Button>
        </div>
      </div>
    );
  }

  if (!isLoading && !agent && error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-full max-w-md">
          <ErrorBanner error={error} onRetry={() => void load()} />
          <Button variant="outline" className="mt-4" onClick={() => router.push("/agents")}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
            {t("builder.backToList")}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !agent || !draft) {
    if (!preview) return <WorkspaceSkeleton kind="agent" />;
    // Keep the same header/identity nodes through the loading → ready commit.
    // Replacing the entire skeleton used to unmount the named participants
    // mid-morph and make React end the browser transition early.
    return (
      <div className="@container/agent-editor flex h-full min-h-0 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={backToList} aria-label={t("builder.backToList")} className="shrink-0 text-muted-foreground">
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("builder.backToList")}</TooltipContent>
            </Tooltip>
            <AgentWorkspaceIdentity agent={preview} name={preview.name} />
            <AgentToolbarActionsSkeleton />
          </div>
          {preview.status === "draft" ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border bg-muted/30 px-4 py-1.5">
              <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("builder.draftLabel")}</span>
              <span className="h-3 w-px bg-border" />
              <span className="text-[11px] text-muted-foreground">{t("builder.draftHint")}</span>
            </div>
          ) : null}
        </header>
        <WorkspaceSkeleton kind="agent" canvasOnly />
      </div>
    );
  }

  const channelAssigned = Object.values(assignments).some((assigned) => assigned === id);
  const state = readiness({
    agent: {
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      tools: [...draft.tools],
      brief: draft.brief,
    },
    channelAssigned,
    knowledgeDocuments: business.knowledgeDocuments,
  });

  const sections = buildSections({
    draft,
    capabilities,
    catalogLabel:
      draft.model === null
        ? (catalog?.tasks?.chat ?? "")
        : (catalog?.models.find((model) => model.id === draft.model)?.label ?? draft.model),
    channelAssigned,
    assignments,
    agentId: id,
    voiceEnabled: Boolean(agent.voice?.enabled),
    business,
    t,
  });

  return (
    <div className="@container/agent-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Workspace toolbar */}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={backToList} aria-label={t("builder.backToList")} className="shrink-0 text-muted-foreground">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("builder.backToList")}</TooltipContent>
          </Tooltip>

          <AgentWorkspaceIdentity agent={agent} name={draft.name || t("builder.untitled")} saveStatus={saveStatus} />

          {/* Beside the button it blocks; on a narrow editor it drops to its
              own line under the name instead of adding a band. */}
          <AgentReadiness
            checks={state.checks}
            onSelect={selectSection}
            className="order-last w-full pl-11 @min-[720px]/agent-editor:order-none @min-[720px]/agent-editor:w-auto @min-[720px]/agent-editor:pl-0"
          />

          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/agents/${id}/chat`} aria-label={t("builder.testChat")}>
                <HugeiconsIcon icon={BubbleChatIcon} size={16} strokeWidth={1.75} />
                <span className="hidden @min-[960px]/agent-editor:inline">{t("builder.testChat")}</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/agents/${id}/voice`} aria-label={t("builder.testVoice")}>
                <HugeiconsIcon icon={Call02Icon} size={16} strokeWidth={1.75} />
                <span className="hidden @min-[960px]/agent-editor:inline">{t("builder.testVoice")}</span>
              </Link>
            </Button>
            <Button
              size="sm"
              className="ml-1"
              variant={agent.status === "active" ? "outline" : "default"}
              onClick={(event) => void toggleStatus(event.currentTarget)}
              aria-busy={changingStatus}
              disabled={changingStatus || saveStatus === "saving" || (agent.status !== "active" && (saveStatus === "error" || !state.ready))}
              title={!state.ready && agent.status !== "active" ? t("builder.activateBlocked") : undefined}
            >
              {agent.status === "active" ? t("builder.pause") : t("builder.activate")}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setDockOpenPersisted(!dockOpen)}
                  aria-label={t("builder.assistantTab")}
                  aria-pressed={dockOpen}
                >
                  <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.75} className="rotate-180" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("builder.assistantTab")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {agent.status === "draft" ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border bg-muted/30 px-4 py-1.5">
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              {t("builder.draftLabel")}
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="text-[11px] text-muted-foreground">{t("builder.draftHint")}</span>
          </div>
        ) : null}

        {error ? (
          <ErrorBanner
            layout="strip"
            error={error}
            onRetry={saveStatus === "error" ? () => scheduleSave(draft) : undefined}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </header>

      {/* Settings + dock */}
      <div ref={editorRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card @min-[760px]/agent-editor:flex-row">
        <AgentSettingsNavigation sections={sections} selected={section} onSelect={selectSection} />
        <div className="relative min-h-0 min-w-0 flex-1 bg-card">
          <div key={section} className="h-full">
            <AgentSectionPanel
              section={section}
              agentId={id}
              status={agent.status}
              draft={draft}
              onChange={update}
              capabilities={capabilities}
              catalog={catalog}
              catalogLoading={catalogLoading}
              channels={channels}
              assignments={assignments}
              onAssignChannel={(channel, assignedId) => void assignChannel(channel, assignedId)}
              business={business}
              voiceEnabled={Boolean(agent.voice?.enabled)}
            />
          </div>
          {!dockOpen ? (
            <DockReopenButton
              variant="ai"
              className="hidden @min-[760px]/agent-editor:block"
              icon={AiElementsIcon}
              label={t("builder.assistantTab")}
              onClick={() => setDockOpenPersisted(true)}
            />
          ) : null}
        </div>

        <DockResizeHandle
          resizing={isResizing}
          onPointerDown={startResize}
          label={t("builder.resizeAssistant")}
          className={dockOpen ? "hidden @min-[1180px]/agent-editor:block" : "hidden"}
        />
        {/* Narrower than DOCK_INLINE_FROM the dock floats over the settings
            instead of squeezing them into a strip. */}
        <aside
          aria-label={t("builder.assistantTab")}
          aria-hidden={!dockOpen}
          inert={!dockOpen}
          data-open={dockOpen}
          data-resizing={isResizing}
          style={{ width: dockOpen ? dockWidth : 0 }}
          className={cn(
            "t-dock flex min-h-0 flex-col overflow-hidden bg-card",
            "absolute inset-y-0 right-0 z-30 max-w-full shadow-[var(--shadow-float)]",
            "@min-[1180px]/agent-editor:static @min-[1180px]/agent-editor:z-auto @min-[1180px]/agent-editor:shrink-0 @min-[1180px]/agent-editor:shadow-none",
            dockOpen ? "border-l border-border @min-[1180px]/agent-editor:border-l-0" : "border-l-0 shadow-none",
          )}
        >
          {/* Fixed inner width, so the conversation doesn't reflow while the
              aside's own width animates shut. */}
          <div className="t-panel-slide flex h-full min-h-0 max-w-full flex-col" data-open={dockOpen} style={{ width: dockWidth }}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border py-2 pr-2 pl-4">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <HugeiconsIcon icon={AiElementsIcon} size={15} strokeWidth={1.75} className="text-muted-foreground" />
                {t("builder.assistantTab")}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => setDockOpenPersisted(false)} aria-label={t("builder.closeAssistant")}>
                <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.75} />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <AgentAssistant agentId={id} draft={draft} onApply={applyPatch} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Summaries shared by the settings navigation and the current draft. */
function buildSections({
  draft,
  capabilities,
  catalogLabel,
  channelAssigned,
  assignments,
  agentId,
  voiceEnabled,
  business,
  t,
}: {
  readonly draft: AgentDraft;
  readonly capabilities: readonly CapabilityOption[];
  readonly catalogLabel: string;
  readonly channelAssigned: boolean;
  readonly assignments: Partial<Record<ChannelId, string>>;
  readonly agentId: string;
  readonly voiceEnabled: boolean;
  readonly business: BusinessContext;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): BlueprintSection[] {
  const chosen = capabilities.filter((capability) => draft.tools.includes(capability.id));
  const unconfigured = chosen.filter((capability) => !capability.configured);
  const mine = (Object.entries(assignments) as [ChannelId, string | undefined][])
    .filter(([, assigned]) => assigned === agentId)
    .map(([channel]) => channel);

  const map: Record<SectionId, BlueprintSection> = {
    identity: {
      id: "identity",
      summary: [draft.name, draft.description].filter(Boolean).join(" — "),
      done: Boolean(draft.name.trim() && draft.description.trim()),
    },
    brief: {
      id: "brief",
      summary: [draft.brief.role, draft.brief.goal].filter(Boolean).join(" — "),
      done: Boolean(draft.brief.role && draft.brief.goal),
    },
    rules: {
      id: "rules",
      summary:
        draft.brief.rules.length + draft.brief.avoid.length > 0
          ? t("builder.rulesSummary", {
              rules: draft.brief.rules.length,
              avoid: draft.brief.avoid.length,
            })
          : "",
      done: draft.brief.rules.length > 0 || Boolean(draft.brief.handoff),
    },
    prompt: {
      id: "prompt",
      summary: draft.systemPrompt.trim().slice(0, 140),
      done: draft.systemPrompt.trim().length >= 40,
    },
    capabilities: {
      id: "capabilities",
      summary: chosen.map((capability) => t(capability.labelKey)).join(", "),
      done: draft.tools.length > 0,
      warning:
        unconfigured.length > 0
          ? t("builder.capabilitiesUnconfigured", { count: unconfigured.length })
          : undefined,
    },
    channels: {
      id: "channels",
      summary: mine.join(", "),
      done: channelAssigned,
    },
    model: { id: "model", summary: catalogLabel, done: true },
    voice: {
      id: "voice",
      summary: voiceEnabled ? t("builder.voiceOn") : "",
      done: voiceEnabled,
    },
    business: {
      id: "business",
      summary: [business.name, t("builder.businessKnowledge", { count: business.knowledgeDocuments })]
        .filter(Boolean)
        .join(" — "),
      done: Boolean(business.name) && business.knowledgeDocuments > 0,
    },
  };

  return SECTION_ORDER.map((id) => map[id]);
}

/** Autosave state, kept as quiet as it should be: a dot and a word. */
function AgentWorkspaceIdentity({ agent, name, saveStatus }: { readonly agent: Agent; readonly name: string; readonly saveStatus?: SaveStatus }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <AgentSharedAvatar agent={agent} compact />
      <AgentSharedTitle id={agent.id}>
        <h1 className="min-w-0 flex-1 truncate text-lg font-medium tracking-[-0.02em]">{name}</h1>
      </AgentSharedTitle>
      <span className="hidden shrink-0 @min-[480px]/agent-editor:block"><StatusBadge status={agent.status === "active" ? "active" : agent.status === "draft" ? "draft" : "paused"}
        label={agent.status === "active" ? t("agents.active") : undefined} /></span>
      {saveStatus ? <span className="hidden shrink-0 @min-[640px]/agent-editor:inline-flex"><SaveIndicator status={saveStatus} /></span> : null}
    </div>
  );
}

function SaveIndicator({ status }: { readonly status: SaveStatus }) {
  const t = useT();
  return (
    <span role="status" className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "saving" ? "animate-pulse bg-muted-foreground/60" : status === "error" ? "bg-destructive" : "bg-foreground/60",
        )}
      />
      {status === "saving" ? t("automations.saving") : status === "error" ? t("builder.saveFailed") : status === "saved" ? t("automations.saved") : t("builder.autosave")}
    </span>
  );
}
