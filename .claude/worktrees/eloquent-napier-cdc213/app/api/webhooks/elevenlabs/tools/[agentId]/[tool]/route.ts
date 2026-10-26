import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { checkCalendarSlots, type CalendarSlot } from "@/lib/calendar";
import { getBusinessIdentity } from "@/lib/business-profile-store";
import { concreteAppointmentSlots } from "@/lib/action-runtime/appointment-slots";
import { resolveAppointmentTime } from "@/lib/action-runtime/appointment-time";
import { sendConfirmationNow } from "@/lib/action-runtime/deliver-now";
import { createCheckoutLink } from "@/lib/payments";
import { RagError, searchKnowledge } from "@/lib/rag";
import { setReminder } from "@/lib/reminder";
import { replyToContact } from "@/lib/automation-runner";
import { notifyOwnerQuietly } from "@/lib/notify-owner";
import { withHandoffNote } from "@/lib/human-handling";
import { getAgent, getAgentByElevenLabsAgentId, normalizePhone, upsertCallerContact, upsertChat, upsertContact } from "@/lib/business-store";
import { toCapabilityIds } from "@/lib/agent-capabilities";
import { listNumbers } from "@/lib/number-store";
import { voiceCustomerPhone } from "@/lib/voice-customer";
import { rateLimit } from "@/lib/rate-limit";
import { withWorkspace } from "@/lib/workspace-context";
import { readDocument } from "@/lib/doc-store";
import { DEFAULT_BUSINESS_ID } from "@/lib/business-scope";
import { bookVoiceAppointment, changeVoiceAppointment, validVoiceConversationId } from "@/lib/action-runtime/adapters/voice-booking";

type RegistryShape = { businesses: ReadonlyArray<{ id: string }> };
import {
  VOICE_TOOL_SECRET_HEADER,
  VOICE_CONVERSATION_HEADER,
  VOICE_CALLER_HEADER,
  VOICE_CALLED_HEADER,
  getVoiceTool,
  readVoiceHeader,
  storedVoiceToolsSecret,
  voiceSecretMatches,
} from "@/lib/voice-tools";
import {
  customerLanguage,
  formatForCustomer,
  type CustomerLanguage,
} from "@/lib/customer-messages";
import type { Contact } from "@/lib/types";

// POST /api/webhooks/elevenlabs/tools/<agentId>/<tool>
//
// What a phone call reaches when the voice agent uses a tool. ElevenLabs calls
// this from its own servers mid-conversation; nothing here ever sees a browser
// session, which is why it is public in middleware (covered by the
// /api/webhooks/elevenlabs prefix) and authenticated by the shared secret this
// app itself put on the tool — see lib/voice-tools.ts.
//
// Two rules run before any work happens, in this order:
//
//   1. The secret has to match. Without it this is an endpoint that books
//      meetings and creates payment links for anyone who finds the URL.
//   2. The agent named in the path has to be allowed the capability the tool
//      belongs to. The URL is the identity here, the same way ctx.session.id
//      is for a chat tool (lib/agent-scope.ts) — which is exactly why the
//      tools are created per agent rather than once per account.
//
// Every answer is a 200 with a JSON body the model reads out loud, including
// the refusals: an HTTP error reaches the model as an opaque tool failure, and
// what a caller then hears is silence or an invention. A sentence it can say
// is always better.

/** The shape the model gets back. `success` is what the prompt tells it to
 *  check before claiming anything happened. */
type ToolReply = Record<string, unknown> & { success: boolean; message: string };

function reply(body: ToolReply) {
  return NextResponse.json(body);
}

function refuse(message: string) {
  return reply({ success: false, message });
}

/** Trimmed string, or undefined. Voice models pad arguments with whitespace
 *  and with literal "null"/"undefined" more often than typed callers do. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(str(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A datetime the model dictated, or `undefined` if it is not a real one. */
function iso(value: unknown): Date | undefined {
  const raw = str(value);
  if (!raw || !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * A dictated datetime read in the business's time zone. A model writes
 * "2026-10-12T09:00:00" with no offset; `new Date` read that in the server's
 * zone, UTC on Vercel, so a morning in Bogotá was searched before dawn.
 */
function inZone(value: unknown, timeZone: string): Date | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    return new Date(resolveAppointmentTime(raw, timeZone));
  } catch {
    return undefined;
  }
}

const SPOKEN_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * How a slot is read out. The ISO string is for the next tool call; this is
 * for the caller's ear.
 *
 * Formatted in the caller's own language when their number says which one —
 * a US number hearing "martes 8 de octubre" is being read a date it cannot
 * confirm. Spanish is the fallback, which is what this always did.
 *
 * In the business's own time zone, from its booking policy: the server runs
 * in UTC, so without it a 10:00 slot in Bogotá was read out as 3:00 p. m.
 */
function spoken(date: Date, language: CustomerLanguage, timeZone: string | undefined): string {
  return formatForCustomer(date, language, timeZone ? { ...SPOKEN_FORMAT, timeZone } : SPOKEN_FORMAT);
}

/** A spoken date closing a sentence: Spanish times already end in a period
 *  ("10:00 a. m."), which a second one turned into "a. m..". */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/**
 * Bookable slots thinned out for a phone call: at least an hour apart, so the
 * five read into the model are not 9:00, 9:15, 9:30, 9:45 and 10:00 of the
 * same morning.
 */
function spreadForSpeech(slots: readonly CalendarSlot[], limit = 5): CalendarSlot[] {
  const picked: CalendarSlot[] = [];
  for (const slot of slots) {
    const at = Date.parse(slot.start);
    const last = picked.at(-1);
    if (last && at - Date.parse(last.start) < 60 * 60_000) continue;
    picked.push(slot);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Where a number the caller said out loud is kept, when it is not the one
 *  they are calling from. For the team to read, never to match a contact on. */
const DICTATED_PHONE_ATTRIBUTE = "voice.dictatedPhone";

/** Digits only, so "+57 300…" said out loud and "+57300…" from the network
 *  are recognised as the caller's own number. */
function phoneDigits(phone: string | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, "");
  return digits ? digits : undefined;
}

/**
 * The person on the other end of the call, saved to the CRM.
 *
 * Which contact that is comes from what the call proved, never from what was
 * said on it: the number the phone network reported (`callerId`), or, on a
 * browser test call that has none, the ElevenLabs conversation. A number the
 * caller dictates used to be the key — `upsertContact` merges on phone — so
 * saying someone else's number renamed that person, rewrote their notes and
 * put a booking on their record. Now it is kept on the caller's own contact
 * as an attribute for the team, and selects nothing (`upsertCallerContact`).
 *
 * A name or email the caller gives still updates their own contact: the email
 * is where a booking confirmation goes when the number cannot take WhatsApp.
 *
 * `channel: "voice"` is deliberate. Calling them a WhatsApp contact would make
 * the follow-up schedule message a number that may not have WhatsApp at all;
 * calling them a web contact would lose where they came from. See ContactChannel.
 */
async function contactFromCall(
  args: Record<string, unknown>,
  agentName: string,
  call: { readonly callerId?: string; readonly conversationId?: string },
  fallbackNote?: string,
): Promise<Contact | undefined> {
  const name = str(args.contact_name) ?? str(args.name);
  const dictated = normalizePhone(str(args.contact_phone) ?? str(args.phone));
  const email = str(args.contact_email) ?? str(args.email);
  // A known caller is someone even when they said nothing about themselves.
  if (!call.callerId && !name && !dictated && !email) return undefined;

  const contact = await upsertCallerContact({ phone: call.callerId, conversationId: call.conversationId }, {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(dictated && phoneDigits(dictated) !== phoneDigits(call.callerId)
      ? { attributes: { [DICTATED_PHONE_ATTRIBUTE]: dictated } }
      : {}),
    channel: "voice",
    source: `voice:${agentName}`,
    ...(fallbackNote ? { lastMessage: fallbackNote } : {}),
    lastMessageAt: new Date().toISOString(),
  });
  await upsertChat({
    title: contact.name,
    channel: "web",
    lastMessage: fallbackNote ?? "Llamada telefónica",
    lastMessageAt: contact.lastMessageAt,
    messageCount: 1,
  });
  return contact;
}

/**
 * The workspaces a voice tool may be answered from: the installation's own
 * first, then every additional one the registry knows. The store is scoped by
 * workspace, so the same agent id is not one record but one per workspace —
 * which is exactly why the lookup runs inside each candidate instead of
 * trusting whichever workspace the last browser click left active.
 *
 * Both ids the app answers to (its own `agent_*` and the ElevenLabs mirror)
 * live in the same per-workspace list, so one pass finds the agent under
 * either name.
 */
async function workspaceCandidates(): Promise<string[]> {
  const workspaces = [DEFAULT_BUSINESS_ID];
  try {
    const registry = await readDocument<RegistryShape>("businesses");
    for (const business of registry?.businesses ?? []) {
      if (business.id !== DEFAULT_BUSINESS_ID && !workspaces.includes(business.id)) {
        workspaces.push(business.id);
      }
    }
  } catch {
    // The registry is unreadable: the default workspace is still answered.
  }
  return workspaces;
}

/** The tool itself, run inside the workspace its agent belongs to. Split out
 *  of the handler so the pinning in POST wraps exactly this and nothing else;
 *  the agent's name arrives with it, because the workspace-scoped store is
 *  the only place it lives. */
async function runTool(
  request: NextRequest,
  specName: string,
  agentName: string,
  agentId: string,
  workspaceId: string,
): Promise<Response> {
  let args: Record<string, unknown> = {};
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") args = body as Record<string, unknown>;
  } catch {
    // A tool with no required arguments can legitimately arrive with no body.
  }

  // Who is on the phone. ElevenLabs sends it on every tool call, and its dial
  // code is what decides how a date is read back: a US caller hearing "martes
  // 8 de octubre" is being read a slot they cannot confirm. Spanish when the
  // header is missing or the country says nothing, which is what this did
  // before. See lib/customer-messages.ts.
  const callerId = voiceCustomerPhone(
    readVoiceHeader(request.headers, VOICE_CALLER_HEADER),
    readVoiceHeader(request.headers, VOICE_CALLED_HEADER),
    (await listNumbers()).map((line) => line.e164),
  );
  const callerLanguage = customerLanguage(callerId);
  // Whose contact a tool acts on (contactFromCall). voiceCustomerPhone only
  // returns a real E.164 number, so an unresolved browser-test placeholder
  // never becomes one; a conversation id must look like one for the same reason.
  const conversationHeader = readVoiceHeader(request.headers, VOICE_CONVERSATION_HEADER);
  const call = {
    callerId,
    ...(validVoiceConversationId(conversationHeader) ? { conversationId: conversationHeader } : {}),
  };
  const policy = (await getBusinessIdentity()).bookingPolicy;
  const timeZone = policy?.timeZone;

  switch (specName) {
    case "check_availability": {
      const durationMin = Math.round(num(args.duration_min, 30));
      // The same hours book_appointment enforces. Raw calendar gaps start at
      // whatever moment the range does — midnight, or "right now" — so a call
      // was offered "lunes 12:00 a. m.", the caller said yes, and the booking
      // was then refused as outside business hours.
      if (!policy?.hours.length) {
        return refuse(
          "No hay horarios de atención configurados para agendar solo. No ofrezcas horarios: dile a la persona que el equipo la contacta para coordinar.",
        );
      }
      const parsedStart = inZone(args.start_iso, policy.timeZone);
      const parsedEnd = inZone(args.end_iso, policy.timeZone);
      if ((str(args.start_iso) && !parsedStart) || (str(args.end_iso) && !parsedEnd)) {
        return refuse("La fecha no es válida. Usá YYYY-MM-DDTHH:mm en la zona del negocio, o una fecha ISO con zona; no cambies la hora para intentar agendar.");
      }
      const start = parsedStart ?? new Date();
      const end = parsedEnd ?? new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
      if (end.getTime() <= start.getTime()) {
        return refuse("El rango de fechas está al revés. Pídele a la persona otra fecha.");
      }
      try {
        const gaps = await checkCalendarSlots({
          start: start.toISOString(),
          end: end.toISOString(),
          durationMin,
        });
        const slots = spreadForSpeech(concreteAppointmentSlots({ gaps, policy, durationMin }));
        if (slots.length === 0) {
          return reply({
            success: true,
            slots: [],
            message: "No hay horarios libres en ese rango. Ofrece buscar en otras fechas.",
          });
        }
        // Only a few (spreadForSpeech): a phone call cannot absorb a list, and
        // the whole response is read into the model's context.
        const offered = slots.map((slot) => ({
          start_iso: slot.start,
          spoken: spoken(new Date(slot.start), callerLanguage, policy.timeZone),
        }));
        return reply({
          success: true,
          slots: offered,
          message: `Hay ${slots.length} horario(s) disponibles. Ofrece uno o dos, y usa su start_iso al agendar.`,
        });
      } catch (error) {
        return refuse(
          `No pude consultar la agenda: ${error instanceof Error ? error.message : "error desconocido"}. Dile a la persona que no puedes confirmar horarios ahora.`,
        );
      }
    }

    case "book_appointment": {
      const conversationId = readVoiceHeader(request.headers, VOICE_CONVERSATION_HEADER);
      if (conversationId !== null) {
        if (!validVoiceConversationId(conversationId)) {
          return refuse("No pude verificar esta llamada. Resincroniza las herramientas de voz antes de agendar.");
        }
        const startIso = str(args.start_iso);
        const title = str(args.summary);
        if (!startIso || !title) return refuse("Necesito la fecha exacta y el motivo de la cita.");
        const contact = await contactFromCall(args, agentName, call, `Pidió turno: ${title}`);
        if (!contact) return refuse("Necesito un contacto para agendar esta cita.");
        try {
          const outcome = await bookVoiceAppointment({
            workspaceId,
            agentId,
            conversationId,
            callerId,
            contact,
            start: startIso,
            durationMin: num(args.duration_min, 30),
            summary: title,
            description: str(args.description),
            withMeet: typeof args.with_meet === "boolean" ? args.with_meet : undefined,
            serviceName: str(args.service_name),
          });
          if (outcome.status !== "booked") {
            return refuse(`No puedo confirmar la cita (${outcome.status}: ${outcome.reason}). No digas que quedó agendada.`);
          }
          const delivery = outcome.confirmation === "queued"
            ? await sendConfirmationNow(workspaceId, outcome.actionId) : "unavailable";
          const via = outcome.confirmationChannel === "email" ? "por email" : "por WhatsApp";
          const local = formatForCustomer(new Date(outcome.start), callerLanguage, {
            ...SPOKEN_FORMAT,
            timeZone: outcome.timeZone,
          });
          return reply({
            success: true,
            event_id: outcome.eventId,
            starts_at: outcome.start,
            spoken: local,
            contact_id: contact.id,
            meet_link: outcome.meetUrl,
            ...(outcome.location ? { location: outcome.location } : {}),
            confirmation_queued: delivery === "queued",
            confirmation_sent: delivery === "sent",
            confirmation_status: delivery,
            reminders_queued: outcome.remindersQueued,
            message: `La cita quedó agendada para ${sentence(local)} ` +
              (outcome.location ? `Es presencial en ${outcome.location}: díselo, no hay videollamada. ` : "") +
              (delivery === "sent"
                ? `La confirmación escrita se envió ${via}.`
                : delivery === "queued"
                  ? `La confirmación escrita ${via} quedó en cola para reintentar; no digas que ya se envió.`
                  : delivery === "failed" || delivery === "unknown"
                    ? "La cita existe, pero no pude confirmar la entrega del mensaje; requiere revisión del equipo."
                    : "No hay un canal de confirmación verificado. Confirma la fecha de viva voz.") +
              (outcome.remindersQueued > 0 ? " Los recordatorios antes de la cita ya están programados. No ofrezcas otro recordatorio." : ""),
          });
        } catch (error) {
          return refuse(`No pude agendar: ${error instanceof Error ? error.message : "error desconocido"}. No afirmes que la cita existe.`);
        }
      }

      return refuse("No pude verificar esta llamada. Resincroniza las herramientas de voz antes de agendar. No se creó ninguna reserva.");
    }

    case "reschedule_appointment":
    case "cancel_appointment": {
      const conversationId = readVoiceHeader(request.headers, VOICE_CONVERSATION_HEADER);
      if (!validVoiceConversationId(conversationId)) {
        return refuse("No pude verificar esta llamada. Resincroniza las herramientas de voz antes de cambiar una cita.");
      }
      if (!callerId) {
        return refuse("No veo el número de quien llama, así que no puedo encontrar su cita. Ofrece pasarle con una persona.");
      }
      const startIso = str(args.start_iso);
      if (specName === "reschedule_appointment" && !startIso) {
        return refuse("Necesito el nuevo horario. Consulta check_availability y confírmalo con la persona.");
      }
      try {
        const outcome = await changeVoiceAppointment({
          workspaceId,
          conversationId,
          callerId,
          ...(str(args.current_start_iso) ? { currentStart: str(args.current_start_iso)! } : {}),
          change: specName === "cancel_appointment"
            ? { kind: "cancel" }
            : { kind: "reschedule", start: startIso! },
        });
        if (outcome.status === "cancelled") {
          const local = formatForCustomer(new Date(outcome.start), callerLanguage, { ...SPOKEN_FORMAT, timeZone });
          return reply({ success: true, message: `Cancelé la cita del ${sentence(local)} Sus recordatorios también se cancelaron.` });
        }
        if (outcome.status === "rescheduled") {
          const delivery = outcome.confirmationChannel ? await sendConfirmationNow(workspaceId, outcome.actionId) : "unavailable";
          const local = formatForCustomer(new Date(outcome.start), callerLanguage, { ...SPOKEN_FORMAT, timeZone: outcome.timeZone });
          return reply({
            success: true,
            starts_at: outcome.start,
            spoken: local,
            message: `La cita quedó movida para ${sentence(local)} ` +
              (delivery === "sent"
                ? "La nueva confirmación escrita ya se envió."
                : delivery === "unavailable"
                  ? "No hay canal escrito verificado: confirma la nueva fecha de viva voz."
                  : "La nueva confirmación escrita quedó en cola; no digas que ya llegó.") +
              (outcome.remindersQueued > 0 ? " Los recordatorios se movieron a la nueva fecha." : ""),
          });
        }
        return refuse(`No pude cambiar la cita (${outcome.status}: ${outcome.reason}). No digas que se cambió.`);
      } catch (error) {
        return refuse(`No pude cambiar la cita: ${error instanceof Error ? error.message : "error desconocido"}. No digas que se cambió.`);
      }
    }

    case "save_contact": {
      const contact = await contactFromCall(args, agentName, call, str(args.notes));
      if (!contact) return refuse("Necesito al menos un nombre, un teléfono o un email para guardar.");
      if (str(args.notes)) {
        await upsertContact({ id: contact.id, notes: str(args.notes) });
      }
      return reply({
        success: true,
        contact_id: contact.id,
        message: `Guardado en el sistema como ${contact.name}.`,
      });
    }

    case "set_reminder": {
      const when = timeZone ? inZone(args.datetime_iso, timeZone) : iso(args.datetime_iso);
      const message = str(args.message);
      if (!when) return refuse("Necesito la fecha y hora exactas del recordatorio.");
      if (when.getTime() <= Date.now()) {
        return refuse("Ese momento ya pasó. Pídele a la persona una fecha futura.");
      }
      if (!message) return refuse("Necesito saber qué hay que recordarle.");

      const contact = await contactFromCall(args, agentName, call, `Recordatorio: ${message}`);
      if (!contact) {
        return refuse(
          "Para programar un recordatorio necesito saber para quién es. Pídele el nombre y el teléfono, y vuelve a intentarlo.",
        );
      }
      try {
        const result = await setReminder({
          contact_id: contact.id,
          datetime: when.toISOString(),
          message,
        });
        return reply({
          success: true,
          reminder_id: result.reminder_id,
          contact_id: contact.id,
          message: `Recordatorio programado para ${sentence(spoken(when, callerLanguage, timeZone))}`,
        });
      } catch (error) {
        return refuse(
          `No pude programar el recordatorio: ${error instanceof Error ? error.message : "error desconocido"}.`,
        );
      }
    }

    case "send_payment_link": {
      const amount = str(args.amount);
      const productName = str(args.product_name);
      if (!amount || !productName) {
        return refuse("Necesito el importe y qué se está pagando antes de generar el link.");
      }
      const contact = await contactFromCall(args, agentName, call, `Link de pago: ${productName}`);
      const created = await createCheckoutLink({
        amount,
        currency: str(args.currency) ?? "usd",
        productName,
        contactId: contact?.id,
        agentId,
      });
      if (!created) {
        return refuse(
          "No hay ningún medio de cobro configurado en el sistema. Dile a la persona que te vas a comunicar con el link.",
        );
      }
      // The prompt promises the link arrives on WhatsApp. Whether it actually
      // does is reported honestly, because a caller who is told to expect a
      // message and never gets one is worse off than one who was told nothing.
      // Through `replyToContact`, not a raw text send: a phone call opens no
      // WhatsApp customer-service window, so an unqualified free-form message
      // is one Meta refuses. `delivered: false` was therefore the normal
      // outcome on a correctly configured install, and the caller was told to
      // wait for the team over a link that had simply been rejected.
      const phone = str(args.contact_phone) ?? contact?.phone;
      let delivered = false;
      if (contact && phone) {
        const sent = await replyToContact(
          contact.phone ? contact : { ...contact, phone },
          `${productName}: ${created.url}`,
        );
        delivered = Boolean(sent?.ok);
        if (!sent?.ok) {
          console.warn("[voice-tools] payment link not delivered", {
            contact: contact.id,
            detail: sent?.detail ?? "no outbound channel",
          });
        }
      }
      return reply({
        success: true,
        provider: created.provider,
        delivered,
        contact_id: contact?.id,
        message: delivered
          ? "El link de pago se envió por WhatsApp al número que dio. No leas el link en voz alta."
          : "El link de pago quedó creado, pero no se pudo enviar por WhatsApp. Dile que el equipo se lo hace llegar. Nunca leas el link en voz alta.",
      });
    }

    case "search_knowledge": {
      const query = str(args.query);
      if (!query) return refuse("Necesito saber qué buscar.");
      try {
        const matches = await searchKnowledge(query, { limit: 3 });
        if (matches.length === 0) {
          return reply({
            success: true,
            results: [],
            message: "No hay nada sobre eso en los documentos del negocio. Dilo así, no inventes.",
          });
        }
        return reply({
          success: true,
          results: matches.map((match) => ({ document: match.doc_name, excerpt: match.text })),
          message: `Encontré ${matches.length} pasaje(s). Contesta solo con eso.`,
        });
      } catch (error) {
        if (error instanceof RagError) return refuse(error.message);
        return refuse("No pude buscar en los documentos ahora.");
      }
    }

    case "transfer_to_human": {
      const reason = str(args.reason) ?? "Pidió hablar con una persona.";
      const contact = await contactFromCall(args, agentName, call, reason);
      if (!contact) {
        return refuse(
          "Para pasar el caso a una persona necesito al menos un nombre o un teléfono. Pedíselos.",
        );
      }
      await upsertContact({ id: contact.id, status: "waiting_human", notes: withHandoffNote(contact.notes, reason) });
      // A caller who asked for a person is only helped if someone hears about it.
      await notifyOwnerQuietly({
        type: "handoff_requested", actor: { type: "agent", id: agentId, name: agentName },
        subject: contact.name, detail: reason, channel: "voice",
        target: { kind: "contact", id: contact.id, label: contact.name, href: "/inbox" },
        dedupeKey: `handoff:${contact.id}`,
      });
      await upsertChat({
        title: contact.name,
        channel: "web",
        lastMessage: reason,
        lastMessageAt: new Date().toISOString(),
        messageCount: 1,
        handoff: true,
      });
      return reply({
        success: true,
        contact_id: contact.id,
        handoff_mode: "callback_requested",
        live_transfer: false,
        message: "El equipo recibió la solicitud para continuar el caso. Esto no transfiere la llamada: no digas que hay una persona en línea ni prometas cuándo devolverán la llamada.",
      });
    }
  }

  return refuse("Esa herramienta no está disponible para este agente.");
}

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string; tool: string }> },
) {
  const { agentId, tool } = await context.params;

  // The shared secret is the same for every agent's tools, so what bounds a
  // leaked URL beyond it is the budget — per address, shared with the other
  // public webhooks.
  if (!(await rateLimit("public-webhook", request, { max: 30, windowMs: 10 * 60_000 })).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const spec = getVoiceTool(tool);
  if (!spec) return refuse("Esa herramienta no existe en este sistema.");

  // No secret yet means no agent was ever handed one, so nothing legitimate
  // can be calling.
  const secret = await storedVoiceToolsSecret();
  if (!secret || !voiceSecretMatches(readVoiceHeader(request.headers, VOICE_TOOL_SECRET_HEADER), secret)) {
    // The only case where an HTTP status is the honest answer: this is not the
    // agent asking, so there is nobody to read a sentence to.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The workspace follows the agent, not the browser: whichever business the
  // operator last had open must not decide whose CRM a caller's turno lands
  // in. The URL may name either id the app answers to — its own or the
  // ElevenLabs mirror's — so both are tried, and either way the agent is
  // looked up inside each candidate workspace. Same file or table, a
  // different row.
  type AgentRecord = NonNullable<Awaited<ReturnType<typeof getAgent>>>;
  let found: { readonly agent: AgentRecord; readonly workspace: string } | undefined;
  for (const workspace of await workspaceCandidates()) {
    const record = await withWorkspace(workspace, async () =>
      (await getAgent(agentId)) ?? (await getAgentByElevenLabsAgentId(agentId)));
    if (record) {
      found = { agent: record, workspace };
      break;
    }
  }
  if (!found) {
    return refuse("Este agente ya no existe en el sistema. Avísale a la persona que no puedes completar la acción.");
  }
  const { agent, workspace: agentWorkspace } = found;

  if (agent.status !== "active") {
    return refuse(
      `El agente "${agent.name}" no está activo. Dile a la persona que no puedes completar esta acción y no afirmes lo contrario.`,
    );
  }

  const allowed = toCapabilityIds(agent.tools);
  if (!allowed.includes(spec.capability)) {
    return refuse(
      `No tienes habilitada la función "${spec.capability}". Dile a la persona que no puedes hacerlo y no afirmes lo contrario.`,
    );
  }

  // Everything the tool reads and writes now belongs to the agent's own
  // business; the installation's active-business pointer is not consulted.
  return withWorkspace(agentWorkspace, () => runTool(request, spec.name, agent.name, agent.id, agentWorkspace));
});
