"use client";

import "../product.css";
import { EditorSkeleton } from "./page-skeleton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  Delete02Icon,
  Mail02Icon,
  PanelLeftIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeEditor } from "@/components/email-editor/code-editor";
import { useFieldLabel } from "@/components/email-editor/chip-editor";
import { EmailCanvas } from "@/components/email-editor/email-canvas";
import { NewTemplateDialog } from "@/components/email-editor/new-template-dialog";
import { PreviewPane } from "@/components/email-editor/preview-pane";
import { TemplateRail, type TemplateItem } from "@/components/email-editor/template-rail";
import { TestSend, type EmailProvider } from "@/components/email-editor/test-send";
import { VariableInspector } from "@/components/email-editor/variable-inspector";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { designToSource, designVariables, type EmailDesign } from "@/lib/email-design";
import { emailPreset, presetForBuiltin, type PresetId } from "@/lib/email-presets";
import { useAppLocale, useT } from "@/lib/i18n/provider";
import { useSound } from "@/components/sound-provider";
import { useCelebrate } from "@/components/use-celebrate";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DockReopenButton } from "@/app/_components/dock-reopen-button";

const DOCK_MIN = 320;
const DOCK_MAX = 560;
const DOCK_WIDTH_KEY = "oruka:email-dock-width";
const DOCK_OPEN_KEY = "oruka:email-dock-open";
const PREVIEW_DEBOUNCE_MS = 450;
/** A visual template saves itself this long after the last change. */
const AUTOSAVE_MS = 900;
const HISTORY_LIMIT = 50;
/** Keystrokes into the same block closer together than this are one undo step. */
const COALESCE_MS = 1500;

type TemplateMeta = TemplateItem & {
  readonly subject: string;
  readonly sample: Record<string, unknown>;
  readonly design?: EmailDesign;
};

/** What the open template is edited as. */
type Mode = "visual" | "code" | "builtin";
type DockTab = "preview" | "test";
type SaveStatus = "idle" | "saving" | "saved";

type PreviewState = {
  readonly html: string | null;
  readonly subject: string | null;
  readonly error: string | null;
  readonly loading: boolean;
};

const NO_PREVIEW: PreviewState = { html: null, subject: null, error: null, loading: false };

type DesignHistory = {
  readonly past: readonly EmailDesign[];
  readonly present: EmailDesign;
  readonly future: readonly EmailDesign[];
  readonly key?: string;
  readonly at: number;
};

/** Everything a save sends, frozen at one edit. */
type Snapshot = {
  readonly id: string;
  readonly revision: number;
  readonly label: string;
  readonly subject: string;
  readonly sample: Record<string, unknown>;
  readonly design: EmailDesign | null;
  readonly source: string;
};

type Draft = {
  readonly label: string;
  readonly description: string;
  readonly subject: string;
  readonly sample: Record<string, unknown>;
  readonly design?: EmailDesign;
  readonly source?: string;
};

/**
 * The email template workspace.
 *
 * Templates are built in a visual editor: blocks dragged onto an email that
 * looks like the one that arrives, saved as you go. The five that ship with
 * the app are shown as they send and can be turned into an editable copy;
 * templates written as code before the visual editor existed still open in
 * the code editor.
 */
export default function EmailTemplatesPage() {
  const t = useT();
  const { locale } = useAppLocale();
  const { cue } = useSound();
  const celebrate = useCelebrate();
  const labelFor = useFieldLabel();

  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [provider, setProvider] = useState<EmailProvider | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [preview, setPreview] = useState<PreviewState>(NO_PREVIEW);

  // The open template's working copy.
  const [label, setLabel] = useState("");
  const [subject, setSubject] = useState("");
  const [source, setSource] = useState("");
  const [history, setHistory] = useState<DesignHistory | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  /** Edits made and edits saved. Never reset, so a save that finishes after
   *  another template was opened cannot mark that one as saved. */
  const [revision, setRevision] = useState({ edits: 0, saved: 0 });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<UiError | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateMeta | null>(null);

  // Below `md` the rail has no room beside the editor, so it opens as a
  // drawer from the toolbar instead of disappearing with no way to switch.
  const [railOpen, setRailOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockWidth, setDockWidth] = useState(400);
  const [dockTab, setDockTab] = useState<DockTab>("preview");
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const selected = useMemo(
    () => templates.find((item) => item.id === selectedId) ?? null,
    [templates, selectedId],
  );
  const design = history?.present ?? null;
  const mode: Mode | null = !selected ? null : selected.source === "builtin" ? "builtin" : design ? "visual" : "code";
  const dirty = revision.edits !== revision.saved;

  const displayLabel = useCallback(
    (item: TemplateItem) => (item.labelKey ? t(item.labelKey, undefined, item.label) : item.label),
    [t],
  );

  /** What actually renders: the visual design compiled here, so the preview
   *  and a test send show the unsaved state. */
  const renderSource = useMemo(
    () => (mode === "visual" && design ? designToSource(design, subject) : mode === "code" ? source : null),
    [mode, design, subject, source],
  );
  const fieldNames = useMemo(
    () => (mode === "visual" && design ? designVariables(design, subject) : (selected?.variables ?? [])),
    [mode, design, subject, selected],
  );
  /** A field with no sample value previews as its own name, not as a hole. */
  const previewValues = useMemo(() => {
    if (mode !== "visual") return variables;
    const values: Record<string, unknown> = { ...variables };
    for (const name of fieldNames) {
      if (values[name] === undefined || values[name] === "") values[name] = `[${labelFor(name)}]`;
    }
    return values;
  }, [mode, variables, fieldNames, labelFor]);

  // ── Dock geometry ────────────────────────────────────────────────

  useEffect(() => {
    try {
      const width = Number(localStorage.getItem(DOCK_WIDTH_KEY));
      if (Number.isFinite(width) && width >= DOCK_MIN) {
        setDockWidth(Math.min(width, DOCK_MAX));
      }
      const open = localStorage.getItem(DOCK_OPEN_KEY);
      // Below `lg` the dock covers the editor, so it starts closed there
      // unless the owner left it open.
      setDockOpen(open !== null ? open === "1" : window.matchMedia("(min-width: 1024px)").matches);
    } catch {
      // Private mode, or storage disabled — the defaults are fine.
    }
  }, []);

  const setDockOpenPersisted = useCallback((open: boolean) => {
    setDockOpen(open);
    try {
      localStorage.setItem(DOCK_OPEN_KEY, open ? "1" : "0");
    } catch {
      // Best-effort.
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event: PointerEvent) => {
      const start = resizeRef.current;
      if (!start) return;
      // Dragging left widens the dock: it's anchored to the right edge.
      const next = start.startWidth - (event.clientX - start.startX);
      setDockWidth(Math.max(DOCK_MIN, Math.min(DOCK_MAX, next)));
    };
    const onUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(DOCK_WIDTH_KEY, String(dockWidth));
      } catch {
        // Best-effort.
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isResizing, dockWidth]);

  // ── Saving ───────────────────────────────────────────────────────

  const snapshot = useMemo<Snapshot | null>(
    () =>
      selectedId && mode && mode !== "builtin"
        ? {
            id: selectedId,
            revision: revision.edits,
            label,
            subject,
            sample: variables,
            design,
            source,
          }
        : null,
    [selectedId, mode, revision.edits, label, subject, variables, design, source],
  );

  const persist = useCallback(
    async (snap: Snapshot) => {
      setSaveStatus("saving");
      const result = await fetchJson<{ template: TemplateMeta }>(`/api/email-templates/${snap.id}`, t, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: snap.label,
          subject: snap.subject,
          sample: snap.sample,
          ...(snap.design ? { design: snap.design } : { source: snap.source }),
        }),
      });
      if (!result.ok) {
        setSaveStatus("idle");
        setError(result.error);
        return false;
      }
      setError(null);
      setRevision((current) => ({ ...current, saved: Math.max(current.saved, snap.revision) }));
      setSaveStatus("saved");
      setTemplates((prev) =>
        prev.map((item) => (item.id === snap.id ? { ...item, ...result.data.template } : item)),
      );
      return true;
    },
    [t],
  );

  // The visual editor saves on its own. Code waits for an explicit save: a
  // half-typed template that does not compile should not replace one that does.
  useEffect(() => {
    if (mode !== "visual" || !dirty || !snapshot) return;
    const timer = setTimeout(() => void persist(snapshot), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [mode, dirty, snapshot, persist]);

  /** The visual edits not saved yet, for whoever is about to leave them. */
  const unsaved = useRef<Snapshot | null>(null);
  useEffect(() => {
    unsaved.current = mode === "visual" && dirty ? snapshot : null;
  }, [mode, dirty, snapshot]);

  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timer = setTimeout(() => setSaveStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const touch = useCallback(() => setRevision((current) => ({ ...current, edits: current.edits + 1 })), []);

  // ── Loading ──────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    const result = await fetchJson<{ templates: TemplateMeta[]; provider: EmailProvider }>(
      `/api/email-templates?locale=${locale}`,
      t,
    );
    if (!result.ok) {
      setError(result.error);
      return [];
    }
    setError(null);
    setTemplates(result.data.templates);
    setProvider(result.data.provider);
    return result.data.templates;
  }, [t, locale]);

  const openTemplate = useCallback(
    async (id: string) => {
      // Leaving a visual template mid-autosave: finish the save first.
      const pending = unsaved.current;
      if (pending && pending.id !== id) await persist(pending);

      setSelectedId(id);
      // The email that's already on screen stays there until the new one is
      // rendered. Blanking it here tore the whole phone out of the DOM and
      // rebuilt it — a flash of nothing on every template you clicked.
      setPreview((prev) => ({ ...prev, error: null, loading: true }));
      const result = await fetchJson<{ template: TemplateMeta; source: string | null }>(
        `/api/email-templates/${id}`,
        t,
      );
      if (!result.ok) {
        setError(result.error);
        setPreview(NO_PREVIEW);
        return;
      }
      const template = result.data.template;
      setError(null);
      setLabel(template.label);
      setSubject(template.subject);
      setSource(result.data.source ?? "");
      setHistory(template.design ? { past: [], present: template.design, future: [], at: 0 } : null);
      setVariables({ ...template.sample });
      setRevision((current) => ({ ...current, saved: current.edits }));
      setSaveStatus("idle");
      setTemplates((prev) => prev.map((item) => (item.id === id ? { ...item, ...template } : item)));
    },
    [t, persist],
  );

  // First paint: load the list, then open the first of the owner's own
  // templates (or the first built-in). An empty pane gives no sense of what
  // this page is.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadList().then((list) => {
      setLoading(false);
      const first = list.find((item) => item.source === "custom") ?? list[0];
      if (first) void openTemplate(first.id);
    });
  }, [loadList, openTemplate]);

  // ── Live preview ─────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedId) {
      setPreview(NO_PREVIEW);
      return;
    }
    let live = true;
    setPreview((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/email-templates/${selectedId}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: renderSource ?? undefined,
            subject: mode === "builtin" ? undefined : subject,
            variables: previewValues,
          }),
        });
        const data = await response.json();
        if (!live) return;
        setPreview({
          html: data.html ?? null,
          subject: data.subject ?? null,
          error: data.renderError ?? (response.ok ? null : (data.message ?? data.error ?? null)),
          loading: false,
        });
      } catch (cause) {
        if (!live) return;
        setPreview({
          html: null,
          subject: null,
          error: cause instanceof Error ? cause.message : String(cause),
          loading: false,
        });
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selectedId, renderSource, subject, previewValues, mode]);

  // ── Creating and deleting ────────────────────────────────────────

  const createTemplate = useCallback(
    async (draft: Draft, celebration = false) => {
      setCreating(true);
      const result = await fetchJson<{ template: TemplateMeta }>("/api/email-templates", t, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      setCreating(false);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      await loadList();
      await openTemplate(result.data.template.id);
      setNewOpen(false);
      if (celebration) celebrate();
      else cue("success");
      return true;
    },
    [t, loadList, openTemplate, cue, celebrate],
  );

  const createFromPreset = useCallback(
    (id: PresetId) => {
      const preset = emailPreset(id, locale);
      void createTemplate({
        label: preset.label,
        description: preset.description,
        subject: preset.subject,
        design: preset.design,
        sample: preset.sample,
      });
    },
    [locale, createTemplate],
  );

  /** Turns a plain-language description into a whole new visual template,
   *  then opens it the same way a preset opens. */
  const generate = useCallback(
    async (prompt: string) => {
      setGenerating(true);
      setAiError(null);
      const draft = await fetchJson<{
        label: string;
        description: string;
        subject: string;
        design: EmailDesign;
        sample: Record<string, unknown>;
      }>("/api/email-templates/generate", t, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!draft.ok) {
        setGenerating(false);
        setAiError(draft.error);
        return;
      }
      await createTemplate(draft.data, true);
      setGenerating(false);
    },
    [t, createTemplate],
  );

  /** Built-ins are read-only, so changing one means making it the owner's
   *  own: rebuilt as blocks where a visual twin exists, copied as code where
   *  it does not (the invoice's item table has no block). */
  const customize = useCallback(() => {
    if (!selected) return;
    const name = t("emailTemplates.copyOf", { label: displayLabel(selected) });
    const description = selected.descriptionKey
      ? t(selected.descriptionKey, undefined, selected.description)
      : selected.description;
    const presetId = presetForBuiltin(selected.id);
    if (presetId) {
      const preset = emailPreset(presetId, locale);
      void createTemplate({ label: name, description, subject: preset.subject, design: preset.design, sample: preset.sample });
    } else {
      void createTemplate({ label: name, description, subject: selected.subject, source, sample: variables });
    }
  }, [selected, t, displayLabel, locale, createTemplate, source, variables]);

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    const result = await fetchJson(`/api/email-templates/${target.id}`, t, { method: "DELETE" });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (unsaved.current?.id === target.id) unsaved.current = null;
    const list = await loadList();
    if (selectedId === target.id) {
      const next = list.find((item) => item.source === "custom") ?? list[0];
      if (next) {
        await openTemplate(next.id);
      } else {
        setSelectedId(null);
        setHistory(null);
      }
    }
  }, [pendingDelete, t, loadList, selectedId, openTemplate]);

  // ── Editing ──────────────────────────────────────────────────────

  const changeDesign = useCallback(
    (update: (current: EmailDesign) => EmailDesign, key?: string) => {
      setHistory((current) => {
        if (!current) return current;
        const next = update(current.present);
        if (next === current.present) return current;
        const now = Date.now();
        const coalesce = key !== undefined && key === current.key && now - current.at < COALESCE_MS;
        return {
          past: coalesce ? current.past : [...current.past.slice(-(HISTORY_LIMIT - 1)), current.present],
          present: next,
          future: [],
          key,
          at: now,
        };
      });
      touch();
    },
    [touch],
  );

  const undo = useCallback(() => {
    setHistory((current) =>
      current && current.past.length > 0
        ? {
            past: current.past.slice(0, -1),
            present: current.past[current.past.length - 1],
            future: [current.present, ...current.future],
            at: 0,
          }
        : current,
    );
    touch();
  }, [touch]);

  const redo = useCallback(() => {
    setHistory((current) =>
      current && current.future.length > 0
        ? {
            past: [...current.past, current.present],
            present: current.future[0],
            future: current.future.slice(1),
            at: 0,
          }
        : current,
    );
    touch();
  }, [touch]);

  const saveNow = useCallback(() => {
    if (snapshot && dirty) void persist(snapshot);
  }, [snapshot, dirty, persist]);

  // Cmd/Ctrl+S saves now; Cmd/Ctrl+Z undoes a block change when the focus is
  // not in a text field, which has its own undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        saveNow();
        return;
      }
      if (mode !== "visual" || key !== "z") return;
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow, mode, undo, redo]);

  const suggestedFields = useMemo(() => {
    const defaults = locale === "en" ? ["name", "business", "link", "date"] : ["nombre", "negocio", "enlace", "fecha"];
    return [...Object.keys(variables), ...defaults];
  }, [variables, locale]);

  // ── Render ───────────────────────────────────────────────────────

  const editable = mode === "visual" || mode === "code";

  return (
    <div className="content-enter flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label={t("emailTemplates.railTitle")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:hidden"
          >
            <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.75} />
          </button>
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)] md:flex">
            <HugeiconsIcon icon={Mail02Icon} size={15} strokeWidth={1.75} />
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            {editable ? (
              <label className="group/title flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  value={label}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    touch();
                  }}
                  aria-label={t("emailDesign.name")}
                  className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-lg font-medium tracking-[-0.02em] outline-none hover:bg-accent/60 focus:bg-accent/60"
                />
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  size={13}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100"
                />
              </label>
            ) : (
              <h1 className="truncate text-lg font-medium tracking-[-0.02em]">
                {selected ? displayLabel(selected) : t("emailTemplates.title")}
              </h1>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {editable ? <SaveIndicator status={saveStatus} dirty={dirty} auto={mode === "visual"} /> : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNewOpen(true)}
              disabled={creating}
              className="px-2.5 sm:px-3"
              aria-label={t("emailTemplates.newTemplate")}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("emailTemplates.newTemplate")}</span>
            </Button>

            {mode === "builtin" ? (
              <Button
                type="button"
                size="sm"
                onClick={customize}
                disabled={creating}
                className="px-2.5 sm:px-3"
              >
                {creating ? <Spinner size={14} /> : <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />}
                {t("emailDesign.customize")}
              </Button>
            ) : null}

            {mode === "code" ? (
              <Button
                type="button"
                size="sm"
                onClick={saveNow}
                disabled={!dirty || saveStatus === "saving"}
                aria-keyshortcuts="Meta+S Control+S"
              >
                {t("emailTemplates.save")}
              </Button>
            ) : null}

            <span className="mx-0.5 h-5 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDockOpenPersisted(!dockOpen)}
                  aria-label={t("emailTemplates.preview")}
                  aria-pressed={dockOpen}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors duration-150",
                    dockOpen
                      ? "bg-muted text-foreground shadow-[var(--shadow-inset)]"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.75} className="rotate-180" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("emailTemplates.preview")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {error ? (
          <ErrorBanner
            layout="strip"
            error={error}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </header>

      {/* A size container, so the dock can be "its width, or the whole
          workspace if that is narrower" — on a phone a 400px dock inside a
          375px screen clipped its own tabs and preview. */}
      <div
        className="@container relative flex min-h-0 flex-1"
        style={{ ["--dock-max" as string]: `${DOCK_MAX}px` }}
      >
        {/* Rail */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/30 md:flex xl:w-72">
          <TemplateRail
            templates={templates}
            selectedId={selectedId}
            creating={creating}
            onSelect={(id) => void openTemplate(id)}
            onCreateNew={() => setNewOpen(true)}
            onDelete={(id) => setPendingDelete(templates.find((item) => item.id === id) ?? null)}
          />
        </aside>

        {/* Editor */}
        <div className="relative min-w-0 flex-1">
          <Skeleton className="h-full" isLoading={loading} skeleton={<EditorSkeleton />}>
            {!selectedId || !mode ? (
              <EmptyState onCreate={() => setNewOpen(true)} />
            ) : mode === "visual" && history ? (
              <div key={selectedId} className="content-enter h-full">
                <EmailCanvas
                  design={history.present}
                  subject={subject}
                  suggestedFields={suggestedFields}
                  onChange={changeDesign}
                  onSubjectChange={(next) => {
                    setSubject(next);
                    touch();
                  }}
                  canUndo={history.past.length > 0}
                  canRedo={history.future.length > 0}
                  onUndo={undo}
                  onRedo={redo}
                />
              </div>
            ) : mode === "code" ? (
              <div key={selectedId} className="content-enter flex h-full flex-col">
                <p className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  {t("emailDesign.codeNotice")}
                </p>
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    value={source}
                    onChange={(next) => {
                      setSource(next);
                      touch();
                    }}
                    readOnly={false}
                  />
                </div>
              </div>
            ) : (
              <div key={selectedId} className="content-enter flex h-full flex-col">
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-2.5">
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {t("emailDesign.builtinNotice")}
                  </p>
                </div>
                <div className="min-h-0 flex-1">
                  <PreviewPane
                    html={preview.html}
                    subject={preview.subject ?? selected?.subject ?? null}
                    from={provider?.from ?? null}
                    error={preview.error}
                  />
                </div>
              </div>
            )}
          </Skeleton>

          {/* The visual editor's own bar runs along that corner; the header's
              panel button reopens the dock there. */}
          {!dockOpen && selectedId && mode !== "visual" ? (
            <DockReopenButton
              icon={Mail02Icon}
              label={t("emailTemplates.preview")}
              onClick={() => setDockOpenPersisted(true)}
            />
          ) : null}
        </div>

        {/* Resizer */}
        <div
          onPointerDown={(event) => {
            resizeRef.current = { startX: event.clientX, startWidth: dockWidth };
            setIsResizing(true);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className={cn(
            "group relative z-20 w-3 shrink-0 -translate-x-1.5 cursor-col-resize touch-none",
            dockOpen ? "hidden lg:block" : "hidden",
          )}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("emailTemplates.resizeDock")}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/[0.08]",
              "transition-[background-color] duration-200 ease-out",
              isResizing ? "bg-foreground/50" : "group-hover:bg-foreground/30",
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 left-1/2 flex h-9 w-[5px] -translate-x-1/2 -translate-y-1/2",
              "rounded-full bg-foreground/60 shadow-[var(--shadow-soft)]",
              "origin-center transition-[transform,opacity] duration-200 ease-out",
              isResizing ? "scale-100" : "scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100",
            )}
          />
        </div>

        {/* Dock */}
        <aside
          aria-hidden={!dockOpen}
          inert={!dockOpen}
          data-open={dockOpen}
          data-resizing={isResizing}
          style={{ width: dockOpen ? `min(100cqw, ${dockWidth}px)` : 0 }}
          className={cn(
            "t-dock flex min-h-0 flex-col overflow-hidden bg-card",
            "absolute inset-y-0 right-0 z-30 max-w-[min(100%,var(--dock-max))] shadow-[var(--shadow-float)]",
            "lg:static lg:z-auto lg:shrink-0 lg:shadow-none",
            dockOpen ? "border-l border-border lg:border-l-0" : "border-l-0 shadow-none",
          )}
        >
          <div
            className="t-panel-slide flex h-full min-h-0 flex-col"
            data-open={dockOpen}
            style={{ width: `min(100cqw, ${dockWidth}px)` }}
          >
            <div className="shrink-0 p-3 pb-2">
              {mode === "builtin" ? (
                <p className="px-1 pt-1 text-sm font-medium">{t("emailTemplates.sendTest")}</p>
              ) : (
                <SlidingTabs
                  value={dockTab}
                  onValueChange={(next) => setDockTab(next as DockTab)}
                  tabs={[
                    { id: "preview", label: t("emailTemplates.preview") },
                    { id: "test", label: t("emailTemplates.sendTest") },
                  ]}
                />
              )}
            </div>

            {/* Both stay mounted: keying on the active tab would throw away a
                half-typed test address every time you checked the preview. */}
            <div className="min-h-0 flex-1">
              <div className={cn("h-full", mode !== "builtin" && dockTab === "preview" ? "block" : "hidden")}>
                <PreviewPane
                  html={preview.html}
                  subject={preview.subject ?? subject ?? null}
                  from={provider?.from ?? null}
                  error={preview.error}
                  empty={!selectedId}
                />
              </div>
              <div
                className={cn(
                  "y-fade h-full overflow-y-auto scrollbar-hide",
                  mode === "builtin" || dockTab === "test" ? "block" : "hidden",
                )}
              >
                {selected ? (
                  <>
                    <TestSend
                      templateId={selected.id}
                      source={renderSource}
                      variables={previewValues}
                      subject={preview.subject ?? subject}
                      provider={provider}
                    />
                    <div className="border-t border-border">
                      <p className="px-3 pt-3 text-sm font-medium">{t("emailDesign.sampleTitle")}</p>
                      <VariableInspector
                        key={selected.id}
                        variables={fieldNames}
                        values={variables}
                        labelFor={mode === "code" ? undefined : labelFor}
                        onChange={(key, value) => {
                          setVariables((prev) => ({ ...prev, [key]: value }));
                          if (editable) touch();
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <Drawer open={railOpen} onOpenChange={setRailOpen} panelClassName="max-w-sm">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle icon={<HugeiconsIcon icon={Mail02Icon} size={18} strokeWidth={1.75} />}>
              {t("emailTemplates.title")}
            </DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1">
            <TemplateRail
              templates={templates}
              selectedId={selectedId}
              creating={creating}
              onSelect={(id) => {
                setRailOpen(false);
                void openTemplate(id);
              }}
              onCreateNew={() => {
                setRailOpen(false);
                setNewOpen(true);
              }}
              onDelete={(id) => setPendingDelete(templates.find((item) => item.id === id) ?? null)}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <NewTemplateDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        busy={creating}
        generating={generating}
        aiError={aiError}
        onDismissAiError={() => setAiError(null)}
        onPickPreset={createFromPreset}
        onGenerate={(prompt) => void generate(prompt)}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle icon={<HugeiconsIcon icon={Delete02Icon} size={18} strokeWidth={1.75} />}>
              {t("emailDesign.deleteTitle", { label: pendingDelete?.label ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("emailDesign.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>{t("emailTemplates.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreate }: { readonly onCreate: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
        <HugeiconsIcon icon={Mail02Icon} size={18} strokeWidth={1.5} />
      </div>
      <p className="text-sm font-medium">{t("emailTemplates.noTemplate")}</p>
      <p className="max-w-[38ch] text-[12px] leading-relaxed text-muted-foreground">
        {t("emailTemplates.noTemplateHint")}
      </p>
      <Button
        type="button"
        size="sm"
        onClick={onCreate}
        className="mt-1"
      >
        <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
        {t("emailTemplates.newTemplate")}
      </Button>
    </div>
  );
}

/** A dot and a word: quiet at rest, and the only thing on the toolbar that
 *  says whether the last edit is safe. A visual template saves itself, so it
 *  never says "unsaved" — only "saving" and "saved". */
function SaveIndicator({
  status,
  dirty,
  auto,
}: {
  readonly status: SaveStatus;
  readonly dirty: boolean;
  readonly auto: boolean;
}) {
  const t = useT();
  if (status === "idle" && !dirty) return null;
  const saving = status === "saving" || (auto && dirty);
  return (
    <span className="list-fade-in mr-1 hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase sm:flex">
      {saving ? (
        <Spinner size={11} strokeWidth={2} />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "saved" ? "bg-foreground/60" : "animate-pulse bg-amber-500",
          )}
        />
      )}
      {saving
        ? t("emailTemplates.saving")
        : status === "saved"
          ? t("emailTemplates.saved")
          : t("emailTemplates.unsaved")}
    </span>
  );
}
