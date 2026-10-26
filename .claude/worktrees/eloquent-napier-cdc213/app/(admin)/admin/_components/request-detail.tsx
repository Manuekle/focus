"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { MANUAL_REQUEST_STATUSES, type AccessRequest, type AccessRequestStatus } from "@/lib/access-request-types";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref } from "./admin-shell";
import { RequestAdmission, type Installation } from "./request-admission";
import { RequestNotice } from "./request-notice";

export function RequestDetail({ request, installation }: { request: AccessRequest; installation: Installation }) {
  const href = useAdminHref();
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const { tr, fmt, labels } = useAdminLocale();
  const confirming = useRef(false);
  const [saved, setSaved] = useState(request);
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.notes);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const dirty = status !== saved.status || notes.trim() !== saved.notes;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const warnLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (anchor instanceof HTMLAnchorElement && anchor.origin === location.origin &&
        anchor.target !== "_blank" && !anchor.hasAttribute("download") &&
        `${anchor.pathname}${anchor.search}` !== `${location.pathname}${location.search}`) {
        event.preventDefault();
        event.stopPropagation();
        if (confirming.current) return;
        confirming.current = true;
        void confirm({
          title: tr("Hay cambios sin guardar", "You have unsaved changes"),
          description: tr("Si sales, perderás los cambios de estado y las notas que no guardaste.", "If you leave, the status and notes you did not save are lost."),
          confirmLabel: tr("Descartar y salir", "Discard and leave"), cancelLabel: tr("Seguir editando", "Keep editing"),
        }).then((leave) => {
          confirming.current = false;
          if (leave) router.push(`${anchor.pathname}${anchor.search}${anchor.hash}`);
        });
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", warnLink, true);
    };
  }, [dirty, confirm, router, tr]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/requests/${saved.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, notes, revision: saved.revision }),
      });
      if (!response.ok) {
        setFeedback({ ok: false, message: response.status === 409
          ? tr("Otra sesión modificó esta solicitud. Actualiza la página y revisa los cambios antes de guardar.", "Another session changed this request. Reload and review the changes before saving.")
          : tr("No se guardaron los cambios. Comprueba tu sesión y vuelve a intentarlo.", "The changes were not saved. Check your session and try again.") });
        return;
      }
      const result = await response.json() as { request: AccessRequest };
      setSaved(result.request);
      setStatus(result.request.status);
      setNotes(result.request.notes);
      setFeedback({ ok: true, message: tr("Seguimiento guardado.", "Follow-up saved.") });
      router.refresh();
    } catch {
      setFeedback({ ok: false, message: tr("No se pudo conectar. Tus cambios siguen aquí; vuelve a guardar.", "Could not connect. Your changes are still here; save again.") });
    } finally { setSaving(false); }
  }

  return <div className="content-enter space-y-6">
    {dialog}
    <PageHeader
      back={{ href: href("/requests"), label: tr("Solicitudes", "Requests") }}
      title={saved.company}
      description={`${labels.requestSource[saved.source]} · ${fmt.dateTime(saved.createdAt)} · Bogotá`}
      actions={<Button asChild size="sm" variant="outline">
        <Link href={`${href("/calls")}?${new URLSearchParams({ status: "all", attendeeEmail: saved.email })}`}>
          {tr("Ver llamadas de este contacto", "View this contact's calls")}
        </Link>
      </Button>}
    />
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle as="h2">{tr("Solicitud recibida", "Request received")}</CardTitle></CardHeader><CardSeparator />
        <div className="space-y-5 p-5">
          <dl className="grid gap-4 text-sm">
            <div><dt className="text-xs text-muted-foreground">{tr("Nombre", "Name")}</dt><dd className="mt-1 break-words">{saved.name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="mt-1 break-all"><a href={`mailto:${saved.email}`} className="rounded underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring">{saved.email}</a></dd></div>
            <div><dt className="text-xs text-muted-foreground">{tr("Empresa", "Company")}</dt><dd className="mt-1 break-words">{saved.company}</dd></div>
          </dl>
          <div><h3 className="text-xs text-muted-foreground">{tr("Mensaje", "Message")}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{saved.message || tr("No incluyó un mensaje.", "No message included.")}</p></div>
          <RequestNotice request={saved} onChange={setSaved} />
        </div>
      </Card>
      <Card>
        <CardHeader><CardTitle as="h2">{tr("Seguimiento interno", "Internal follow-up")}</CardTitle></CardHeader><CardSeparator />
        <form onSubmit={(event) => void save(event)} className="space-y-4 p-5">
          <div className="grid gap-1.5">
            <label htmlFor="followup-status" className="text-xs text-muted-foreground">{tr("Estado", "Status")}</label>
            <Select name="status" value={status} onValueChange={(value) => setStatus(value as AccessRequestStatus)} disabled={saving || Boolean(saved.admission)}>
              <SelectTrigger id="followup-status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" align="start">
                {(saved.admission ? (["admitted"] as const) : MANUAL_REQUEST_STATUSES).map((value) => <SelectItem key={value} value={value}>{labels.requestStatus[value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="grid gap-1.5 text-xs text-muted-foreground">{tr("Notas internas", "Internal notes")}
            <Textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} autoComplete="off" className="min-h-36" placeholder={tr("Próximo paso, contexto o resultado del contacto…", "Next step, context or how the contact went…")} disabled={saving} />
          </label>
          <p className="text-xs text-muted-foreground">{saved.admission
            ? tr("La solicitud está admitida: su instalación sigue abajo. Las notas siguen editables.", "The request is admitted: its install is below. Notes stay editable.")
            : tr("Cambiar el estado registra el seguimiento. Para dar acceso a la beta, admítela abajo.", "Changing the status records the follow-up. To give beta access, admit it below.")}</p>
          <div aria-live="polite">{feedback ? <Alert tone={feedback.ok ? "success" : "error"}>{feedback.message}</Alert> : null}</div>
          <Button type="submit" disabled={saving || !dirty}>{saving ? tr("Guardando…", "Saving…") : tr("Guardar seguimiento", "Save follow-up")}</Button>
        </form>
      </Card>
    </div>
    <RequestAdmission request={saved} installation={installation} onAdmitted={(admitted) => {
      setSaved(admitted);
      setStatus(admitted.status);
    }} />
    <Card>
      <CardHeader><CardTitle as="h2">{tr("Historial de seguimiento", "Follow-up history")}</CardTitle></CardHeader><CardSeparator />
      {saved.history.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{tr("Todavía no hay cambios de seguimiento.", "No follow-up changes yet.")}</p> : <ol className="divide-y divide-border">
        {[...saved.history].reverse().map((entry, index) => <li key={index} className="space-y-1 p-5 text-sm">
          <p>{labels.requestStatus[entry.status]} <span className="text-xs text-muted-foreground">· {fmt.dateTime(entry.at)}</span></p>
          <p className="break-all text-xs text-muted-foreground">{entry.actor}</p>
          {entry.summary ? <p className="break-words">{entry.summary}</p> : null}
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{entry.notes || tr("Sin notas internas.", "No internal notes.")}</p>
        </li>)}
      </ol>}
    </Card>
  </div>;
}
