import { LegalDocument } from "@/app/landing/_components/legal-document";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { legalMetadata } from "@/lib/legal";

export const metadata = legalMetadata("/privacy-rights", "Tus derechos de privacidad",
  "Cómo ejercer tus derechos sobre datos personales en Oruka: consultas, rectificación, supresión y plazos en Colombia y otros territorios aplicables.");

export default function PrivacyRightsPage() {
  return <>
    <MarketingJsonLd description="Cómo ejercer tus derechos sobre datos personales en Oruka: consultas, rectificación, supresión y plazos en Colombia y otros territorios aplicables." locale="es" path="/privacy-rights" />
    <LegalDocument document="rights" />
  </>;
}
