import type { Metadata } from "next";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { legalMetadata } from "@/lib/legal";
import { Terms } from "./_components/terms";

export const metadata: Metadata = legalMetadata("/terms", "Términos y condiciones",
  "Condiciones de Oruka: planes Pro y Managed, licencia Enterprise, pagos, renovación, cancelación, uso de IA y responsabilidades.");

export default function TermsPage() {
  return <>
    <MarketingJsonLd description="Condiciones de Oruka: planes Pro y Managed, licencia Enterprise, pagos, renovación, cancelación, uso de IA y responsabilidades." locale="es" path="/terms" />
    <Terms />
  </>;
}
