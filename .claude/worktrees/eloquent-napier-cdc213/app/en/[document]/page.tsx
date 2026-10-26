import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { LegalDocument } from "@/app/landing/_components/legal-document";
import { legalMetadata } from "@/lib/legal";

const DOCUMENTS = {
  legal: {
    description: "Learn who operates Oruka, how to get in touch, and the conditions that apply to the website and service.",
    id: "legal",
    title: "Legal notice",
  },
  terms: {
    description: "Read the terms that apply to Oruka's hosted plans and Enterprise license.",
    id: "terms",
    title: "Terms of service",
  },
  privacy: {
    description: "Read how Oruka handles personal data and privacy choices.",
    id: "privacy",
    title: "Privacy policy",
  },
  "privacy-rights": {
    description: "Learn how to exercise your privacy rights with Oruka.",
    id: "rights",
    title: "Your privacy rights",
  },
  cookies: {
    description: "Read how Oruka uses cookies and how to manage your preferences.",
    id: "cookies",
    title: "Cookies and preferences",
  },
} as const;

type DocumentSlug = keyof typeof DOCUMENTS;

function documentFor(slug: string) {
  return DOCUMENTS[slug as DocumentSlug];
}

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ document: string }>;
}): Promise<Metadata> {
  const { document: slug } = await params;
  const document = documentFor(slug);
  if (!document) return {};
  return legalMetadata(`/en/${slug}`, document.title, document.description, "en");
}

export default async function EnglishLegalPage({
  params,
}: {
  readonly params: Promise<{ document: string }>;
}) {
  const { document: slug } = await params;
  const document = documentFor(slug);
  if (!document) notFound();

  return <>
    <MarketingJsonLd description={document.description} locale="en" path={`/en/${slug}`} />
    <LegalDocument document={document.id} />
  </>;
}
