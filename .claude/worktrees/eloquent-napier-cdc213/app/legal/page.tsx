import { LegalDocument } from "@/app/landing/_components/legal-document";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { legalMetadata } from "@/lib/legal";

export const metadata = legalMetadata("/legal", "Aviso legal",
  "Identificación del titular de Oruka, servicio operado por una persona natural en Colombia, contacto, propiedad intelectual y documentos aplicables.");

export default function LegalNoticePage() {
  return <>
    <MarketingJsonLd description="Identificación del titular de Oruka, servicio operado por una persona natural en Colombia, contacto, propiedad intelectual y documentos aplicables." locale="es" path="/legal" />
    <LegalDocument document="legal" />
  </>;
}
