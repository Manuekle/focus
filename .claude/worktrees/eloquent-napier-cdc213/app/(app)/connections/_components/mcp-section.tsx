"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Delete01Icon,
  McpServerIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { Card } from "../../../_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage } from "@/lib/api-error-message";
import type { PublicMcpServer } from "@/lib/mcp-store";
import type { McpAuthKind } from "@/lib/types";
import { cn } from "@/lib/utils";

// Remote MCP servers, added at runtime.
//
// Two things this section owes the person using it, and both come from the
// fact that an MCP server is somebody else's software:
//
//   **A Test button, before Save.** The three ways this goes wrong — wrong
//   URL, wrong token, server that speaks neither transport — all look
//   identical from a saved row that quietly returns nothing. Probing an
//   unsaved form turns "why is my agent ignoring Notion" into a red line
//   under the URL field.
//
//   **A tool list.** The probe returns the server's actual tools, which is
//   the only way to fill the allow-list honestly instead of guessing names.
//
// The token never comes back from the API. Editing a server shows an empty
// secret field with "guardado" under it; leaving it empty keeps what is
// stored, which is why an absent field and an empty one mean different things
// in lib/mcp-store.ts.

type Draft = {
  name: string;
  url: string;
  description: string;
  authKind: McpAuthKind;
  secret: string;
  headerName: string;
  allow: string;
  block: string;
  enabled: boolean;
};

function draftFrom(server: PublicMcpServer | null): Draft {
  return {
    name: server?.name ?? "",
    url: server?.url ?? "",
    description: server?.description ?? "",
    authKind: server?.authKind ?? "none",
    secret: "",
    headerName: server?.headerName ?? "",
    allow: (server?.allow ?? []).join(", "),
    block: (server?.block ?? []).join(", "),
    enabled: server?.enabled ?? true,
  };
}

type Probe =
  | { readonly state: "idle" }
  | { readonly state: "testing" }
  | { readonly state: "ok"; readonly tools: readonly string[]; readonly serverName?: string }
  | { readonly state: "failed"; readonly error: string };

function ServerDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly editing: PublicMcpServer | null;
  readonly onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(editing));
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [saving, setSaving] = useState(false);

  const patch = (updates: Partial<Draft>) => setDraft((current) => ({ ...current, ...updates }));

  const test = useCallback(async () => {
    setProbe({ state: "testing" });
    // With an id and no retyped secret the stored record is probed — the only
    // way to re-test a saved server, since the browser never holds its token.
    const body =
      editing && !draft.secret
        ? { id: editing.id }
        : {
            url: draft.url,
            authKind: draft.authKind,
            secret: draft.secret,
            headerName: draft.headerName,
            allow: draft.allow.split(/[\s,]+/).filter(Boolean),
            block: draft.block.split(/[\s,]+/).filter(Boolean),
          };
    const result = await fetchJson<{
      ok?: boolean;
      serverName?: string;
      tools?: { name: string }[];
      error?: string;
      errorKey?: string;
      errorParams?: Record<string, string | number>;
    }>("/api/mcp/test", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setProbe({ state: "failed", error: uiErrorMessage(t, result.error) });
      return;
    }
    if (!result.data.ok) {
      // A key when the failure is one this app words; otherwise the remote
      // server's own sentence, which no dictionary can carry.
      setProbe({
        state: "failed",
        error: result.data.errorKey
          ? t(result.data.errorKey, result.data.errorParams, result.data.error)
          : (result.data.error ?? t("mcp.testFailed")),
      });
      return;
    }
    setProbe({
      state: "ok",
      tools: (result.data.tools ?? []).map((tool) => tool.name),
      serverName: result.data.serverName,
    });
  }, [draft, editing, t]);

  const save = useCallback(async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: draft.name,
      url: draft.url,
      description: draft.description,
      authKind: draft.authKind,
      headerName: draft.headerName,
      allow: draft.allow,
      block: draft.block,
      enabled: draft.enabled,
    };
    // Only send the secret when one was typed. An empty string would clear a
    // working token; an absent field keeps it.
    if (draft.secret.trim()) payload.secret = draft.secret.trim();
    if (editing) payload.id = editing.id;

    const result = await fetchJson("/api/mcp", t, {
      method: editing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!result.ok) {
      toast({ title: uiErrorMessage(t, result.error), status: "error" });
      return;
    }
    onSaved();
    onOpenChange(false);
    toast({ title: editing ? t("mcp.updated") : t("mcp.connected"), status: "success" });
  }, [draft, editing, onOpenChange, onSaved, t, toast]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle icon={<HugeiconsIcon icon={McpServerIcon} size={18} strokeWidth={1.75} />}>
            {editing ? t("mcp.dialogEditTitle") : t("mcp.dialogNewTitle")}
          </DrawerTitle>
          <DrawerDescription>
            {t("mcp.dialogDescription")} <span className="font-mono">mcp_&lt;name&gt;</span>.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="mcp-name" className="text-xs font-medium text-foreground">
                  {t("mcp.fieldName")}
                </label>
                <Input
                  id="mcp-name"
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="Linear"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">{t("mcp.fieldAuth")}</span>
                <Select
                  value={draft.authKind}
                  onValueChange={(value) => patch({ authKind: value as McpAuthKind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("mcp.authNone")}</SelectItem>
                    <SelectItem value="bearer">{t("mcp.authBearer")}</SelectItem>
                    <SelectItem value="header">{t("mcp.authHeader")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mcp-url" className="text-xs font-medium text-foreground">
                {t("mcp.fieldUrl")}
              </label>
              <Input
                id="mcp-url"
                value={draft.url}
                onChange={(event) => {
                  patch({ url: event.target.value });
                  setProbe({ state: "idle" });
                }}
                placeholder="https://mcp.linear.app/mcp"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("mcp.fieldUrlHint")}
              </p>
            </div>

            {draft.authKind !== "none" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {draft.authKind === "header" ? (
                  <div className="space-y-1.5">
                    <label htmlFor="mcp-header" className="text-xs font-medium text-foreground">
                      {t("mcp.fieldHeaderName")}
                    </label>
                    <Input
                      id="mcp-header"
                      value={draft.headerName}
                      onChange={(event) => patch({ headerName: event.target.value })}
                      placeholder="X-Api-Key"
                      className="font-mono text-xs"
                    />
                  </div>
                ) : null}
                <div className={cn("space-y-1.5", draft.authKind !== "header" && "sm:col-span-2")}>
                  <label htmlFor="mcp-secret" className="text-xs font-medium text-foreground">
                    {t("mcp.fieldToken")}
                  </label>
                  <Input
                    id="mcp-secret"
                    type="password"
                    value={draft.secret}
                    onChange={(event) => patch({ secret: event.target.value })}
                    placeholder={editing?.hasSecret ? t("mcp.tokenStored") : ""}
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  {editing?.hasSecret ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("mcp.tokenKeep")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="mcp-description" className="text-xs font-medium text-foreground">
                {t("mcp.fieldDescription")}
              </label>
              <Textarea
                id="mcp-description"
                value={draft.description}
                onChange={(event) => patch({ description: event.target.value })}
                rows={2}
                placeholder={t("mcp.fieldDescriptionPlaceholder")}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("mcp.fieldDescriptionHint")}
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{t("mcp.test")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void test()}
                  disabled={probe.state === "testing" || (!draft.url.trim() && !editing)}
                >
                  {probe.state === "testing" ? t("mcp.testing") : t("mcp.testButton")}
                </Button>
              </div>
              {probe.state === "failed" ? (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[color:var(--status-failed-fg)]">
                  <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={2} className="mt-0.5" />
                  {probe.error}
                </p>
              ) : null}
              {probe.state === "ok" ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--status-success-fg)]">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
                    {t("mcp.testOk", {
                      server: probe.serverName ?? "MCP",
                      count: probe.tools.length,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {probe.tools.slice(0, 24).map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() =>
                          patch({
                            allow: draft.allow
                              .split(/[\s,]+/)
                              .filter(Boolean)
                              .includes(tool)
                              ? draft.allow
                              : [...draft.allow.split(/[\s,]+/).filter(Boolean), tool].join(", "),
                          })
                        }
                        className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-input hover:text-foreground"
                        title={t("mcp.addToAllow")}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="mcp-allow" className="text-xs font-medium text-foreground">
                  {t("mcp.fieldAllow")}
                </label>
                <Input
                  id="mcp-allow"
                  value={draft.allow}
                  onChange={(event) => patch({ allow: event.target.value })}
                  placeholder={t("mcp.fieldAllowPlaceholder")}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="mcp-block" className="text-xs font-medium text-foreground">
                  {t("mcp.fieldBlock")}
                </label>
                <Input
                  id="mcp-block"
                  value={draft.block}
                  onChange={(event) => patch({ block: event.target.value })}
                  placeholder="delete_issue"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !draft.name.trim() || !draft.url.trim()}
          >
            {saving ? t("settings.saving") : t("common.save")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function McpSection() {
  const t = useT();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PublicMcpServer | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<{ servers?: PublicMcpServer[] }>("/api/mcp", t);
    if (result.ok) setServers(result.data.servers ?? []);
  }, [t]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const toggle = useCallback(
    async (server: PublicMcpServer, enabled: boolean) => {
      setServers((current) =>
        current.map((entry) => (entry.id === server.id ? { ...entry, enabled } : entry)),
      );
      const result = await fetchJson("/api/mcp", t, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: server.id, enabled }),
      });
      if (!result.ok) {
        setServers((current) =>
          current.map((entry) =>
            entry.id === server.id ? { ...entry, enabled: server.enabled } : entry,
          ),
        );
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
      }
    },
    [t, toast],
  );

  const remove = useCallback(
    async (server: PublicMcpServer) => {
      const ok = await confirm({
        title: t("mcp.deleteConfirm", { name: server.name }),
        description: t("mcp.deleteConfirmBody"),
        confirmLabel: t("mcp.disconnect"),
      });
      if (!ok) return;
      const result = await fetchJson(`/api/mcp?id=${encodeURIComponent(server.id)}`, t, {
        method: "DELETE",
      });
      if (result.ok) {
        await load();
        toast({ title: t("mcp.disconnected") });
      } else {
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
      }
    },
    [confirm, load, t, toast],
  );

  const activeCount = useMemo(() => servers.filter((server) => server.enabled).length, [servers]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={McpServerIcon} size={16} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("mcp.title")}</h2>
            <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
              {t("mcp.subtitle")} {activeCount > 0 ? t("mcp.activeCount", { count: activeCount }) : null}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={1.75} />
          {t("mcp.connect")}
        </Button>
      </div>

      {loading ? (
        <Card className="space-y-2 p-5">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3 w-56" />
        </Card>
      ) : servers.length === 0 ? (
        <Card>
          <div className="flex flex-col items-start gap-3 px-5 py-8 text-center sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={McpServerIcon} size={18} strokeWidth={1.75} />
            </div>
            <div className="sm:text-center">
              <p className="text-sm font-medium">{t("mcp.empty")}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {t("mcp.emptyHint")}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          {servers.map((server, index) => (
            <div
              key={server.id}
              className={cn(
                "flex flex-wrap items-center gap-3 px-5 py-4",
                index > 0 && "border-t border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">{server.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    mcp_{server.slug}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {server.url}
                </p>
                {server.lastCheck ? (
                  <p
                    className={cn(
                      "mt-1 flex items-center gap-1.5 text-[11px]",
                      server.lastCheck.ok
                        ? "text-[color:var(--status-success-fg)]"
                        : "text-[color:var(--status-failed-fg)]",
                    )}
                  >
                    <HugeiconsIcon
                      icon={server.lastCheck.ok ? CheckmarkCircle02Icon : AlertCircleIcon}
                      size={12}
                      strokeWidth={2}
                    />
                    {server.lastCheck.ok
                      ? t("mcp.lastCheckOk", { count: server.lastCheck.tools?.length ?? 0 })
                      : server.lastCheck.error}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(checked) => void toggle(server, checked)}
                  label={server.enabled ? t("skills.disable") : t("skills.enable")}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("mcp.dialogEditTitle")}
                  onClick={() => {
                    setEditing(server);
                    setDialogOpen(true);
                  }}
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} size={15} strokeWidth={1.75} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("mcp.disconnect")}
                  onClick={() => void remove(server)}
                >
                  <HugeiconsIcon icon={Delete01Icon} size={15} strokeWidth={1.75} />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Keyed so the dialog never opens holding the previous server's form. */}
      <ServerDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => void load()}
      />
      {confirmDialog}
    </>
  );
}
