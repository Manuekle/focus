import type { MarketingFaqKey } from "@/lib/marketing-faq";
import { marketingJsonLd } from "@/lib/seo-schema";
import type { MarketingLocale } from "@/lib/site";

export function MarketingJsonLd({
  description,
  faq,
  locale,
  path,
}: {
  readonly description: string;
  readonly faq?: readonly MarketingFaqKey[];
  readonly locale: MarketingLocale;
  readonly path: string;
}) {
  const json = marketingJsonLd({ description, faq, locale, path });
  if (!json) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
