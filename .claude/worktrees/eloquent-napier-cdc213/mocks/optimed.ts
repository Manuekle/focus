// The demo business: Optimed, an optical clinic in Bogotá.
//
// One fixture, two places. `pnpm dev:mock` writes it into a throwaway home
// (scripts/dev-mock.mjs), and the hosted test tenant loads the very same
// object through /api/fleet/fixture (lib/demo-fixture.ts) — so the clinic you
// click through on localhost:3100 is the clinic on prueba.oruka.si, with the
// same ids, conversations and agents. Change it here and both follow.
//
// Three rules for anything added:
//
// 1. Obviously fake to a human. Every address is `.test` — a reserved TLD
//    that cannot resolve — phones sit in the 555 range, and the street is
//    labelled as a test address. Data that looks plausibly real ends up
//    mistaken for real.
// 2. Dates are relative to `now`, never absolute, and computed when the
//    fixture is built rather than when this module loads: a long-running
//    server that loaded it last week must not seed last week's "hace 12 min".
// 3. Cover the states a screen is for: contacts waiting on a person, follow-
//    ups due, deals in every stage including lost, and conversations that
//    moved between agents, so the agent rotation has something to show.

import type { BookingPolicy } from "../lib/action-runtime/booking-policy";
import type { BusinessProfile } from "../lib/business-profile-store";
import type {
  Agent,
  ChannelConversation,
  ChannelId,
  ChatSummary,
  Contact,
  Deal,
  Form,
  FormResponse,
  Reminder,
} from "../lib/types";

/** The login `pnpm dev:mock` creates. Local only: never sent to a deployed tenant. */
export const DEMO_ACCOUNT = { email: "demo@optimed.test", password: "optimed-demo-123" } as const;

export type DemoWeeklyAd = {
  readonly adId: string;
  readonly name: string;
  readonly status: "ACTIVE";
  readonly grade: Record<string, unknown> & { readonly scores: Record<string, number> };
  readonly previous: { readonly spend: number; readonly impressions: number; readonly clicks: number; readonly results: number };
  readonly week: { readonly spend: number; readonly impressions: number; readonly clicks: number; readonly results: number };
};

export type DemoFixture = {
  readonly business: {
    readonly contacts: Contact[];
    readonly deals: Deal[];
    readonly chats: ChatSummary[];
    readonly reminders: Reminder[];
    readonly agents: Agent[];
    readonly forms: Form[];
    readonly formResponses: FormResponse[];
    readonly channelConversations: ChannelConversation[];
    readonly channelAgents: Partial<Record<ChannelId, string>>;
  };
  /** One knowledge document, as the owner would have uploaded it. */
  readonly knowledge: { readonly name: string; readonly text: string };
  readonly profile: BusinessProfile;
  readonly identity: {
    readonly name: string;
    readonly description: string;
    readonly email: string;
    readonly phone: string;
    readonly address: string;
    readonly hours: string;
    readonly websiteUrl: string;
  };
  readonly bookingPolicy: BookingPolicy;
  /** Two weeks of a small ad account, for the Monday report the mock shows. */
  readonly weeklyAds: readonly DemoWeeklyAd[];
};

const AGENT = {
  front: "op-ag-recepcion",
  sales: "op-ag-ventas",
  booking: "op-ag-citas",
  support: "op-ag-postventa",
} as const;

const AGENT_NAME = {
  [AGENT.front]: "Recepción",
  [AGENT.sales]: "Ventas",
  [AGENT.booking]: "Citas",
  [AGENT.support]: "Postventa",
} as const;

export function optimedFixture(now: number = Date.now()): DemoFixture {
  const iso = (ms: number) => new Date(ms).toISOString();
  const minsAgo = (n: number) => iso(now - n * 60_000);
  const hoursAgo = (n: number) => iso(now - n * 3_600_000);
  const daysAgo = (n: number) => iso(now - n * 86_400_000);
  const daysAhead = (n: number) => iso(now + n * 86_400_000);

  /** Triage attributes, in the shape lib/triage.ts writes them. */
  const triage = (intent: string, urgency: number, needsHuman: number, buyingSignal: number, route: string, confidence = 0.9) => ({
    "triage.intent": intent,
    "triage.route": route,
    "triage.urgency": urgency.toFixed(2),
    "triage.needsHuman": needsHuman.toFixed(2),
    "triage.buyingSignal": buyingSignal.toFixed(2),
    "triage.confidence": confidence.toFixed(2),
  });
  /** Which specialist holds the conversation, as lib/agent-routing.ts writes it. */
  const routed = (agentId: string, specialty: string) => ({ "routing.agentId": agentId, "routing.specialty": specialty });

  const contacts: Contact[] = [
    {
      id: "op-ct-01", name: "Laura Gómez", email: "laura.gomez@mock.test", phone: "+573005550101",
      channel: "whatsapp", source: "whatsapp", status: "waiting_human", sessionId: "op-chat-01",
      lastMessage: "Ya van dos semanas y las gafas llegaron con la fórmula equivocada.",
      attributes: { ...triage("complaint", 3, 0.9, 0.1, "human", 0.95), ...routed(AGENT.support, "support"), producto: "Gafas formuladas" },
      notes: "Reclamo abierto: fórmula equivocada en el laboratorio. Revisar con optometría.",
      lastMessageAt: minsAgo(14), createdAt: daysAgo(31),
    },
    {
      id: "op-ct-02", name: "Andrés Rojas", email: "andres.rojas@mock.test", phone: "+573005550102",
      channel: "instagram", source: "instagram", status: "open", sessionId: "op-chat-02",
      lastMessage: "¿Cuánto cuestan los progresivos con antirreflejo?",
      attributes: { ...triage("buy", 2, 0.1, 0.92, "agent"), ...routed(AGENT.sales, "sales") },
      lastMessageAt: minsAgo(38), createdAt: daysAgo(2),
    },
    {
      id: "op-ct-03", name: "Camila Torres", email: "camila.torres@mock.test", phone: "+573005550103",
      channel: "whatsapp", source: "meta_ads", status: "open", sessionId: "op-chat-03",
      lastMessage: "Quiero agendar el examen visual para el sábado en la mañana.",
      attributes: { ...triage("book", 2, 0.15, 0.7, "agent"), ...routed(AGENT.booking, "booking"), campaña: "Examen gratis con tus gafas" },
      lastMessageAt: hoursAgo(2), createdAt: daysAgo(1),
    },
    {
      id: "op-ct-04", name: "Julián Herrera", email: "julian.herrera@mock.test", phone: "+573005550104",
      channel: "form", source: "form:examen-visual", status: "followup_due",
      lastMessage: "Lo consulto con mi esposa y te confirmo la próxima semana.",
      attributes: triage("info", 1, 0.25, 0.45, "agent", 0.72),
      lastMessageAt: daysAgo(6), createdAt: daysAgo(19),
    },
    {
      id: "op-ct-05", name: "Valentina Ríos", email: "valentina.rios@mock.test", phone: "+573005550105",
      channel: "web", source: "web-chat", status: "open",
      lastMessage: "¿Tienen parqueadero o hay dónde dejar el carro cerca?",
      attributes: triage("info", 0, 0.05, 0.08, "agent"),
      lastMessageAt: hoursAgo(9), createdAt: daysAgo(8),
    },
    {
      id: "op-ct-06", name: "Mateo Castillo", email: "mateo.castillo@mock.test", phone: "+573005550106",
      channel: "instagram", source: "instagram", status: "waiting_human", sessionId: "op-chat-06",
      lastMessage: "Me cobraron dos veces el examen visual.",
      attributes: { ...triage("complaint", 3, 0.92, 0.05, "human", 0.96), ...routed(AGENT.support, "support") },
      notes: "Verificar cobro duplicado en el datáfono del 3 del mes.",
      lastMessageAt: hoursAgo(5), createdAt: daysAgo(40),
    },
    {
      id: "op-ct-07", name: "Sofía Medina", email: "sofia.medina@mock.test", phone: "+573005550107",
      channel: "whatsapp", source: "referido", status: "closed",
      lastMessage: "Gracias, quedaron perfectas después del ajuste.",
      attributes: triage("support", 0, 0.1, 0.1, "agent"),
      lastMessageAt: daysAgo(12), createdAt: daysAgo(75),
    },
    {
      id: "op-ct-08", name: "Colegio San Rafael", email: "rectoria@sanrafael.mock.test", phone: "+573005550108",
      channel: "web", source: "web-chat", status: "open", sessionId: "op-chat-05",
      lastMessage: "Necesitamos cotización de tamizaje visual para 120 estudiantes.",
      attributes: { ...triage("buy", 2, 0.4, 0.86, "agent"), ...routed(AGENT.sales, "sales"), segmento: "Convenios" },
      lastMessageAt: hoursAgo(27), createdAt: daysAgo(10),
    },
    {
      id: "op-ct-09", name: "Daniela Pardo", email: "daniela.pardo@mock.test", phone: "+573005550109",
      channel: "form", source: "form:examen-visual", status: "open",
      lastMessage: "Llené el formulario, ¿cuándo me llaman para la cita?",
      attributes: triage("book", 1, 0.3, 0.6, "agent"),
      lastMessageAt: hoursAgo(18), createdAt: daysAgo(2),
    },
    {
      id: "op-ct-10", name: "Transportes Andinos", email: "gestionhumana@andinos.mock.test", phone: "+573005550110",
      channel: "whatsapp", source: "whatsapp", status: "followup_due",
      lastMessage: "Pasamos la propuesta de salud visual a gerencia.",
      attributes: { ...triage("buy", 1, 0.35, 0.62, "agent", 0.69), segmento: "Convenios" },
      lastMessageAt: daysAgo(7), createdAt: daysAgo(34),
    },
    {
      id: "op-ct-11", name: "Felipe Vargas", email: "felipe.vargas@mock.test", phone: "+573005550111",
      channel: "whatsapp", source: "whatsapp", status: "open", sessionId: "op-chat-04",
      lastMessage: "¿Tienen Ray-Ban polarizadas en stock?",
      attributes: { ...triage("buy", 1, 0.08, 0.81, "agent"), ...routed(AGENT.sales, "sales") },
      lastMessageAt: hoursAgo(3), createdAt: hoursAgo(4),
    },
    {
      id: "op-ct-12", name: "Natalia Suárez", email: "natalia.suarez@mock.test", phone: "+573005550112",
      channel: "instagram", source: "instagram", status: "open", sessionId: "op-chat-07",
      lastMessage: "¿Puedo mover mi cita del jueves para el viernes?",
      attributes: { ...triage("book", 2, 0.2, 0.3, "agent"), ...routed(AGENT.booking, "booking") },
      lastMessageAt: hoursAgo(1), createdAt: daysAgo(15),
    },
  ];

  const deals: Deal[] = [
    { id: "op-dl-01", contactId: "op-ct-08", title: "Tamizaje visual · 120 estudiantes", value: 9_600_000, currency: "COP", stage: "negotiation", source: "web-chat", notes: "Piden descuento por volumen y jornada en el colegio.", createdAt: daysAgo(10), updatedAt: hoursAgo(27) },
    { id: "op-dl-02", contactId: "op-ct-02", title: "Progresivos con antirreflejo", value: 1_250_000, currency: "COP", stage: "proposal", source: "instagram", createdAt: daysAgo(2), updatedAt: minsAgo(38) },
    { id: "op-dl-03", contactId: "op-ct-10", title: "Convenio salud visual · conductores", value: 18_500_000, currency: "COP", stage: "proposal", source: "whatsapp", notes: "Depende del comité de gerencia.", createdAt: daysAgo(34), updatedAt: daysAgo(7) },
    { id: "op-dl-04", contactId: "op-ct-07", title: "Gafas formuladas + ajuste", value: 680_000, currency: "COP", stage: "won", source: "referido", closedAt: daysAgo(12), createdAt: daysAgo(75), updatedAt: daysAgo(12) },
    { id: "op-dl-05", contactId: "op-ct-04", title: "Lentes de contacto · 6 meses", value: 540_000, currency: "COP", stage: "lead", source: "form:examen-visual", createdAt: daysAgo(19), updatedAt: daysAgo(6) },
    { id: "op-dl-06", contactId: "op-ct-01", title: "Gafas formuladas", value: 820_000, currency: "COP", stage: "lost", source: "whatsapp", lostReason: "Pidió devolución por la fórmula equivocada.", closedAt: daysAgo(3), createdAt: daysAgo(31), updatedAt: daysAgo(3) },
    { id: "op-dl-07", contactId: "op-ct-11", title: "Ray-Ban polarizadas", value: 890_000, currency: "COP", stage: "qualified", source: "whatsapp", createdAt: hoursAgo(4), updatedAt: hoursAgo(3) },
    { id: "op-dl-08", contactId: "op-ct-03", title: "Examen visual + gafas", value: 430_000, currency: "COP", stage: "meeting", source: "meta_ads", createdAt: daysAgo(1), updatedAt: hoursAgo(2) },
  ];

  // Each transcript starts with the receptionist and moves to whichever agent
  // the conversation asked for — the rotation lib/agent-routing.ts performs,
  // recorded the way agent/hooks/persist.ts records it (agentName per turn).
  type Turn = { role: "user" | "assistant"; content: string; agentName?: string };
  const say = (content: string): Turn => ({ role: "user", content });
  const reply = (agentId: keyof typeof AGENT_NAME, content: string): Turn => ({ role: "assistant", content, agentName: AGENT_NAME[agentId] });

  const transcripts: { id: string; contactId: string; channel: ChannelId; lastAt: string; handoff?: boolean; pinned?: boolean; turns: Turn[] }[] = [
    {
      id: "op-chat-01", contactId: "op-ct-01", channel: "whatsapp", lastAt: minsAgo(14), handoff: true, pinned: true,
      turns: [
        say("Hola, buenas"),
        reply(AGENT.front, "¡Hola Laura! Bienvenida a Optimed. ¿En qué te puedo ayudar hoy?"),
        say("Recogí mis gafas y veo borroso, creo que la fórmula está mal"),
        reply(AGENT.support, "Qué pena contigo, Laura. Eso no debería pasar: revisemos la fórmula. ¿Me confirmas la fecha en que las recogiste?"),
        say("Hace dos semanas. Ya van dos semanas y las gafas llegaron con la fórmula equivocada."),
        reply(AGENT.support, "Entiendo tu molestia. Ya le pasé tu caso a una persona del equipo de optometría para que te llame hoy mismo y lo resolvamos con prioridad."),
      ],
    },
    {
      id: "op-chat-02", contactId: "op-ct-02", channel: "instagram", lastAt: minsAgo(38),
      turns: [
        say("Hola! vi su publicación de los progresivos"),
        reply(AGENT.front, "¡Hola Andrés! Qué bueno que nos escribes. ¿Ya tienes fórmula o necesitas el examen visual?"),
        say("Ya tengo fórmula. ¿Cuánto cuestan los progresivos con antirreflejo?"),
        reply(AGENT.sales, "Los progresivos con antirreflejo van desde $890.000 con la montura incluida en la línea básica, y desde $1.250.000 con montura de marca. Puedes pagar hasta en 3 cuotas sin interés. ¿Te muestro las monturas disponibles?"),
      ],
    },
    {
      id: "op-chat-03", contactId: "op-ct-03", channel: "whatsapp", lastAt: hoursAgo(2),
      turns: [
        say("Hola, vi el anuncio del examen gratis"),
        reply(AGENT.front, "¡Hola Camila! Sí: el examen visual es gratis si te haces las gafas con nosotros ese mismo mes. ¿Te gustaría agendarlo?"),
        say("Sí. Quiero agendar el examen visual para el sábado en la mañana."),
        reply(AGENT.booking, "¡Listo! Para este sábado tengo disponible a las 9:00, 10:00 y 11:30. El examen dura unos 30 minutos. ¿Cuál te queda mejor?"),
      ],
    },
    {
      id: "op-chat-04", contactId: "op-ct-11", channel: "whatsapp", lastAt: hoursAgo(3),
      turns: [
        say("Buenas tardes"),
        reply(AGENT.front, "¡Buenas tardes, Felipe! Soy la recepción de Optimed. ¿Qué estás buscando?"),
        say("¿Tienen Ray-Ban polarizadas en stock?"),
        reply(AGENT.sales, "Sí, tenemos Ray-Ban polarizadas en los modelos Aviator y Wayfarer, desde $890.000. Si las quieres con tu fórmula, el lente polarizado formulado se cotiza aparte. ¿Las buscas con o sin fórmula?"),
      ],
    },
    {
      id: "op-chat-05", contactId: "op-ct-08", channel: "web", lastAt: hoursAgo(27),
      turns: [
        say("Buen día, escribimos del Colegio San Rafael"),
        reply(AGENT.front, "¡Buen día! Con gusto los atendemos. ¿En qué les podemos ayudar?"),
        say("Necesitamos cotización de tamizaje visual para 120 estudiantes."),
        reply(AGENT.sales, "Para convenios desde 20 personas el tamizaje queda en $80.000 por persona e incluye el informe por estudiante. Para 120 estudiantes serían $9.600.000; podemos hacer la jornada en el colegio. ¿Les envío la propuesta formal?"),
      ],
    },
    {
      id: "op-chat-06", contactId: "op-ct-06", channel: "instagram", lastAt: hoursAgo(5), handoff: true,
      turns: [
        say("Me cobraron dos veces el examen visual."),
        reply(AGENT.support, "Lamento mucho el inconveniente, Mateo. Ya escalé el caso a una persona del equipo para revisar el cobro duplicado y hacerte la devolución. Te escribimos hoy con la respuesta."),
      ],
    },
    {
      id: "op-chat-07", contactId: "op-ct-12", channel: "instagram", lastAt: hoursAgo(1),
      turns: [
        say("Hola, tengo cita el jueves"),
        reply(AGENT.front, "¡Hola Natalia! Claro, cuéntame en qué te ayudo con tu cita."),
        say("¿Puedo mover mi cita del jueves para el viernes?"),
        reply(AGENT.booking, "¡Claro! El viernes tengo disponible a las 10:00 y a las 15:30. ¿Te muevo la cita a alguna de esas horas?"),
      ],
    },
  ];

  const nameOf = (contactId: string) => contacts.find((contact) => contact.id === contactId)?.name ?? "";

  const chats: ChatSummary[] = transcripts.map((chat) => {
    const last = chat.turns.at(-1)!;
    const lastUser = [...chat.turns].reverse().find((turn) => turn.role === "user");
    return {
      id: chat.id,
      sessionId: chat.id,
      title: nameOf(chat.contactId),
      channel: chat.channel,
      lastMessage: lastUser?.content ?? last.content,
      messageCount: chat.turns.length,
      lastMessageAt: chat.lastAt,
      agentName: last.agentName,
      ...(chat.handoff ? { handoff: true } : {}),
      ...(chat.pinned ? { pinned: true } : {}),
    };
  });

  const channelConversations: ChannelConversation[] = transcripts.map((chat, index) => ({
    id: `op-transcript-${index + 1}`,
    sessionId: chat.id,
    channel: chat.channel,
    contactId: chat.contactId,
    title: nameOf(chat.contactId),
    agentName: chat.turns.at(-1)?.agentName,
    turns: chat.turns,
    startedAt: iso(new Date(chat.lastAt).getTime() - 20 * 60_000),
    updatedAt: chat.lastAt,
  }));

  const reminders: Reminder[] = [
    { id: "op-rem-01", contact_id: "op-ct-01", message: "Llamar a Laura con la nueva fórmula antes de las 5 p. m.", datetime: daysAhead(0), status: "pending", created_at: hoursAgo(2) },
    { id: "op-rem-02", contact_id: "op-ct-08", message: "Enviar propuesta formal al Colegio San Rafael", datetime: daysAhead(1), status: "pending", created_at: hoursAgo(27) },
    { id: "op-rem-03", contact_id: "op-ct-10", message: "Preguntar a Transportes Andinos cómo salió el comité", datetime: daysAhead(3), status: "pending", created_at: daysAgo(7) },
    { id: "op-rem-04", contact_id: "op-ct-04", message: "Julián quedó de confirmar los lentes de contacto", datetime: daysAgo(1), status: "sent", created_at: daysAgo(6) },
  ];

  const agents: Agent[] = [
    {
      id: AGENT.front, name: "Recepción", iconKey: "receptionist", status: "active",
      description: "Abre cada conversación en WhatsApp e Instagram y la pasa al agente indicado",
      tools: ["knowledge", "contacts", "handoff"],
      systemPrompt: "Eres la recepción de Optimed, una clínica de optometría y óptica en Bogotá. Saludas con calidez y tuteas. Respondes horarios, ubicación y preguntas generales con el conocimiento del negocio, y tomas el nombre de la persona. No cotizas ni agendas: cuando alguien quiere comprar o pedir una cita, el agente de ese tema continúa la conversación.",
      createdAt: daysAgo(120),
    },
    {
      id: AGENT.sales, name: "Ventas", iconKey: "salesFollowUp", status: "active",
      description: "Cotiza gafas, lentes de contacto, gafas de sol y convenios",
      tools: ["knowledge", "contacts", "deals", "payments", "media"],
      specialties: ["sales"],
      systemPrompt: "Eres el asesor comercial de Optimed. Cotizas monturas, lentes formulados, progresivos, lentes de contacto, gafas de sol y convenios empresariales usando solo los precios del conocimiento del negocio: si un precio no está, lo dices y ofreces que un asesor confirme. Registras cada oportunidad en el embudo y, si la persona aún no tiene fórmula, le recomiendas el examen visual.",
      createdAt: daysAgo(120),
    },
    {
      id: AGENT.booking, name: "Citas", iconKey: "onboarding", status: "active",
      description: "Agenda, mueve y cancela exámenes visuales y controles",
      tools: ["knowledge", "contacts", "calendar", "reminders"],
      specialties: ["booking"],
      systemPrompt: "Llevas la agenda de Optimed. Agendas exámenes visuales (30 minutos), adaptaciones de lentes de contacto y controles dentro del horario de atención, propones dos o tres horarios concretos, confirmas nombre y teléfono, y dejas un recordatorio el día anterior. Para mover o cancelar una cita pides la fecha original. Nunca prometes un horario que el calendario no tiene libre.",
      createdAt: daysAgo(90),
    },
    {
      id: AGENT.support, name: "Postventa", iconKey: "support", status: "active",
      description: "Garantías, ajustes, reclamos y seguimiento después de la compra",
      tools: ["knowledge", "contacts", "handoff", "reminders"],
      specialties: ["support"],
      systemPrompt: "Atiendes la postventa de Optimed: ajustes de monturas, garantías, adaptación a progresivos y reclamos. Primero te disculpas y entiendes el caso; ante una fórmula equivocada, un cobro duplicado o un pedido de devolución, pasas la conversación a una persona del equipo y dejas el caso anotado en el contacto.",
      createdAt: daysAgo(60),
    },
  ];

  const forms: Form[] = [
    {
      id: "op-fm-01", name: "Agenda tu examen visual", slug: "examen-visual",
      description: "Cuéntanos qué necesitas y te llamamos para agendar.", status: "published",
      createdAt: daysAgo(30), updatedAt: daysAgo(2),
      scoring: { hot: 5, warm: 3 },
      steps: [
        { id: "op-st-01", title: "Tu visión", fields: [
          { id: "op-fd-motivo", type: "single_choice", label: "¿Qué te trae a Optimed?", required: true, choices: [
            { id: "op-ch-borroso", label: "Veo borroso o me duele la cabeza", points: 3 },
            { id: "op-ch-rutina", label: "Examen de rutina", points: 2 },
            { id: "op-ch-contacto", label: "Quiero lentes de contacto", points: 3 },
            { id: "op-ch-cotizar", label: "Solo quiero cotizar", points: 0 },
          ] },
          { id: "op-fd-cuando", type: "single_choice", label: "¿Para cuándo?", required: true, choices: [
            { id: "op-ch-semana", label: "Esta semana", points: 3 },
            { id: "op-ch-mes", label: "Este mes", points: 2 },
            { id: "op-ch-sinfecha", label: "Sin afán", points: 0 },
          ] },
        ] },
        { id: "op-st-02", title: "Tus datos", fields: [
          { id: "op-fd-nombre", type: "text", label: "Nombre", required: true },
          { id: "op-fd-tel", type: "phone", label: "Celular", required: true },
        ] },
      ],
    },
  ];

  const formResponses: FormResponse[] = [
    { id: "op-resp-01", formId: "op-fm-01", contactId: "op-ct-09", score: 6, temperature: "hot", partial: false, answers: [
      { fieldId: "op-fd-motivo", value: "op-ch-borroso" }, { fieldId: "op-fd-cuando", value: "op-ch-semana" },
      { fieldId: "op-fd-nombre", value: "Daniela Pardo" }, { fieldId: "op-fd-tel", value: "+573005550109" },
    ], startedAt: hoursAgo(19), updatedAt: hoursAgo(18) },
    { id: "op-resp-02", formId: "op-fm-01", contactId: "op-ct-04", score: 3, temperature: "warm", partial: false, answers: [
      { fieldId: "op-fd-motivo", value: "op-ch-contacto" }, { fieldId: "op-fd-cuando", value: "op-ch-sinfecha" },
      { fieldId: "op-fd-nombre", value: "Julián Herrera" }, { fieldId: "op-fd-tel", value: "+573005550104" },
    ], startedAt: daysAgo(19), updatedAt: daysAgo(19) },
    { id: "op-resp-03", formId: "op-fm-01", score: 0, temperature: "cold", partial: true, answers: [
      { fieldId: "op-fd-motivo", value: "op-ch-cotizar" },
    ], startedAt: daysAgo(5), updatedAt: daysAgo(5) },
  ];

  const knowledge = {
    name: "Optimed — servicios y precios.md",
    text: [
      "# Optimed — servicios, precios y políticas (datos de prueba)",
      "",
      "## Horarios y ubicación",
      "Lunes a viernes de 8:00 a. m. a 6:00 p. m. Sábados de 9:00 a. m. a 1:00 p. m. Domingos y festivos cerrado.",
      "Dirección de prueba: Calle 100 # 0-00, Bogotá. Hay parqueadero público a media cuadra.",
      "",
      "## Examen visual",
      "El examen visual completo dura unos 30 minutos y cuesta $60.000. Es gratis si te haces las gafas formuladas con nosotros el mismo mes.",
      "La adaptación de lentes de contacto cuesta $80.000 e incluye un control a los 15 días.",
      "",
      "## Gafas formuladas",
      "Monturas desde $180.000. Lentes monofocales con antirreflejo desde $250.000. Fotocromáticos: $180.000 adicionales.",
      "Progresivos con antirreflejo desde $890.000 con montura básica incluida y desde $1.250.000 con montura de marca.",
      "Entrega en 3 a 5 días hábiles; progresivos en 7 días hábiles.",
      "",
      "## Lentes de contacto y gafas de sol",
      "Lentes de contacto mensuales: caja por 6 unidades $120.000.",
      "Gafas de sol Ray-Ban y Oakley. Polarizadas desde $450.000; Ray-Ban polarizadas Aviator y Wayfarer desde $890.000.",
      "",
      "## Pagos",
      "Efectivo, tarjeta débito o crédito, Nequi y transferencia. Hasta 3 cuotas sin interés con tarjeta de crédito.",
      "",
      "## Garantías y postventa",
      "Garantía de 12 meses en monturas por defectos de fábrica. Ajustes y cambio de plaquetas sin costo durante el primer año.",
      "Progresivos: 30 días de adaptación; si no te adaptas, cambiamos el diseño del lente sin costo.",
      "Si la fórmula de tus gafas no corresponde a la del examen, rehacemos los lentes sin costo.",
      "",
      "## Citas",
      "Las citas se agendan por WhatsApp o Instagram. Para mover o cancelar una cita avisa con 24 horas de anticipación.",
      "",
      "## Convenios",
      "Empresas y colegios desde 20 personas: tamizaje visual a $80.000 por persona, con informe individual y jornada en sus instalaciones.",
    ].join("\n"),
  };

  const profile: BusinessProfile = {
    name: "Optimed",
    industry: "Salud visual",
    description: "Clínica de optometría y óptica en Bogotá: exámenes visuales, gafas formuladas, lentes de contacto y gafas de sol. Datos de prueba.",
    services: ["Examen visual", "Gafas formuladas", "Progresivos", "Lentes de contacto", "Gafas de sol", "Convenios empresariales"],
    location: "Calle 100 # 0-00, Bogotá (dirección de prueba)",
    hours: "Lunes a viernes 8:00–18:00 · Sábados 9:00–13:00",
    tone: "Cercano y profesional, tuteando",
    highlights: ["Examen gratis con tus gafas", "Entrega en 3 a 5 días hábiles", "Garantía de 12 meses en monturas"],
    faqs: [
      { question: "¿Cuánto cuesta el examen visual?", answer: "$60.000, y es gratis si te haces las gafas con nosotros el mismo mes." },
      { question: "¿Cuánto se demoran las gafas?", answer: "De 3 a 5 días hábiles; los progresivos, 7 días hábiles." },
    ],
  };

  const identity = {
    name: "Optimed",
    description: "Clínica de optometría y óptica. Datos de prueba.",
    email: "hola@optimed.test",
    phone: "+57 300 555 0100",
    address: "Calle 100 # 0-00, Bogotá (dirección de prueba)",
    hours: "Lunes a viernes 8:00–18:00 · Sábados 9:00–13:00",
    websiteUrl: "",
  };

  // Monday to Friday 8:00–18:00, Saturday 9:00–13:00, Bogotá time.
  const bookingPolicy: BookingPolicy = {
    timeZone: "America/Bogota",
    hours: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 18 * 60 })),
      { weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 },
    ],
  };

  const adGrade = (format: string, scores: Record<string, number>) => ({
    rubric: 1, gradedAt: daysAgo(3), model: "jev-1.13", sawImage: true, format, formatConfidence: 0.9,
    funnel: "conversion", funnelConfidence: 0.8,
    scores: { hook: 2, cta: 2, offer: 2, proof: 2, audience: 2, boldness: 2, claimRisk: 0.3, ...scores },
    overall: 0,
  });
  const weeklyAds: DemoWeeklyAd[] = [
    {
      adId: "op-ad-01", name: "Examen visual gratis con tus gafas", status: "ACTIVE",
      grade: adGrade("offer", { hook: 3.4, offer: 3.6, cta: 3.1 }),
      previous: { spend: 180_000, impressions: 14_200, clicks: 410, results: 22 },
      week: { spend: 205_000, impressions: 16_900, clicks: 520, results: 31 },
    },
    {
      adId: "op-ad-02", name: "Colección gafas de sol", status: "ACTIVE",
      grade: adGrade("catalog", { hook: 1.2, proof: 0.9, audience: 1.0 }),
      previous: { spend: 120_000, impressions: 11_000, clicks: 260, results: 6 },
      week: { spend: 150_000, impressions: 11_800, clicks: 95, results: 0 },
    },
    {
      adId: "op-ad-03", name: "Progresivos: adáptate o te devolvemos el dinero", status: "ACTIVE",
      grade: adGrade("offer", { claimRisk: 2.7, offer: 3 }),
      previous: { spend: 60_000, impressions: 4_100, clicks: 70, results: 3 },
      week: { spend: 70_000, impressions: 4_600, clicks: 82, results: 4 },
    },
  ];

  return {
    business: {
      contacts,
      deals,
      chats,
      reminders,
      agents,
      forms,
      formResponses,
      channelConversations,
      channelAgents: { web: AGENT.front, whatsapp: AGENT.front, instagram: AGENT.front },
    },
    knowledge,
    profile,
    identity,
    bookingPolicy,
    weeklyAds,
  };
}
