"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  parseEnv,
  SETTING_GROUPS,
  settingApply,
  settingKeyProblem,
  type SettingApply,
  type SettingsSnapshot,
  type SettingsUpdate,
  type SettingsUpdateResult,
  type SettingView,
} from "../../shared/settings";

const TOKEN_KEY = "focus-admin-token";

const APPLY_LABEL: Record<SettingApply, string> = {
  now: "Applies now",
  restart: "Needs restart",
  build: "Needs rebuild",
};

const SOURCE: Record<SettingView["source"], { label: string; tone: "success" | "info" | "neutral" }> = {
  settings: { label: "Saved here", tone: "success" },
  environment: { label: "From environment", tone: "info" },
  unset: { label: "Not set", tone: "neutral" },
};

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lasts until the page closes.
  }
}

class SettingsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function call<T>(token: string, init?: { method: "PUT"; body: SettingsUpdate }): Promise<T> {
  const response = await fetch("/api/settings", {
    method: init?.method ?? "GET",
    headers: { ...(token ? { "X-Focus-Admin": token } : {}), ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new SettingsError(error?.code ?? "failed", error?.message ?? "Settings couldn’t be loaded.");
  }
  return body as T;
}

/** What one save means for the running server, in words. */
function afterSave(result: SettingsUpdateResult): string {
  const changed = [...result.saved, ...result.removed];
  if (!changed.length) return result.rejected.length ? "Nothing was saved." : "No changes.";
  const needs = (apply: SettingApply) => changed.filter((key) => settingApply(key) === apply);
  const counts = [result.saved.length ? `saved ${result.saved.length}` : "", result.removed.length ? `removed ${result.removed.length}` : ""].filter(Boolean).join(", ");
  const parts = [`${counts[0].toUpperCase()}${counts.slice(1)}.`];
  const restart = needs("restart");
  const build = needs("build");
  if (restart.length) parts.push(`Restart the server for ${restart.join(", ")}.`);
  if (build.length) parts.push(`Rebuild (or restart pnpm dev) for ${build.join(", ")}.`);
  if (!restart.length && !build.length) parts.push("Already live.");
  return parts.join(" ");
}

export function SettingsStudio() {
  const [token, setToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [blocked, setBlocked] = useState<SettingsError | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (withToken: string) => {
    try {
      setSnapshot(await call<SettingsSnapshot>(withToken));
      setBlocked(null);
    } catch (error) {
      setSnapshot(null);
      setBlocked(error instanceof SettingsError ? error : new SettingsError("failed", "Settings couldn’t be loaded."));
    }
  }, []);

  useEffect(() => {
    const saved = readToken();
    setToken(saved);
    void load(saved);
  }, [load]);

  const production = snapshot?.mode === "production";

  const save = async (body: SettingsUpdate) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await call<SettingsUpdateResult>(token, { method: "PUT", body });
      setSnapshot(result);
      const rejected = result.rejected.map((entry) => `${entry.key}: ${entry.reason}`).join(" ");
      setNotice({ tone: result.rejected.length && !result.saved.length ? "danger" : "success", text: `${afterSave(result)}${rejected ? ` Skipped: ${rejected}` : ""}` });
      return true;
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Couldn’t save." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo(() => {
    if (!pasted.trim()) return null;
    const { values, invalidLines } = parseEnv(pasted);
    const entries = Object.entries(values);
    return {
      ready: entries.filter(([key, value]) => value.trim() && !settingKeyProblem(key, production)),
      empty: entries.filter(([, value]) => !value.trim()).map(([key]) => key),
      refused: entries.filter(([key]) => settingKeyProblem(key, production)).map(([key]) => ({ key, reason: settingKeyProblem(key, production)! })),
      invalidLines,
    };
  }, [pasted, production]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setNotice({ tone: "danger", text: "That file is larger than 256 KB." });
      return;
    }
    setPasted(await file.text());
  };

  const groups = useMemo(() => {
    const order = [...SETTING_GROUPS, "Custom"];
    const byGroup = new Map<string, SettingView[]>();
    for (const setting of snapshot?.settings ?? []) byGroup.set(setting.group, [...(byGroup.get(setting.group) ?? []), setting]);
    return [...byGroup.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [snapshot]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-6 md:px-6">
        <Link href="/" className="text-lg font-semibold">Focus</Link>
        {snapshot ? <Badge tone={production ? "warning" : "info"}>{production ? "Production server" : "Local install"}</Badge> : null}
      </header>

      <main className="mx-auto grid w-full max-w-4xl gap-10 px-4 pt-4 pb-24 md:px-6">
        <section className="grid gap-2">
          <h1 className="text-3xl leading-tight font-semibold">Settings</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Load every environment variable this server needs, locally or in production. Values are saved on the server’s own disk
            {snapshot ? <> in <code className="font-mono text-xs">{snapshot.file}</code></> : null}, never in a database, and secrets are never sent back to the browser.
          </p>
        </section>

        {blocked && blocked.code !== "admin_token_required" ? (
          <p role="alert" className="text-sm text-destructive">{blocked.message}</p>
        ) : null}

        {blocked?.code === "admin_token_required" || (production && snapshot) ? (
          <form
            className="grid max-w-xl gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              writeToken(tokenDraft);
              setToken(tokenDraft);
              void load(tokenDraft);
            }}
          >
            <label htmlFor="admin-token" className="text-sm font-medium">Admin token</label>
            <p className="text-sm text-muted-foreground">The value of FOCUS_ADMIN_TOKEN on this server. Kept only in this tab.</p>
            <div className="flex gap-2">
              <Input id="admin-token" type="password" autoComplete="off" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder={token ? "Saved for this tab" : "Paste the token"} />
              <Button type="submit" variant="secondary">Unlock</Button>
            </div>
            {blocked ? <p role="alert" className="text-sm text-destructive">{blocked.message}</p> : null}
          </form>
        ) : null}

        {snapshot ? (
          <>
            <section className="grid gap-3" aria-labelledby="import-heading">
              <h2 id="import-heading" className="text-lg font-semibold">Import a .env file</h2>
              <p className="text-sm text-muted-foreground">
                Choose a file or paste its contents. Empty values (<code className="font-mono text-xs">KEY=</code>) are skipped, so a template never blanks a variable your platform already sets.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>Choose file</Button>
                <input ref={fileRef} type="file" accept=".env,.txt,text/plain" className="sr-only" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
                {pasted ? <Button type="button" variant="ghost" onClick={() => setPasted("")}>Clear</Button> : null}
              </div>
              <Textarea
                aria-label=".env contents"
                spellCheck={false}
                className="min-h-40 font-mono text-xs"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder={"MODEL_API_KEY=...\nFOCUS_SESSION_SECRET=...\nNEXT_PUBLIC_ENABLE_FLIPBOOK=true"}
              />
              {preview ? (
                <div className="grid gap-2 text-sm">
                  <p>
                    <strong>{preview.ready.length}</strong> to save
                    {preview.empty.length ? <>, {preview.empty.length} empty skipped</> : null}
                    {preview.refused.length ? <>, {preview.refused.length} not allowed</> : null}
                    {preview.invalidLines.length ? <>, unreadable lines {preview.invalidLines.join(", ")}</> : null}.
                  </p>
                  {preview.ready.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {preview.ready.map(([key]) => <li key={key}><Badge size="sm" tone="neutral" className="font-mono">{key}</Badge></li>)}
                    </ul>
                  ) : null}
                  {preview.refused.map((entry) => <p key={entry.key} className="text-muted-foreground"><code className="font-mono text-xs">{entry.key}</code>: {entry.reason}</p>)}
                  <div>
                    <Button
                      type="button"
                      disabled={busy || !preview.ready.length}
                      onClick={async () => { if (await save({ set: Object.fromEntries(preview.ready) })) setPasted(""); }}
                    >
                      Save {preview.ready.length} {preview.ready.length === 1 ? "variable" : "variables"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>

            {notice ? (
              <p role="status" className={notice.tone === "danger" ? "text-sm text-destructive" : "text-sm"}>{notice.text}</p>
            ) : null}

            {production ? (
              <p className="text-sm text-muted-foreground">
                On a production image, variables marked “Needs rebuild” are compiled when the image is built: also set them as build variables on your hosting platform.
              </p>
            ) : null}

            {groups.map(([group, settings]) => (
              <section key={group} className="grid gap-1" aria-labelledby={`group-${group}`}>
                <h2 id={`group-${group}`} className="mb-2 text-lg font-semibold">{group}</h2>
                {settings.map((setting) => {
                  const draft = drafts[setting.key] ?? (setting.secret ? "" : setting.value ?? "");
                  const dirty = setting.secret ? draft !== "" : draft !== (setting.value ?? "");
                  return (
                    <div key={setting.key} className="grid gap-2 border-t border-border py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-6">
                      <div className="grid min-w-0 content-start gap-1">
                        <code className="font-mono text-[13px] font-medium break-all">{setting.key}</code>
                        {setting.description ? <p className="text-sm text-muted-foreground">{setting.description}</p> : null}
                        <div className="flex flex-wrap gap-1.5">
                          <Badge size="sm" tone={SOURCE[setting.source].tone}>{SOURCE[setting.source].label}</Badge>
                          <Badge size="sm" tone={setting.apply === "now" ? "neutral" : "warning"}>{APPLY_LABEL[setting.apply]}</Badge>
                        </div>
                      </div>
                      {setting.locked ? (
                        <p className="self-center text-sm text-muted-foreground">{setting.locked}</p>
                      ) : (
                        <form
                          className="flex min-w-0 items-start gap-2"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            if (!dirty) return;
                            if (await save({ set: { [setting.key]: draft } })) {
                              setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== setting.key)));
                            }
                          }}
                        >
                          <Input
                            aria-label={setting.key}
                            type={setting.secret ? "password" : "text"}
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono text-xs"
                            value={draft}
                            placeholder={setting.secret ? (setting.value ?? "Not set") : "Not set"}
                            onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))}
                          />
                          <Button type="submit" size="sm" variant="secondary" disabled={busy || !dirty} className="h-9">Save</Button>
                          {setting.source === "settings" ? (
                            <Button type="button" size="sm" variant="ghost" disabled={busy} className="h-9" onClick={() => void save({ unset: [setting.key] })}>
                              Remove
                            </Button>
                          ) : null}
                        </form>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        ) : null}
      </main>
    </div>
  );
}
