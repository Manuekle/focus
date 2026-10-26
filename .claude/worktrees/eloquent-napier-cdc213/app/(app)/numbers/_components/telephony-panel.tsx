"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Add01Icon, ShoppingCart01Icon, SmartPhone01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { countryOptions } from "@/lib/countries";
import { useI18n, useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import type { Agent, PhoneNumber } from "@/lib/types";
import type { NumberKind, NumberQuote, TelephonyNumber } from "@/lib/twilio-telephony";

export type TelephonyMode = "buy" | "verify" | null;
export function NewNumberMenu({ onMode, onManual }: { onMode: (mode: TelephonyMode) => void; onManual: () => void }) {
  const t = useT();
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm"><HugeiconsIcon icon={Add01Icon} size={16} />{t("numbers.add")}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onMode("buy")}><HugeiconsIcon icon={ShoppingCart01Icon} size={16} />{t("numbers.tel.buy")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMode("verify")}><HugeiconsIcon icon={SmartPhone01Icon} size={16} />{t("numbers.tel.verify")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onManual}>{t("numbers.tel.existing")}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
}
type Inventory = { purchased: TelephonyNumber[]; verified: TelephonyNumber[] };
type Regulatory = { sid: string; label: string; status?: string; type?: string };
const CONSOLE = "https://console.twilio.com/us1/develop/phone-numbers/manage/regulatory/bundles";
export function TelephonyPanel({ mode, onMode, agents, numbers, onChanged }: {
  mode: TelephonyMode; onMode: (mode: TelephonyMode) => void; agents: readonly Agent[]; numbers: readonly PhoneNumber[]; onChanged: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const requestId = useRef(0);
  const [tab, setTab] = useState("purchased");
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [rows, setRows] = useState<Regulatory[]>([]);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Record<string, string>>({});
  const [country, setCountry] = useState("US");
  const [kind, setKind] = useState<NumberKind>("Local");
  const [contains, setContains] = useState("");
  const [quotes, setQuotes] = useState<NumberQuote[] | null>(null);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<{ phone: string; code: string } | null>(null);
  const [actionError, setActionError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    const section = tab === "compliance" || tab === "endUsers" ? `?section=${tab}` : "";
    const result = await fetchJson<Inventory & { rows?: Regulatory[] }>(`/api/numbers/telephony${section}`, t);
    if (currentRequest !== requestId.current) return;
    if (result.ok) { if (section) setRows(result.data.rows ?? []); else setInventory(result.data); setError(null); }
    else setError(result.error);
    setLoading(false);
  }, [t, tab]);
  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => { if (!canceled) void refresh(); });
    return () => { canceled = true; };
  }, [refresh]);
  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => { if (!canceled) { setActionError(null); setNotice(null); } });
    return () => { canceled = true; };
  }, [mode]);
  const post = async <T,>(body: object) => {
    const result = await fetchJson<T>("/api/numbers/telephony", t, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!result.ok) setActionError(result.error);
    return result;
  };
  const buy = async (quote: NumberQuote) => {
    const ok = await confirm({ title: t("numbers.tel.buyConfirm", { phone: quote.phone }), description: t("numbers.tel.buyCost", { price: quote.monthly, currency: quote.currency }), confirmLabel: t("numbers.tel.buy") });
    if (!ok) return;
    setBusy(true); setActionError(null);
    const result = await post({ action: "purchase", quoteId: quote.id, confirmed: true });
    if (result.ok) { setQuotes(null); setNotice("numbers.tel.purchasedNotice"); onChanged(); await refresh(); }
    setBusy(false);
  };
  const connect = async (line: TelephonyNumber) => {
    const agentId = selectedAgents[line.sid]; if (!agentId) return;
    const ok = await confirm({ title: t("numbers.tel.connectConfirm", { phone: line.phone }), description: t("numbers.tel.connectBody", { agent: agents.find((a) => a.id === agentId)?.name ?? "" }), confirmLabel: t("numbers.tel.connect") });
    if (!ok) return;
    setBusy(true); setActionError(null);
    const result = await post({ action: "connect", phone: line.phone, agentId });
    if (result.ok) { onChanged(); setNotice("numbers.tel.connected"); await refresh(); }
    setBusy(false);
  };
  const list = inventory?.[tab === "verified" ? "verified" : "purchased"] ?? [];
  const verified = pending && inventory?.verified.some((n) => n.phone === pending.phone);
  const voiceAgents = agents.filter((a) => a.status === "active" && a.voice?.enabled && a.voice.elevenlabsAgentId);
  return <>
    <section className="mb-6 rounded-xl border border-border bg-card p-5" aria-label={t("numbers.tel.title")}>
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-medium">{t("numbers.tel.title")}</h2><Button variant="ghost" size="icon-sm" disabled={loading} aria-label={t("numbers.tel.refresh")} onClick={() => void refresh()}><HugeiconsIcon icon={RefreshIcon} size={16} /></Button></div>
      <div className="x-fade mb-4 overflow-x-auto"><SlidingTabs value={tab} onValueChange={(value) => { setRows([]); setTab(value); }} tabs={["purchased", "verified", "compliance", "endUsers"].map((id) => ({ id, label: t(`numbers.tel.${id}`) }))} /></div>
      {error ? <div className="space-y-2 text-sm" role="status"><p className="text-muted-foreground">{uiErrorMessage(t, error)}</p><Link className="underline underline-offset-4" href="/settings">{t("numbers.tel.settings")}</Link></div>
        : loading ? <p className="text-sm text-muted-foreground" role="status">{t("common.loading")}</p>
        : tab === "compliance" || tab === "endUsers" ? <div className="space-y-3"><p className="text-xs leading-relaxed text-muted-foreground">{t("numbers.tel.complianceHint")}</p>{rows.length ? rows.map((row) => <div key={row.sid} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm"><span>{row.label}</span><span className="text-muted-foreground">{row.status || row.type}</span></div>) : <p className="text-sm text-muted-foreground">{t("numbers.tel.empty")}</p>}<a href={CONSOLE} target="_blank" rel="noreferrer" className="inline-block text-xs underline underline-offset-4">{t("numbers.tel.openConsole")}</a></div>
        : <div className="space-y-3"><p className="text-xs leading-relaxed text-muted-foreground">{t(tab === "verified" ? "numbers.tel.verifiedHint" : "numbers.tel.purchasedHint")}</p>
          {list.length ? list.map((line) => {
            const holder = numbers.find((n) => n.e164 === line.phone)?.agentId;
            return <div key={line.sid} className="flex flex-col gap-3 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-sm">{line.phone}</p><p className="mt-1 text-xs text-muted-foreground">{tab === "verified" ? t("numbers.tel.callerOnly") : holder ? t("numbers.tel.directoryAgent", { agent: agents.find((a) => a.id === holder)?.name ?? "" }) : t("numbers.tel.needsAgent")}</p></div>
              {tab === "purchased" && line.voice ? <div className="flex items-center gap-2"><Select value={selectedAgents[line.sid] ?? ""} onValueChange={(value) => setSelectedAgents((s) => ({ ...s, [line.sid]: value }))}><SelectTrigger className="w-40" size="sm" aria-label={t("numbers.tel.chooseAgent")}><SelectValue placeholder={t("numbers.tel.chooseAgent")} /></SelectTrigger><SelectContent>{voiceAgents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={busy || !selectedAgents[line.sid]} onClick={() => void connect(line)}>{t("numbers.tel.connect")}</Button></div> : null}</div>;
          }) : <p className="text-sm text-muted-foreground">{t("numbers.tel.empty")}</p>}
          {tab === "purchased" && !voiceAgents.length ? <Link className="inline-block text-xs underline underline-offset-4" href="/agents">{t("numbers.tel.enableVoice")}</Link> : null}
        </div>}
      {actionError && !mode ? <p role="alert" className="mt-3 text-sm text-destructive">{uiErrorMessage(t, actionError)}</p> : null}
      {notice && !mode ? <p role="status" className="mt-3 text-sm">{t(notice)}</p> : null}
    </section>
    <Drawer open={mode !== null} onOpenChange={(open) => { if (!open && !busy) onMode(null); }}><DrawerContent>
      <DrawerHeader><DrawerTitle>{t(mode === "verify" ? "numbers.tel.verify" : "numbers.tel.buy")}</DrawerTitle><DrawerDescription>{t(mode === "verify" ? "numbers.tel.verifyHint" : "numbers.tel.buyHint")}</DrawerDescription></DrawerHeader>
      <DrawerBody>
        {mode === "buy" ? <div className="space-y-4"><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setActionError(null); setQuotes(null); const r = await post<{ quotes: NumberQuote[] }>({ action: "search", country, kind, contains }); if (r.ok) setQuotes(r.data.quotes); setBusy(false); }}>
          <label className="block text-xs font-medium">{t("numbers.tel.country")}<Select value={country} onValueChange={setCountry}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{countries.map((c) => <SelectItem key={c.iso2} value={c.iso2.toUpperCase()}>{c.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="block text-xs font-medium">{t("numbers.tel.kind")}<Select value={kind} onValueChange={(value) => setKind(value as NumberKind)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["Local", "Mobile", "TollFree"].map((id) => <SelectItem key={id} value={id}>{t(`numbers.tel.kind${id}`)}</SelectItem>)}</SelectContent></Select></label>
          <label className="block text-xs font-medium">{t("numbers.tel.contains")}<Input className="mt-1" value={contains} maxLength={10} pattern="[0-9*]*" onChange={(event) => setContains(event.target.value)} /></label>
          <Button type="submit" disabled={busy}>{t("numbers.tel.search")}</Button>
        </form>
        {quotes?.length === 0 ? <p className="text-sm text-muted-foreground">{t("numbers.tel.noAvailable")}</p> : null}
        {quotes?.map((quote) => <div key={quote.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="font-mono text-sm">{quote.phone}</p><p className="mt-1 text-xs text-muted-foreground">{t("numbers.tel.monthly", { price: quote.monthly, currency: quote.currency })}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void buy(quote)}>{t("numbers.tel.buy")}</Button></div>)}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("numbers.tel.billing")}</p><a className="text-xs underline underline-offset-4" href={CONSOLE} target="_blank" rel="noreferrer">{t("numbers.tel.regulatedNumbers")}</a>
        </div> : <div className="space-y-4"><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setActionError(null); const r = await post<{ phone: string; code: string }>({ action: "verify", phone }); if (r.ok) { setPending(r.data); setTab("verified"); } setBusy(false); }}>
          <label className="block text-xs font-medium">{t("numbers.tel.phone")}<Input className="mt-1" type="tel" autoComplete="tel" placeholder="+57…" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label><Button type="submit" disabled={busy}>{t("numbers.tel.callVerify")}</Button>
        </form>{pending ? <div className="rounded-lg border border-border p-4" aria-live="polite"><p className="text-sm">{t(verified ? "numbers.tel.verifiedNotice" : "numbers.tel.pending", { phone: pending.phone })}</p>{!verified ? <><p className="my-3 font-mono text-2xl tracking-widest">{pending.code}</p><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>{t("numbers.tel.checkVerification")}</Button></> : null}</div> : null}<p className="text-xs leading-relaxed text-muted-foreground">{t("numbers.tel.verifiedHint")}</p>
        </div>}
        {actionError ? <p role="alert" className="mt-4 text-sm text-destructive">{uiErrorMessage(t, actionError)}</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm">{t(notice)}</p> : null}
      </DrawerBody>
    </DrawerContent></Drawer>
    {dialog}
  </>;
}
