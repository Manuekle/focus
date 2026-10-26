"use client";

import { SiteQuestionsPanel, type SiteQuestionsReply } from "@/app/(app)/seo/_components/site-questions";
import {
  extractQuestions,
  questionsReading,
  type QuestionMatch,
  type QuestionTopic,
  type SitePage,
} from "@/lib/site-questions-policy";

/**
 * Development-only fixture for SEO → Preguntas. The panel talks to
 * /api/seo/questions; here it answers from the conversations below, run
 * through the same extraction and reading the server uses, so the tab can be
 * looked at without an inbox, a site or a TypeSafe key. `?mode=` picks the
 * state. /dev 404s in production.
 */

const PAGES: SitePage[] = [
  { path: "/", title: "Dulce Horno — Tortas por encargo", heading: "Tortas por encargo en Bogotá", description: "", headings: [], excerpt: "" },
  { path: "/tortas", title: "Nuestras tortas", heading: "Tortas", description: "", headings: ["Precios", "Sabores"], excerpt: "" },
  { path: "/contacto", title: "Contacto", heading: "Dónde estamos", description: "", headings: ["Horarios"], excerpt: "" },
];

/** What each customer wrote — several asking the same thing in their own words. */
const MESSAGES: ReadonlyArray<readonly string[]> = [
  ["Hola! ¿Hacen envíos a Chía?", "¿Cuánto cuesta la torta de chocolate para 20 personas?"],
  ["Buenas tardes, hacen envios a chia?", "¿Aceptan pago con Nequi?"],
  ["¿Hacen envíos a Chía?", "¿Con cuántos días de anticipación hay que pedir?"],
  ["¿Tienen tortas sin gluten?", "¿Cuánto cuesta la torta de chocolate para 20 personas?"],
  ["¿Aceptan pago con Nequi?", "¿A qué hora abren el sábado?"],
  ["¿Ya salió mi pedido?", "¿Con cuántos días de anticipación hay que pedir?"],
  ["¿Tienen tortas sin gluten?", "¿Dónde quedan?"],
  ["¿Hacen envíos a Chía?", "¿Puedo cambiar la fecha de entrega?"],
];

const CONVERSATIONS = MESSAGES.map((texts, i) => ({
  id: `c${i}`,
  updatedAt: `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00Z`,
  turns: texts.flatMap((content) => [
    { role: "user", content },
    { role: "assistant", content: "¡Claro! ¿Te ayudo con algo más?" },
  ]),
}));

/** What Jev reads in each question: [general, page or null, topic]. */
const READINGS: Readonly<Record<string, readonly [number, string | null, QuestionTopic]>> = {
  "hacen envios a chia": [0.96, null, "shipping"],
  "cuanto cuesta la torta de chocolate para 20 personas": [0.93, "/tortas", "price"],
  "aceptan pago con nequi": [0.94, null, "payment"],
  "con cuantos dias de anticipacion hay que pedir": [0.9, null, "booking"],
  "tienen tortas sin gluten": [0.91, null, "product"],
  "a que hora abren el sabado": [0.95, "/contacto", "hours"],
  "ya salio mi pedido": [0.04, null, "shipping"],
  "donde quedan": [0.92, "/contacto", "location"],
  "puedo cambiar la fecha de entrega": [0.71, null, "booking"],
};

const QUESTIONS = extractQuestions(CONVERSATIONS, 150);

function matches(): Record<string, QuestionMatch> {
  return Object.fromEntries(
    QUESTIONS.flatMap((question) => {
      const reading = READINGS[question.key];
      if (!reading) return [];
      const [general, page, topic] = reading;
      return [[question.key, {
        general, page, topic, pageConfidence: 0.8, pages: "fixture", model: "jev-1.13", judgedAt: "2026-10-16T12:00:00Z", rubric: 1,
      }]];
    }),
  );
}

type Mode = "graded" | "fresh" | "no-key" | "no-site" | "empty";
const MODES: readonly Mode[] = ["graded", "fresh", "no-key", "no-site", "empty"];

function modeFromUrl(): Mode {
  const raw = new URLSearchParams(window.location.search).get("mode");
  return MODES.includes(raw as Mode) ? (raw as Mode) : "graded";
}

/** Set once "Revisar preguntas" has been pressed on the `fresh` fixture. */
const fixture = { analyzed: false };

function reply(mode: Mode): SiteQuestionsReply {
  const questions = mode === "empty" ? [] : QUESTIONS;
  const graded = mode === "graded" || (mode === "fresh" && fixture.analyzed);
  const read = graded ? matches() : {};
  return {
    ready: mode !== "no-key",
    site: mode === "no-site" ? null : "https://dulcehorno.co/",
    pages: graded ? { count: PAGES.length, fetchedAt: "2026-10-16T12:00:00Z", paths: PAGES.map((page) => page.path) } : null,
    pending: questions.filter((question) => !read[question.key]).length,
    matchedNow: 0,
    reading: questionsReading(questions, read, PAGES),
  };
}

function installFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/seo/questions")) {
      await new Promise((resolve) => setTimeout(resolve, init?.method === "POST" ? 1_400 : 300));
      if (init?.method === "POST") fixture.analyzed = true;
      return new Response(JSON.stringify(reply(modeFromUrl())), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  };
}

if (typeof window !== "undefined") installFetch();

export default function SeoQuestionsPreview() {
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="font-sans text-lg font-medium">SEO → Preguntas</h1>
          <p className="mt-2 text-muted-foreground text-sm">Fixture de desarrollo · datos de prueba</p>
          <nav className="mt-4 flex flex-wrap gap-4 text-xs">
            {MODES.map((option) => (
              <a className="hover:underline" href={`?mode=${option}`} key={option}>
                {option}
              </a>
            ))}
          </nav>
        </header>
        <SiteQuestionsPanel />
      </div>
    </main>
  );
}
