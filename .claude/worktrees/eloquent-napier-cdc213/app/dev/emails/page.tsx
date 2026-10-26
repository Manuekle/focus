import { renderAccountEmail } from "@/lib/account-email";
import { renderOwnerEmail } from "@/lib/notify-owner";
import { renderTemplateById } from "@/lib/email-render";
import { BUILTIN_TEMPLATES } from "@/components/email-templates";
import { renderBusinessMessage, renderNotice } from "@/lib/email-message";
import type { AppNotification } from "@/lib/notification-types";
import { EMAIL_ASSET_ORIGIN } from "@/components/email-templates/theme";

// Every email the app sends, rendered with fixture data, side by side. The
// frames take the browser's colour scheme, so dark mode is one emulation away.
// Assets point at this dev server instead of www.oruka.si, so a logo or face
// changed locally shows before it is deployed.

export const dynamic = "force-dynamic";

const agent = { type: "agent", id: "agent-preview", name: "AI Receptionist", iconKey: "receptionist" } as const;
const at = "2026-10-14T12:00:00.000Z";

const OWNER_ALERTS: AppNotification[] = [
  {
    id: "preview-approval", type: "approval_requested", actor: agent, createdAt: at, channel: "whatsapp",
    subject: "Descuento del 15% en el plan anual",
    detail: "Pregunta si hay descuento por pagar el año por adelantado. La lista de precios no tiene uno.",
    target: { kind: "contact", id: "c1", label: "Ana Pérez", href: "/inbox" },
    approval: {
      status: "pending", action: "Descuento del 15% en el plan anual", expiresAt: at,
      proposedReply: "¡Sí! Pagando el año por adelantado tenés un 15% de descuento. ¿Te paso el link de pago?",
    },
  },
  {
    id: "preview-handoff", type: "handoff_requested", actor: agent, createdAt: at, channel: "instagram",
    subject: "Ana Pérez", detail: "Pidió hablar con una persona por un cobro duplicado en su factura.",
    target: { kind: "contact", id: "c1", label: "Ana Pérez", href: "/inbox" },
  },
  {
    id: "preview-team", type: "team_actions", actor: agent, createdAt: at, subject: "Ana Pérez",
    detail: "Marqué a Ana para seguimiento mañana y anoté que pidió precios del plan anual.",
  },
  {
    id: "preview-failed", type: "team_round_failed", actor: agent, createdAt: at, subject: "Ana Pérez",
    detail: "El agente no pudo completar esta tarea después de varios intentos.",
  },
];

type Preview = { readonly id: string; readonly group: string; readonly label: string; readonly subject: string; readonly html: string };

async function previews(): Promise<Preview[]> {
  const out: Preview[] = [];
  for (const kind of ["invite", "reset"] as const) {
    const email = await renderAccountEmail({ link: "https://oruka.si/reset-password?token=preview", locale: "es", kind });
    out.push({ id: `account-${kind}`, group: "Cuenta", label: kind === "invite" ? "Invitación" : "Restablecer contraseña", subject: email.subject, html: email.html });
  }
  for (const item of OWNER_ALERTS) {
    const email = await renderOwnerEmail(item, "es");
    out.push({ id: item.id, group: "Avisos al dueño", label: item.type, subject: email.subject, html: email.html });
  }
  const appointment = await renderBusinessMessage({
    companyName: "Estudio Norte", title: "Tu cita",
    body: "Hola Lucía, tu turno quedó confirmado para el martes 9 de septiembre a las 15:30.\n\nTe esperamos en Av. Corrientes 1234, CABA. Si necesitás cambiarlo, respondé este correo.",
  });
  out.push({ id: "message-appointment", group: "Mensajes del negocio", label: "Confirmación de cita", subject: "Tu cita", html: appointment.html });
  const automation = await renderBusinessMessage({
    companyName: "Estudio Norte", preview: "¿Seguimos con tu presupuesto?",
    body: "Hola Martín, ¿pudiste ver el presupuesto que te mandamos?\n\nSi querés, lo ajustamos a lo que necesitás. Respondé este correo y lo vemos.",
  });
  out.push({ id: "message-automation", group: "Mensajes del negocio", label: "Paso de automatización", subject: "¿Seguimos con tu presupuesto?", html: automation.html });
  const access = await renderNotice({
    eyebrow: "Solicitud nueva", tone: "sky", title: "Acceso anticipado", subject: "Estudio Norte",
    facts: [{ label: "Nombre", value: "Lucía Gómez" }, { label: "Email", value: "lucia@ejemplo.com" }, { label: "Empresa", value: "Estudio Norte" }],
    quote: { label: "Mensaje", text: "Queremos probarlo con nuestro WhatsApp de turnos." },
    note: "Respondé este correo para escribirle directamente.",
    footer: "Aviso interno de Oruka para el equipo que atiende las solicitudes.",
  });
  out.push({ id: "notice-access", group: "Avisos internos", label: "Solicitud de acceso", subject: "Acceso anticipado — Estudio Norte", html: access.html });
  for (const template of BUILTIN_TEMPLATES) {
    const email = await renderTemplateById(template.id, template.sample as Record<string, string>);
    out.push({ id: `template-${template.id}`, group: "Plantillas del negocio", label: template.label, subject: template.subject ?? template.label, html: email.html });
  }
  return out;
}

export default async function EmailsPreviewPage() {
  const list = (await previews()).map((email) => ({ ...email, html: email.html.replaceAll(EMAIL_ASSET_ORIGIN, "") }));
  return (
    <main className="min-h-dvh bg-background px-6 py-10 text-foreground">
      <h1 className="text-xl font-semibold tracking-tight">Correos</h1>
      <p className="mt-1 text-sm text-muted-foreground">{list.length} correos con datos de ejemplo.</p>
      <nav className="mt-6 flex flex-wrap gap-2">
        {list.map((email) => <a key={email.id} href={`#${email.id}`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent">{email.label}</a>)}
      </nav>
      <div className="mt-10 grid gap-12">
        {list.map((email) => (
          <section key={email.id} id={email.id} className="scroll-mt-6">
            <p className="text-[11px] font-medium text-muted-foreground">{email.group}</p>
            <h2 className="mt-1 text-sm font-medium">{email.label} <span className="font-normal text-muted-foreground">· {email.subject}</span></h2>
            <iframe title={email.label} srcDoc={email.html} className="mt-3 h-[880px] w-full max-w-[680px] rounded-xl border border-border bg-white" />
          </section>
        ))}
      </div>
    </main>
  );
}
