import type { Metadata } from "next";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { legalMetadata } from "@/lib/legal";
import { Privacy } from "./_components/privacy";

export const metadata: Metadata = legalMetadata("/privacy", "Política de privacidad",
  "Cómo trata Oruka los datos personales en sus planes alojados y Enterprise: finalidades, proveedores, conservación y derechos de privacidad.");

export default function PrivacyPage() {
  return <>
    <MarketingJsonLd description="Cómo trata Oruka los datos personales en sus planes alojados y Enterprise: finalidades, proveedores, conservación y derechos de privacidad." locale="es" path="/privacy" />
    <Privacy />
  </>;
}
