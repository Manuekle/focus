import type { Metadata } from "next";
import { getFormBySlug } from "@/lib/business-store";
import { toPublicView } from "@/lib/forms/public-view";
import { PublicForm } from "./public-form";

/**
 * The page a stranger opens. It renders on the server from the store rather
 * than fetching, so the first paint already has the first question on it —
 * a form that arrives blank and fills in a moment later loses people before
 * they answer anything.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const form = await getFormBySlug(slug);
  if (!form || form.status !== "published") return { title: "oruka" };
  return {
    title: form.name,
    description: form.description || undefined,
    // A form is not something to find in a search index: it is a link the
    // operator hands out, and its answers are about the people who fill it.
    robots: { index: false, follow: false },
  };
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const form = await getFormBySlug(slug);
  const published = form && form.status === "published";

  return <PublicForm form={published ? toPublicView(form) : null} />;
}
