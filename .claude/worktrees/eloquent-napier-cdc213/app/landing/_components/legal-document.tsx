"use client";

import Link from "next/link";
import { legalCopy, type LegalDocumentId } from "@/content/legal-copy";
import { useI18n } from "@/lib/i18n/provider";
import { LEGAL_ENTITY, LEGAL_INCOMPLETE, LEGAL_LINKS, LEGAL_OPERATIONS, LEGAL_OPERATIONS_EN, LEGAL_VERSION, PRIVACY_VERSION } from "@/lib/legal";
import { LegalPage } from "./legal-page";

export function LegalDocument({ document }: { document: LegalDocumentId }) {
  const { locale } = useI18n();
  const es = locale === "es";
  const operationValues = es ? LEGAL_OPERATIONS : LEGAL_OPERATIONS_EN;
  const text = legalCopy[locale][document];
  const pending = es ? "Pendiente de completar por el titular" : "To be completed by the operator";
  const fields = [
    [es ? "Titular (persona natural)" : "Operator (individual)", LEGAL_ENTITY.name],
    [es ? "Domicilio para notificaciones" : "Address for legal notices", LEGAL_ENTITY.address],
    [es ? "País de establecimiento" : "Country of establishment", LEGAL_ENTITY.jurisdiction],
    [es ? "Correo de contacto y privacidad" : "Contact and privacy email", LEGAL_ENTITY.email],
    [es ? "Teléfono de contacto" : "Contact phone", LEGAL_ENTITY.phone],
    ...(LEGAL_ENTITY.taxId ? [[es ? "Registro tributario" : "Tax registration", LEGAL_ENTITY.taxId]] : []),
  ];
  const operations = [
    [es ? "Hosting" : "Hosting", operationValues.hosting],
    [es ? "Base de datos" : "Database", operationValues.database],
    [es ? "Archivos" : "File storage", operationValues.storage],
    [es ? "Países de tratamiento" : "Processing countries", operationValues.processingCountries],
    [es ? "Conservación, borrado y copias" : "Retention, deletion and backups", operationValues.retentionAndBackups],
    [es ? "Conservación de eventos de analítica" : "Analytics event retention", operationValues.analyticsRetention],
  ];

  return <LegalPage title={text.title} lede={text.intro} updated={document === "privacy" ? PRIVACY_VERSION : LEGAL_VERSION}>
    {LEGAL_INCOMPLETE && <p className="mb-8 text-xs text-muted-foreground" aria-label={es ? "Estado del documento" : "Document status"}>
      {es ? "Los datos del titular y de operación deben completarse antes de publicar este documento." : "Operator and service details must be completed before publishing this document."}
    </p>}
    {!es && <p className="mb-8 text-xs text-muted-foreground">English translation. Spanish is the reference version, subject to mandatory local language and consumer rights.</p>}
    <nav aria-label={es ? "En esta página" : "On this page"} className="mb-8 border-border border-y py-3">
      <p className="font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground">{es ? "En esta página" : "On this page"}</p>
      <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {text.sections.map((section, index) => <li key={section.title}><a className="lp-focus underline decoration-border underline-offset-4 hover:decoration-current" href={`#section-${index + 1}`}>{section.title}</a></li>)}
      </ol>
    </nav>
    <section aria-labelledby="operator-details" className="mb-10">
      <h2 id="operator-details" className="text-lg font-medium tracking-[-0.02em]">{es ? "Identificación y contacto" : "Identification and contact"}</h2>
      <dl className="mt-4 space-y-3 text-sm">
        {fields.map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium">{label}</dt>
          <dd className="break-words text-muted-foreground">{value === LEGAL_ENTITY.email && value
            ? <a className="lp-focus underline underline-offset-4" href={`mailto:${value}`}>{value}</a>
            : value || pending}</dd>
        </div>)}
      </dl>
    </section>
    <article>
      {text.sections.map((section, index) => <section key={section.title} id={`section-${index + 1}`} className="scroll-mt-28 border-t border-border py-8">
        <h2 className="text-lg font-medium tracking-[-0.02em]">{section.title}</h2>
        <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.links && <ul className="list-disc space-y-2 pl-5">
            {section.links.map((link) => <li key={link.href}><Link className="lp-focus underline underline-offset-4" href={link.href}>{link.label}</Link></li>)}
          </ul>}
        </div>
      </section>)}
    </article>
    {(document === "privacy" || document === "cookies") && <section aria-labelledby="operations-details" className="border-t border-border py-8">
      <h2 id="operations-details" className="text-lg font-medium tracking-[-0.02em]">{es ? "Ficha operativa de esta instalación" : "This installation's operations record"}</h2>
      <dl className="mt-4 space-y-4 text-sm">
        {operations.map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="mt-1 whitespace-pre-line break-words text-muted-foreground">{value || pending}</dd></div>)}
      </dl>
    </section>}
    <nav aria-label={es ? "Documentos relacionados" : "Related documents"} className="mt-6 flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-6 text-sm">
      {LEGAL_LINKS.map((link) => <Link className="lp-focus inline-flex min-h-11 items-center underline underline-offset-4" key={link.href} href={link.href}>{link[locale]}</Link>)}
      <a className="lp-focus inline-flex min-h-11 items-center underline underline-offset-4" href="https://www.sic.gov.co/tema/proteccion-de-datos-personales">{es ? "Protección de datos — SIC" : "Data protection — SIC"}</a>
    </nav>
  </LegalPage>;
}
