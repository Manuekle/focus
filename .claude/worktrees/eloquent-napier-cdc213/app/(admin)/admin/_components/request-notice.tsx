"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { noticeRetryable, type AccessRequest } from "@/lib/access-request-types";
import { useAdminLocale } from "./admin-locale";
import { useAdminNow } from "./admin-shell";

// The team's email about this request (lib/access-request-notice.ts): how it
// went, and a resend when it failed (POST /api/admin/requests/<id>/notify).
// The request is stored either way; this only concerns the inbox copy.

export function RequestNotice({ request, onChange }: {
  readonly request: AccessRequest; readonly onChange: (request: AccessRequest) => void;
}) {
  const now = useAdminNow();
  const { tr } = useAdminLocale();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryable = noticeRetryable(request, now);

  async function resend() {
    setSending(true);
    setError(null);
    const response = await fetch(`/api/admin/requests/${request.id}/notify`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => null) as { request?: AccessRequest; sent?: boolean; message?: string } | null;
    setSending(false);
    if (body?.request) onChange(body.request);
    if (!response?.ok) setError(body?.message ?? tr("No se pudo reenviar. Vuelve a intentarlo.", "Could not send it again. Try again."));
    else if (!body?.sent) setError(tr("El proveedor de correo volvió a fallar. La solicitud sigue guardada.", "The email provider failed again. The request is still saved."));
  }

  const state = request.notification === "sent" ? tr("enviado", "sent")
    : retryable ? (request.notification === "failed" ? tr("falló; la solicitud está guardada", "failed; the request is saved") : tr("no se confirmó", "not confirmed"))
    : tr("enviándose", "sending");
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
    <p>{tr("Aviso al equipo por correo", "Email notice to the team")}: {state}.</p>
    {retryable ? <Button size="sm" variant="secondary" disabled={sending} onClick={() => void resend()}>
      {sending ? tr("Reenviando…", "Sending…") : tr("Reenviar aviso", "Send notice again")}
    </Button> : null}
    {error ? <p role="status" className="w-full text-destructive">{error}</p> : null}
  </div>;
}
