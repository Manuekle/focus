"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { AgentLoading } from "@/app/_components/chat/agent-loading";
import { ChartArtifact } from "@/app/_components/chat/artifacts/chart-artifact";
import { ReportArtifact } from "@/app/_components/chat/artifacts/report-artifact";
import { ConnectArtifact } from "@/app/_components/chat/artifacts/connect-artifact";
import { resolveConnectTarget, type ConnectState } from "@/lib/connect-targets";
import type { ChartSpec, ReportSpec } from "@/lib/artifacts";
import type { EveDynamicToolPart } from "eve/react";
import { InputRequestCard } from "@/app/_components/chat/input-request-card";
import { AgentProposalCard } from "@/app/_components/chat/agent-proposal-card";
import { AutomationProposalCard } from "@/app/_components/chat/automation-proposal-card";
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "@/components/agents/tool-result";

/**
 * Every shape the agent can draw in `/chat`, on one page.
 *
 * The artifacts only appear in the product at the end of a real turn: a model
 * call, a tool call, and whatever the model decided to pass. That is a slow and
 * non-deterministic way to find out that a pie with seven slices overflows its
 * legend, or that a two-series bar chart is unreadable in dark mode — and it
 * costs a model call per look.
 *
 * So this renders the same components against fixtures that deliberately
 * include the awkward cases: negative values, a long category label, twenty-six
 * buckets on an axis with room for nine, four series at once, a Mermaid diagram
 * the fallback renderer has to catch. Flip the theme with the app's own toggle
 * and both palettes are checkable side by side.
 *
 * Dev only — /dev 404s in production (see `app/dev/layout.tsx`).
 */

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep"];

const SALES: ChartSpec = {
  currency: "ARS",
  format: "currency",
  kind: "column",
  note: "Marzo y julio concentran el 41 % del año. Los dos coinciden con campañas de Meta activas.",
  series: [
    {
      name: "Ganado",
      points: MONTHS.map((label, index) => ({
        label,
        value: [820_000, 640_000, 1_480_000, 910_000, 760_000, 1_020_000, 1_390_000, 540_000, 980_000][
          index
        ]!,
      })),
    },
  ],
  subtitle: "Enero–Septiembre 2026 · deals en estado ganado",
  title: "Ventas cerradas por mes",
};

const TREND: ChartSpec = {
  format: "number",
  kind: "line",
  note: "Los perdidos crecen desde mayo sin que caigan los abiertos: el cuello está en propuesta, no en generación.",
  series: [
    { name: "Abiertos", points: MONTHS.map((label, i) => ({ label, value: [12, 15, 19, 17, 22, 25, 24, 21, 26][i]! })) },
    { name: "Ganados", points: MONTHS.map((label, i) => ({ label, value: [4, 3, 8, 6, 5, 7, 9, 3, 6][i]! })) },
    { name: "Perdidos", points: MONTHS.map((label, i) => ({ label, value: [2, 4, 3, 5, 8, 9, 7, 10, 11][i]! })) },
  ],
  subtitle: "Conteo de deals por mes",
  title: "Movimiento del pipeline",
};

const SOURCES: ChartSpec = {
  format: "number",
  kind: "bar",
  note: "Instagram trae volumen y WhatsApp trae cierre — no son el mismo lead.",
  series: [
    {
      name: "Leads",
      points: [
        { label: "Instagram DM", value: 148 },
        { label: "WhatsApp", value: 96 },
        { label: "Formulario de presupuesto del sitio", value: 61 },
        { label: "Meta Ads — remarketing", value: 44 },
        { label: "Referidos", value: 12 },
      ],
    },
  ],
  subtitle: "Últimos 90 días",
  title: "De dónde vienen los leads",
};

const SHARE: ChartSpec = {
  currency: "USD",
  format: "currency",
  kind: "donut",
  series: [
    {
      name: "Ganado",
      points: [
        { label: "Instalación", value: 42_000 },
        { label: "Mantenimiento", value: 28_500 },
        { label: "Repuestos", value: 12_300 },
        { label: "Consultoría", value: 8_100 },
        { label: "Capacitación", value: 3_400 },
        { label: "Otros servicios", value: 2_200 },
        { label: "Envíos", value: 900 },
      ],
    },
  ],
  subtitle: "Facturado en el trimestre",
  title: "Mezcla de ingresos",
};

/** The awkward cases: values below zero, and an axis with more buckets than labels. */
const MARGIN: ChartSpec = {
  format: "percent",
  kind: "area",
  note: "Dos semanas en rojo en agosto — descuentos de liquidación aplicados por debajo del costo.",
  series: [
    {
      name: "Margen",
      points: Array.from({ length: 26 }, (_, index) => ({
        label: `S${index + 1}`,
        value: Math.round((Math.sin(index / 2.6) * 18 + 9) * 10) / 10,
      })),
    },
  ],
  subtitle: "26 semanas · el eje tiene lugar para nueve etiquetas",
  title: "Margen semanal",
};

const FOUR: ChartSpec = {
  format: "compact",
  kind: "column",
  series: [
    { name: "Instagram", points: MONTHS.slice(0, 6).map((label, i) => ({ label, value: [120, 145, 160, 138, 172, 190][i]! })) },
    { name: "WhatsApp", points: MONTHS.slice(0, 6).map((label, i) => ({ label, value: [98, 104, 88, 121, 133, 118][i]! })) },
    { name: "Web", points: MONTHS.slice(0, 6).map((label, i) => ({ label, value: [45, 52, 61, 49, 58, 72][i]! })) },
    { name: "Email", points: MONTHS.slice(0, 6).map((label, i) => ({ label, value: [22, 19, 28, 31, 24, 27][i]! })) },
  ],
  subtitle: "El techo de series — cuatro slots, legenda obligatoria",
  title: "Mensajes por canal",
};

const REPORT: ReportSpec = {
  footnote:
    "Fuente: pipeline (deals cerrados), marketing (campañas de Meta) e inbox (conversaciones clasificadas). Excluye deals sin moneda declarada.",
  kpis: [
    { label: "Facturado", tone: "positive", value: "$8,54 M", delta: "+18 % vs 2025" },
    { label: "Deals ganados", value: "51", delta: "+7" },
    { label: "Tasa de cierre", tone: "warning", value: "34 %", delta: "-6 pts" },
    { label: "Ticket promedio", value: "$167 K", delta: "+11 %" },
    { label: "Días a cierre", tone: "critical", value: "38", delta: "+9" },
    { label: "Costo por lead", value: "$4.120", delta: "-3 %" },
  ],
  period: "Enero–Septiembre 2026",
  sections: [
    {
      body:
        "El año viene **18 % arriba** del anterior en facturación, con menos deals de los que ese número sugiere: el crecimiento es de ticket, no de volumen.\n\n- Marzo y julio explican el 41 % del total\n- Los dos meses coinciden con campañas de remarketing activas\n- Agosto cayó a menos de la mitad del promedio",
      chart: SALES,
      heading: "Ventas por mes",
    },
    {
      body: "La generación de leads no bajó. Lo que empeoró es la conversión de propuesta a cierre.",
      chart: TREND,
      heading: "Dónde se pierde el pipeline",
      table: {
        columns: ["Etapa", "Entraron", "Salieron", "Conversión"],
        rows: [
          ["Lead", "418", "301", "72 %"],
          ["Calificado", "301", "184", "61 %"],
          ["Reunión", "184", "112", "61 %"],
          ["Propuesta", "112", "51", "46 %"],
          ["Negociación", "51", "51", "100 %"],
        ],
      },
    },
    {
      body: "Instagram trae el volumen; WhatsApp trae el cierre. Tratarlos igual es lo que está inflando el costo por venta.",
      chart: SOURCES,
      heading: "Origen de los leads",
    },
  ],
  subtitle: "Cierre de los primeros tres trimestres",
  summary:
    "**El año está 18 % arriba en facturación y 6 puntos abajo en tasa de cierre.** Se vende más caro y se cierra peor: el ticket promedio subió 11 % mientras el ciclo se estiró nueve días. El cuello está en la etapa de propuesta, donde se pierde el 54 % de lo que entra.\n\nLa recomendación es acortar la propuesta, no generar más leads.",
  title: "Informe comercial 2026",
};

const DIAGRAM = `Así queda el flujo de calificación que propusimos:

\`\`\`mermaid
flowchart LR
  A[Mensaje entrante] --> B{¿Ya es contacto?}
  B -->|Sí| C[Cargar historial]
  B -->|No| D[Crear contacto]
  C --> E{¿Pide precio?}
  D --> E
  E -->|Sí| F[Buscar en catálogo]
  E -->|No| G[Responder y calificar]
  F --> H[Abrir deal]
  G --> H
  H --> I{¿Pide humano?}
  I -->|Sí| J[Transferir]
  I -->|No| K[Agendar seguimiento]
\`\`\`

Y el estado en que queda cada conversación:

\`\`\`mermaid
stateDiagram-v2
  [*] --> Nuevo
  Nuevo --> Calificado
  Calificado --> Propuesta
  Propuesta --> Ganado
  Propuesta --> Perdido
  Ganado --> [*]
  Perdido --> [*]
\`\`\`
`;

/**
 * One artifact at a time, picked by the hash — `/dev/artifacts#donut`.
 *
 * A single page holding all eight would be the nicer contact sheet, and it is
 * not what these need: a chart is judged at the width it will actually be read
 * at, and stacking eight of them means judging most of them halfway down a
 * scroll, at whatever size is left. Same reason `/dev/screens` shows one
 * landing mockup at a time.
 *
 * The hash rather than component state so a particular case is a link somebody
 * can paste into a bug report, and so a reload comes back to the one being
 * looked at.
 */
const VIEWS: readonly (readonly [
  string,
  string,
  "agent" | "automation" | "chart" | "connect" | "connecting" | "mermaid" | "question" | "report" | "restoring" | "tools",
  ChartSpec | null,
])[] =
  [
    ["column", "Columnas · una serie", "chart", SALES],
    ["line", "Líneas · tres series", "chart", TREND],
    ["bar", "Barras rankeadas · etiquetas largas", "chart", SOURCES],
    ["donut", "Dona · siete categorías, la cola se pliega", "chart", SHARE],
    ["area", "Área · valores negativos, 26 buckets", "chart", MARGIN],
    ["grouped", "Columnas agrupadas · cuatro series", "chart", FOUR],
    ["report", "Informe con descarga en PDF", "report", null],
    ["mermaid", "Diagramas en el texto de la respuesta", "mermaid", null],
    ["agent", "Plano de agente · aceptar, pedir cambios o descartar", "agent", null],
    ["automation", "Plano de automatización · aceptar, pedir cambios o descartar", "automation", null],
    ["question", "Preguntas y aprobaciones · todas las fases", "question", null],
    ["tools", "Llamadas a herramientas · los cuatro estados", "tools", null],
    ["connect", "Tarjeta de conexión · los cuatro estados", "connect", null],
    ["restoring", "Pantalla de carga · recuperando una conversación", "restoring", null],
    ["connecting", "Pantalla de carga · primera conexión", "connecting", null],
  ];

export default function Page() {
  const [active, setActive] = useState(VIEWS[0]![0]);

  useEffect(() => {
    const read = () => setActive(window.location.hash.slice(1) || VIEWS[0]![0]);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const view = VIEWS.find(([id]) => id === active) ?? VIEWS[0]!;
  const [, title, kind, spec] = view;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      <header className="space-y-2">
        <h1 className="font-medium text-foreground text-xl">Artefactos del chat</h1>
        <p className="text-muted-foreground text-sm">
          Lo que <code className="rounded bg-muted px-1 py-0.5 text-xs">chart</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">report</code> y los bloques{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">mermaid</code> dibujan en /chat.
          Cambiá el tema desde la app para revisar las dos paletas.
        </p>
        <nav className="flex flex-wrap gap-1.5 pt-1">
          {VIEWS.map(([id]) => (
            <a
              className={
                id === view[0]
                  ? "rounded-md border border-input bg-accent px-2 py-1 text-foreground text-xs"
                  : "rounded-md border border-border px-2 py-1 text-muted-foreground text-xs transition-colors hover:border-input hover:text-foreground"
              }
              href={`#${id}`}
              key={id}
            >
              {id}
            </a>
          ))}
        </nav>
      </header>

      <h2 className="font-medium text-foreground text-sm">{title}</h2>
      {kind === "chart" && spec ? <ChartArtifact spec={spec} /> : null}
      {kind === "report" ? <ReportArtifact spec={REPORT} /> : null}
      {kind === "agent" ? <AgentProposals /> : null}
      {kind === "automation" ? <AutomationProposals /> : null}
      {kind === "question" ? <QuestionPhases /> : null}
      {kind === "tools" ? <ToolStates /> : null}
      {kind === "connect" ? <ConnectCards /> : null}
      {kind === "mermaid" ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <MessageResponse>{DIAGRAM}</MessageResponse>
        </div>
      ) : null}
      {/* The scene fills the viewport in the product; here it is cropped so
          the nav above it stays reachable. No frame around it — the scene has
          no edge of its own any more, and a border here would put back the
          box it was redrawn to lose. The hint line appears on its own timer,
          so leave the tab open a few seconds to see the slow state. */}
      {kind === "restoring" || kind === "connecting" ? (
        <div
          className="overflow-hidden rounded-xl"
          style={{ "--stage-height": "30rem" } as React.CSSProperties}
        >
          <AgentLoading mode={kind} />
        </div>
      ) : null}
    </main>
  );
}

// ── Questions and approvals ────────────────────────────────────────

const QUESTION_OPTIONS = [
  { id: "full", label: "Auditoría completa (técnica + contenido + keywords)" },
  { id: "gsc", label: "Solo datos de Search Console", description: "Clics, impresiones y posiciones" },
  { id: "page", label: "Solo la home" },
];

function questionPart(
  state: EveDynamicToolPart["state"],
  extra: Partial<{ allowFreeform: boolean; approval: boolean; response: { optionId?: string; text?: string } }> = {},
): EveDynamicToolPart {
  const approval = extra.approval === true;
  return {
    type: "dynamic-tool",
    toolCallId: `call-${state}-${approval ? "a" : "q"}`,
    toolName: approval ? "send_payment_link" : "ask_question",
    stepIndex: 1,
    state,
    input: approval ? { amount: 45000, currency: "ARS", description: "Plan trimestral" } : { prompt: "" },
    approval: { id: "req", ...(state === "output-denied" ? { approved: false } : {}) },
    ...(state === "output-available" ? { output: { ok: true, url: "https://mpago.la/x" } } : {}),
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: approval ? "send_payment_link" : "ask_question",
        inputRequest: approval
          ? {
              requestId: "req",
              prompt: "¿Genero el link de pago por $45.000 para Marta?",
              options: [
                { id: "approve", label: "Approve" },
                { id: "deny", label: "Deny" },
              ],
            }
          : {
              requestId: "req",
              prompt: "¿Qué tipo de informe SEO querés para gymratplus.com?",
              options: QUESTION_OPTIONS,
              allowFreeform: extra.allowFreeform ?? true,
            },
        ...(extra.response ? { inputResponse: { requestId: "req", ...extra.response } } : {}),
      },
    },
  } as EveDynamicToolPart;
}

function QuestionPhases() {
  const [answer, setAnswer] = useState<{ optionId?: string; text?: string }>();
  const noop = () => {};
  const rows: readonly [string, React.ReactNode][] = [
    [
      "Interactiva · elegí una opción (pasa a enviando)",
      <InputRequestCard
        answer={answer}
        canRespond
        key="live"
        movedOn={false}
        onInputResponses={(responses) => setAnswer({ optionId: responses[0]?.optionId, text: responses[0]?.text })}
        part={questionPart(answer ? "approval-responded" : "approval-requested")}
        toolLabel="ask_question"
      />,
    ],
    [
      "Respondida · la conversación siguió",
      <InputRequestCard answer={{ optionId: "gsc" }} canRespond key="answered" movedOn onInputResponses={noop} part={questionPart("approval-responded")} toolLabel="ask_question" />,
    ],
    [
      "Respondida con texto libre",
      <InputRequestCard answer={{ text: "Las dos cosas, pero empezá por keywords" }} canRespond key="text" movedOn onInputResponses={noop} part={questionPart("approval-responded")} toolLabel="ask_question" />,
    ],
    [
      "Cerrada · recargada sin respuesta registrada (el bug original)",
      <InputRequestCard answer={undefined} canRespond key="closed" movedOn onInputResponses={noop} part={questionPart("approval-requested")} toolLabel="ask_question" />,
    ],
    [
      "Aprobación pendiente",
      <InputRequestCard answer={undefined} canRespond key="approval" movedOn={false} onInputResponses={noop} part={questionPart("approval-requested", { approval: true })} toolLabel="send_payment_link" />,
    ],
    [
      "Aprobación aprobada y ejecutada",
      <InputRequestCard answer={{ optionId: "approve" }} canRespond key="approved" movedOn onInputResponses={noop} part={questionPart("output-available", { approval: true })} toolLabel="send_payment_link" />,
    ],
    [
      "Aprobación rechazada",
      <InputRequestCard answer={{ optionId: "deny" }} canRespond key="denied" movedOn onInputResponses={noop} part={questionPart("output-denied", { approval: true })} toolLabel="send_payment_link" />,
    ],
  ];
  return (
    <div className="space-y-6">
      {rows.map(([label, node]) => (
        <div className="space-y-1.5" key={label}>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
          {node}
        </div>
      ))}
    </div>
  );
}

// ── Agent proposals ────────────────────────────────────────────────

const RECEPTIONIST = {
  name: "Recepcionista telefónica",
  description: "Atiende las llamadas de la clínica, agenda turnos y deriva urgencias.",
  role: "Recepcionista de Clínica Sonrisa: atiende llamadas, responde dudas frecuentes y agenda turnos.",
  goal: "Que cada llamada termine con un turno agendado o la duda resuelta.",
  audience: "Pacientes nuevos y actuales que llaman por teléfono.",
  tone: "Cálido, claro y paciente; frases cortas.",
  language: "es",
  greeting: "",
  rules: [
    "Confirmá nombre, teléfono y motivo antes de agendar.",
    "Ofrecé como mucho dos horarios por vez.",
    "Repetí fecha y hora al confirmar el turno.",
  ],
  avoid: ["No des diagnósticos ni indicaciones médicas.", "No confirmes precios que no estén en el conocimiento."],
  handoff: "Si el paciente describe dolor fuerte, sangrado o una urgencia, o pide hablar con el odontólogo.",
  capabilities: ["handoff", "calendar", "contacts", "knowledge", "reminders"],
  channels: ["voice", "whatsapp"],
  voice: { firstMessage: "Hola, gracias por llamar a Clínica Sonrisa. ¿En qué te puedo ayudar?" },
  iconKey: "receptionist",
  notes: [
    "Le di Agenda y Recordatorios porque el trabajo termina en un turno, y un turno sin recordatorio se pierde.",
    "Las urgencias van a una persona: un agente no debería decidir qué es grave.",
    "En teléfono ofrece dos horarios por vez; una lista larga no se puede escuchar.",
  ],
  step: { index: 1, total: 2 },
};

const SALES_CHAT = {
  name: "Asesor de ventas web",
  description: "Responde consultas del sitio y califica a quién vale la pena llamar.",
  role: "Asesor comercial que responde consultas en el chat del sitio.",
  goal: "Entender qué necesita y dejar un contacto calificado con su presupuesto.",
  audience: "",
  tone: "Directo y amable",
  language: "auto",
  greeting: "¡Hola! ¿Buscás algo en particular?",
  rules: ["Preguntá el presupuesto antes de recomendar un plan."],
  avoid: [],
  handoff: "Cuando pide una cotización a medida o un descuento.",
  capabilities: ["contacts", "deals", "knowledge"],
  channels: ["web", "instagram"],
  iconKey: "leadQualifier",
  notes: [],
};

function proposalPart(
  id: string,
  input: Record<string, unknown>,
  state: EveDynamicToolPart["state"],
): EveDynamicToolPart {
  return {
    type: "dynamic-tool",
    toolCallId: `proposal-${id}`,
    toolName: "propose_agent",
    stepIndex: 1,
    state,
    input,
    approval: { id: `req-${id}`, ...(state === "output-denied" ? { approved: false } : {}) },
    ...(state === "output-available"
      ? {
          output: {
            id: `agent_${id}`,
            name: input.name,
            status: "draft",
            href: `/agents/agent_${id}`,
            channels: input.channels,
            voice: Array.isArray(input.channels) && input.channels.includes("voice"),
          },
        }
      : {}),
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: "propose_agent",
        inputRequest: {
          requestId: `req-${id}`,
          prompt: "Approve propose_agent?",
          options: [
            { id: "approve", label: "Approve" },
            { id: "deny", label: "Deny" },
          ],
        },
      },
    },
  } as EveDynamicToolPart;
}

/**
 * The live one walks the whole path with a fake build: drawn, decided, built
 * (or set aside). Reset to watch the drawing again; the OS reduced-motion
 * setting should make it appear whole.
 */
function AgentProposals() {
  const [run, setRun] = useState(0);
  const [answer, setAnswer] = useState<{ optionId?: string; text?: string }>();
  const [state, setState] = useState<EveDynamicToolPart["state"]>("approval-requested");
  const [sent, setSent] = useState<string>();
  const noop = () => {};

  useEffect(() => {
    if (answer?.optionId !== "approve") return;
    const timer = window.setTimeout(() => setState("output-available"), 1800);
    return () => window.clearTimeout(timer);
  }, [answer]);

  const reset = () => {
    setAnswer(undefined);
    setState("approval-requested");
    setSent(undefined);
    setRun((value) => value + 1);
  };

  const rows: readonly [string, React.ReactNode][] = [
    [
      "Interactiva · agente de voz, lámina 1 de 2",
      <div className="space-y-2" key={`live-${run}`}>
        <AgentProposalCard
          answer={answer}
          canRespond
          movedOn={false}
          onInputResponses={(responses, message) => {
            setAnswer({ optionId: responses[0]?.optionId, text: responses[0]?.text });
            setState(responses[0]?.optionId === "approve" ? "approval-responded" : "output-denied");
            setSent(message);
          }}
          part={proposalPart("live", RECEPTIONIST, state)}
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <button className="rounded-md border border-border px-2 py-1 hover:text-foreground" onClick={reset} type="button">
            Reiniciar
          </button>
          {sent ? <span>Mensaje enviado al agente: «{sent}»</span> : null}
        </div>
      </div>,
    ],
    [
      "Construido · leído del historial",
      <AgentProposalCard answer={{ optionId: "approve" }} canRespond key="built" movedOn onInputResponses={noop} part={proposalPart("built", SALES_CHAT, "output-available")} />,
    ],
    [
      "Pidió cambios",
      <AgentProposalCard answer={{ optionId: "deny", text: "Que también atienda por WhatsApp y sea más formal" }} canRespond key="changes" movedOn onInputResponses={noop} part={proposalPart("changes", SALES_CHAT, "output-denied")} />,
    ],
    [
      "Sin decisión · la conversación siguió",
      <AgentProposalCard answer={undefined} canRespond key="closed" movedOn onInputResponses={noop} part={proposalPart("closed", SALES_CHAT, "approval-requested")} />,
    ],
  ];
  return (
    <div className="space-y-8">
      {rows.map(([label, node]) => (
        <div className="space-y-1.5" key={label}>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
          {node}
        </div>
      ))}
    </div>
  );
}

// ── Automation proposals ───────────────────────────────────────────

const FOLLOW_UP = {
  name: "Seguimiento de presupuesto",
  description: "Si alguien pide precio y no responde, le escribe al día siguiente y avisa a ventas si sigue interesado.",
  trigger: "keyword",
  triggerValue: "precio, presupuesto, cuánto sale",
  channel: "whatsapp",
  steps: [
    { type: "ai_response", prompt: "Respondé con la lista de precios del conocimiento y preguntá para cuántas personas es." },
    { type: "wait", duration: "1d" },
    {
      type: "condition",
      condition: "¿El contacto respondió con interés?",
      thenSteps: [
        { type: "update_contact", contactStatus: "followup_due", contactNote: "Interesado en presupuesto" },
        { type: "notify_whatsapp", phone: "+5491155550000", message: "Nuevo interesado en presupuesto: {{contact.name}}" },
      ],
      elseSteps: [
        { type: "message", message: "¡Hola! ¿Pudiste ver los precios? Si querés te armo un presupuesto a medida." },
      ],
    },
  ],
};

const WEEKLY_REMINDER = {
  name: "Recordatorio de los lunes",
  description: "Avisa al equipo de guardia cada semana.",
  trigger: "schedule",
  triggerValue: "0 8 * * 1-5",
  channel: "all",
  steps: [{ type: "notify_team", service: "slack", message: "Buen día: revisen los chats que quedaron sin respuesta." }],
};

function automationPart(
  id: string,
  input: Record<string, unknown>,
  state: EveDynamicToolPart["state"],
): EveDynamicToolPart {
  return {
    type: "dynamic-tool",
    toolCallId: `automation-${id}`,
    toolName: "propose_automation",
    stepIndex: 1,
    state,
    input,
    approval: { id: `req-${id}`, ...(state === "output-denied" ? { approved: false } : {}) },
    ...(state === "output-available"
      ? { output: { id: `auto_${id}`, name: input.name, status: "draft", href: `/automations/auto_${id}` } }
      : {}),
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: "propose_automation",
        inputRequest: {
          requestId: `req-${id}`,
          prompt: "Approve propose_automation?",
          options: [
            { id: "approve", label: "Approve" },
            { id: "deny", label: "Deny" },
          ],
        },
      },
    },
  } as EveDynamicToolPart;
}

/** Same path as the agent blueprint: drawn, decided, built or set aside. */
function AutomationProposals() {
  const [run, setRun] = useState(0);
  const [answer, setAnswer] = useState<{ optionId?: string; text?: string }>();
  const [state, setState] = useState<EveDynamicToolPart["state"]>("approval-requested");
  const [sent, setSent] = useState<string>();
  const noop = () => {};

  useEffect(() => {
    if (answer?.optionId !== "approve") return;
    const timer = window.setTimeout(() => setState("output-available"), 1500);
    return () => window.clearTimeout(timer);
  }, [answer]);

  const reset = () => {
    setAnswer(undefined);
    setState("approval-requested");
    setSent(undefined);
    setRun((value) => value + 1);
  };

  const rows: readonly [string, React.ReactNode][] = [
    [
      "Interactiva · palabra clave con una condición",
      <div className="space-y-2" key={`live-${run}`}>
        <AutomationProposalCard
          answer={answer}
          canRespond
          movedOn={false}
          onInputResponses={(responses, message) => {
            setAnswer({ optionId: responses[0]?.optionId, text: responses[0]?.text });
            setState(responses[0]?.optionId === "approve" ? "approval-responded" : "output-denied");
            setSent(message);
          }}
          part={automationPart("live", FOLLOW_UP, state)}
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <button className="rounded-md border border-border px-2 py-1 hover:text-foreground" onClick={reset} type="button">
            Reiniciar
          </button>
          {sent ? <span>Mensaje enviado al agente: «{sent}»</span> : null}
        </div>
      </div>,
    ],
    [
      "Construida · programada, leída del historial",
      <AutomationProposalCard answer={{ optionId: "approve" }} canRespond key="built" movedOn onInputResponses={noop} part={automationPart("built", WEEKLY_REMINDER, "output-available")} />,
    ],
    [
      "Pidió cambios",
      <AutomationProposalCard answer={{ optionId: "deny", text: "Que mande el recordatorio a las 9 y solo los lunes" }} canRespond key="changes" movedOn onInputResponses={noop} part={automationPart("changes", WEEKLY_REMINDER, "output-denied")} />,
    ],
    [
      "Descartada · webhook sin pasos",
      <AutomationProposalCard answer={{ optionId: "deny" }} canRespond key="declined" movedOn onInputResponses={noop} part={automationPart("declined", { name: "Leads del formulario externo", trigger: "webhook", channel: "all", steps: [] }, "output-denied")} />,
    ],
    [
      "Sin decisión · sin respuesta en 30 minutos",
      <AutomationProposalCard answer={undefined} canRespond key="closed" movedOn onInputResponses={noop} part={automationPart("closed", { name: "Rescate de chats", trigger: "no_reply", triggerValue: "30min", channel: "instagram", steps: [{ type: "transfer_human", message: "Te paso con alguien del equipo." }] }, "approval-requested")} />,
    ],
  ];
  return (
    <div className="space-y-8">
      {rows.map(([label, node]) => (
        <div className="space-y-1.5" key={label}>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
          {node}
        </div>
      ))}
    </div>
  );
}

// ── Tool calls ─────────────────────────────────────────────────────

const TOOL_OUTPUT = JSON.stringify(
  {
    ok: true,
    contact: { id: "c_8f21", name: "Marta Iglesias", phone: "+54 9 11 5555 0134" },
    updated: ["stage", "owner"],
  },
  null,
  2,
);

/**
 * The disclosure every tool that is not a chart, a report or a question draws
 * as. Four states, open, so the frame can be judged with something in it — in
 * the product a finished call collapses to the trigger row on its own.
 */
function ToolStates() {
  const rows: readonly [string, ToolResultStatus, string][] = [
    ["Ejecutando", "running", ""],
    ["Terminada", "success", TOOL_OUTPUT],
    ["Fallida", "error", 'Error: contact "c_8f21" is owned by another workspace'],
    ["Cancelada", "cancelled", ""],
  ];
  return (
    <div className="space-y-4">
      {rows.map(([label, status, output]) => (
        <div className="space-y-1.5" key={label}>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
          <ToolResult
            collapseOnComplete={false}
            copyText={output || undefined}
            defaultOpen={Boolean(output)}
            kind="terminal"
            status={status}
            title={label}
            tool="upsert_contact"
          >
            {output ? <ToolResultOutput language="json">{output}</ToolResultOutput> : null}
          </ToolResult>
        </div>
      ))}
    </div>
  );
}


// ── Connection cards ───────────────────────────────────────────────

/**
 * What `request_connection` puts in the transcript, in the states a real
 * install makes hard to see together.
 *
 * `blocked` only happens on a self-host that never registered the provider's
 * OAuth app, `needs_reconnect` only after a grant is revoked, and a mixed card
 * needs one of each at once — reproducing any of them for real means editing
 * the credential store. The resolver is the product's own, so these are the
 * rows the tool would actually return.
 */
const CONNECT_FIXTURE: ConnectState = {
  oauth: new Map([
    ["google", "ready"],
    ["notion", "missing"],
    ["salesforce", "needs_reconnect"],
    ["slack", "blocked"],
  ]),
  manual: new Map([["stripe", true]]),
  channels: { whatsapp: false, instagram: false },
  bookingHours: false,
  mcpServers: 0,
};

function ConnectCards() {
  return (
    <div className="space-y-6">
      <Fixture caption="Lo que rompió la reserva: no es un conector, son los horarios.">
        <ConnectArtifact
          reason="No pude agendarlo: todavía no hay horarios de atención cargados."
          targets={[resolveConnectTarget("booking_hours", CONNECT_FIXTURE)]}
        />
      </Fixture>

      <Fixture caption="Varias filas, una ya conectada. Cuatro es el máximo que acepta la herramienta.">
        <ConnectArtifact
          reason="Para escribirles a tus clientes que compraron más de 5 veces necesito de dónde leer las compras y por dónde mandar el mensaje."
          targets={[
            resolveConnectTarget("shopify", CONNECT_FIXTURE),
            resolveConnectTarget("whatsapp", CONNECT_FIXTURE),
            resolveConnectTarget("resend", CONNECT_FIXTURE),
            resolveConnectTarget("stripe", CONNECT_FIXTURE),
          ]}
        />
      </Fixture>

      <Fixture caption="Token vencido y proveedor sin app OAuth registrada: ninguno dice “Conectar”.">
        <ConnectArtifact
          reason="Perdí el acceso a un par de cuentas."
          targets={[
            resolveConnectTarget("salesforce", CONNECT_FIXTURE),
            resolveConnectTarget("slack", CONNECT_FIXTURE),
          ]}
        />
      </Fixture>

      <Fixture caption="Sin `reason`: la tarjeta sigue siendo legible.">
        <ConnectArtifact targets={[resolveConnectTarget("mercadopago", CONNECT_FIXTURE)]} />
      </Fixture>
    </div>
  );
}

function Fixture({ caption, children }: { readonly caption: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-muted-foreground text-xs">{caption}</p>
      {children}
    </section>
  );
}
