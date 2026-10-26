import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readBusinessLogoById } from "@/lib/business-profile-store";
import { getPublishedLinkPageBySlug } from "@/lib/link-pages";
import { SITE_URL } from "@/lib/site";
import { LinkPageView } from "./link-page-view";

/** Link pages depend on mutable workspace data, never a build-time snapshot. */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedLinkPageBySlug(slug);
  if (!result) return { title: "Página no encontrada", robots: { index: false, follow: false } };
  const { page } = result;
  const url = `${SITE_URL}/l/${encodeURIComponent(page.slug)}`;
  return {
    title: { absolute: page.profile.title },
    description: page.profile.description || undefined,
    alternates: { canonical: url },
    openGraph: { title: page.profile.title, description: page.profile.description || undefined, type: "website", url },
    twitter: { card: "summary", title: page.profile.title, description: page.profile.description || undefined },
    // A page handed out on a profile or QR code must not become a crawler
    // discovery mechanism for a private business directory.
    robots: { index: false, follow: false },
  };
}

export default async function PublicLinkPage({ params }: Props) {
  const { slug } = await params;
  const result = await getPublishedLinkPageBySlug(slug);
  if (!result) notFound();
  const logo = await readBusinessLogoById(result.businessId);
  return <LinkPageView page={result.page} hasLogo={Boolean(logo)} />;
}
