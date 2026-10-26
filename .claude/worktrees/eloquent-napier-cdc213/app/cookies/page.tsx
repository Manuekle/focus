import { LegalDocument } from "@/app/landing/_components/legal-document";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { legalMetadata } from "@/lib/legal";

export const metadata = legalMetadata("/cookies", "Cookies y preferencias",
  "Consulta el almacenamiento necesario de Oruka y configura o rechaza la analítica opcional de Google Analytics y PostHog en tu navegador.");

export default function CookiesPage() {
  return <>
    <MarketingJsonLd description="Consulta el almacenamiento necesario de Oruka y configura o rechaza la analítica opcional de Google Analytics y PostHog en tu navegador." locale="es" path="/cookies" />
    <LegalDocument document="cookies" />
  </>;
}
