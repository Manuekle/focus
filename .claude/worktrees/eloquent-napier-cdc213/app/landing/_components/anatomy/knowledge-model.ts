/**
 * The truth behind Fig 05.1, kept apart from the drawing so every number the
 * card shows comes from one place.
 *
 * What the product does (`lib/rag.ts`, `lib/knowledge-store.ts`): a document
 * is cut into passages of 1,200 characters that overlap by 200, each passage
 * is embedded, and a question is embedded and compared against every passage
 * by cosine similarity. Anything under 0.1 is dropped and the best five come
 * back (`search_knowledge`, `limit` 5), each with the document it came from.
 *
 * The drawing is an edge-notched card file. Every passage is a card standing
 * in a drawer, filed behind the divider of its document. Four selector rods run
 * through the whole drawer, one per question, and every card has a notch over
 * each rod. A notch is cut as deep as the card is unlike that question — the
 * depth is `(1 − score) × NOTCH`. Lift a rod by `LIFT` and a card rides up on it
 * by `LIFT − depth`, which is `(score − 0.1) × NOTCH`: the closest passage rises
 * highest, one that scores under 0.1 is never touched, and the five tallest
 * are the five the agent reads.
 */

export type DocumentId = "prices" | "catalog" | "policies";

/** The three documents in the drawer, back to front, and how many passages each was cut into. */
export const DOCUMENTS: readonly { readonly id: DocumentId; readonly passages: number }[] = [
  { id: "prices", passages: 7 },
  { id: "catalog", passages: 11 },
  { id: "policies", passages: 8 },
];

export const PASSAGES = DOCUMENTS.reduce((sum, document) => sum + document.passages, 0);

/** `searchChunks` drops anything under this. */
export const MIN_SCORE = 0.1;
/** `search_knowledge`'s default `limit`. */
export const TOP = 5;
/** World units of notch per unit of distance, so a card rises `(score − MIN_SCORE) × NOTCH`. */
export const NOTCH = 14;
/** How far the selected rod is lifted: exactly the rise of a card that scores `MIN_SCORE`, which is none. */
export const LIFT = (1 - MIN_SCORE) * NOTCH;

export type QuestionId = "price" | "sizes" | "returns" | "shipping";

type Scores = { readonly [document in DocumentId]: readonly number[] };

/**
 * Four questions and how close each passage is to them, document by document.
 * The shape is what a real index gives: one document answers most questions,
 * shipping is answered from two, and most passages sit near nothing.
 */
export const QUESTIONS: readonly { readonly id: QuestionId; readonly scores: Scores }[] = [
  {
    id: "price",
    scores: {
      prices: [0.42, 0.71, 0.38, 0.55, 0.24, 0.33, 0.19],
      catalog: [0.28, 0.12, 0.46, 0.09, 0.21, 0.31, 0.05, 0.14, 0.26, 0.08, 0.17],
      policies: [0.06, 0.11, 0.04, 0.15, 0.08, 0.03, 0.12, 0.07],
    },
  },
  {
    id: "sizes",
    scores: {
      prices: [0.12, 0.18, 0.09, 0.22, 0.31, 0.15, 0.07],
      catalog: [0.24, 0.48, 0.66, 0.39, 0.13, 0.58, 0.29, 0.44, 0.19, 0.35, 0.21],
      policies: [0.05, 0.08, 0.14, 0.03, 0.09, 0.11, 0.06, 0.04],
    },
  },
  {
    id: "returns",
    scores: {
      prices: [0.08, 0.05, 0.13, 0.07, 0.11, 0.04, 0.16],
      catalog: [0.06, 0.1, 0.03, 0.12, 0.07, 0.09, 0.15, 0.05, 0.11, 0.08, 0.04],
      policies: [0.34, 0.74, 0.51, 0.27, 0.62, 0.19, 0.43, 0.22],
    },
  },
  {
    id: "shipping",
    scores: {
      prices: [0.21, 0.14, 0.27, 0.49, 0.36, 0.12, 0.58],
      catalog: [0.11, 0.07, 0.16, 0.05, 0.13, 0.19, 0.08, 0.22, 0.1, 0.06, 0.15],
      policies: [0.29, 0.18, 0.41, 0.68, 0.24, 0.53, 0.12, 0.31],
    },
  },
];

/** One card: its document, and its score for each question, in drawer order. */
export type Passage = { readonly document: DocumentId; readonly scores: readonly number[] };

export const CARDS: readonly Passage[] = DOCUMENTS.flatMap((document) =>
  Array.from({ length: document.passages }, (_, index) => ({
    document: document.id,
    scores: QUESTIONS.map((question) => question.scores[document.id][index] ?? 0),
  })),
);

/** How deep a card's notch over rod `question` is cut. */
export const notchOf = (card: Passage, question: number) => (1 - (card.scores[question] ?? 0)) * NOTCH;

/** How high a card stands when rod `question` is lifted by `lift`. */
export const riseOf = (card: Passage, question: number, lift: number) => Math.max(0, lift - notchOf(card, question));

/** The cards `search_knowledge` returns for a question, best first: the top five over `MIN_SCORE`. */
export function matchesOf(question: number): number[] {
  return CARDS.map((card, index) => ({ index, score: card.scores[question] ?? 0 }))
    .filter((match) => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP)
    .map((match) => match.index);
}

export const MATCHES: readonly (readonly number[])[] = QUESTIONS.map((_, question) => matchesOf(question));
