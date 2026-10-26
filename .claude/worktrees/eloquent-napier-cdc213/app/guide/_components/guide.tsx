"use client";

import { Clause } from "@/app/landing/_components/legal-page";
import { MarketingShell, PageHeader } from "@/app/landing/_components/marketing-shell";
import styles from "@/app/landing/_components/editorial.module.css";
import { Grain } from "@/app/landing/_components/grain";
import { Shell } from "@/app/landing/_components/primitives";
import { useT } from "@/lib/i18n/provider";

/**
 * A block of shell commands. Not run through the dictionary — commands,
 * flags and env var names are the same in every locale, only the prose
 * around them changes.
 */
function CodeBlock({ children }: { readonly children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

/**
 * The install-and-configure guide.
 *
 * One clause per piece of the app, in the order you'd actually touch them:
 * what the machine needs, how to bring it up locally, the live checks the
 * app itself runs, then where each feature — database, model, channels,
 * knowledge base, agents, ads, tracing, production — gets configured once
 * it's running. Every fact here is checkable against README.md and the
 * pages it describes; nothing is aspirational.
 */
export function Guide() {
  const t = useT();

  return (
    <MarketingShell>
      <PageHeader
        eyebrow={t("legal.updatedOn", { updated: t("guide.updated") })}
        title={t("guide.title")}
        titleClassName="font-cooper"
        lede={t("guide.lede")}
      />

      <section className={`${styles.surface} ${styles.publicBody} py-16 sm:py-20`}>
        <Grain />
        <Shell className={styles.publicBodyContent}>
          <div className="max-w-[72ch]">
            <Clause title={t("guide.audience.title")}>
              <p>{t("guide.audience.body")}</p>
            </Clause>

            <Clause title={t("guide.requirements.title")}>
              <p>{t("guide.requirements.body")}</p>
            </Clause>

            <Clause title={t("guide.quickInstall.title")}>
              <p>{t("guide.quickInstall.p1")}</p>
              <div className="my-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="https://www.oruka.si/install.sh"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  {t("guide.quickInstall.macosLinux")}
                </a>
                <a
                  href="https://www.oruka.si/install.ps1"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
                  </svg>
                  {t("guide.quickInstall.windows")}
                </a>
              </div>
              <p className="text-sm text-muted-foreground">{t("guide.quickInstall.macosLinux")}</p>
              <CodeBlock>{`curl -fsSL https://www.oruka.si/install.sh | bash`}</CodeBlock>
              <p className="text-sm text-muted-foreground">{t("guide.quickInstall.windows")}</p>
              <CodeBlock>{`irm https://www.oruka.si/install.ps1 | iex`}</CodeBlock>
              <p>{t("guide.quickInstall.afterInstall")}</p>
            </Clause>

            <Clause title={t("guide.localInstall.title")}>
              <p>{t("guide.localInstall.p1")}</p>
              <CodeBlock>{`git clone https://github.com/Manuekle/oruka.git
cd oruka
corepack enable
pnpm install --frozen-lockfile --strict-peer-dependencies
cp .env.example .env`}</CodeBlock>
              <p>{t("guide.localInstall.p2")}</p>
              <p>{t("guide.localInstall.p3")}</p>
              <CodeBlock>{`pnpm db:up
pnpm db:migrate
pnpm dev`}</CodeBlock>
              <p>{t("guide.localInstall.p4")}</p>
            </Clause>

            <Clause title={t("guide.liveSetup.title")}>
              <p>{t("guide.liveSetup.p1")}</p>
              <p>{t("guide.liveSetup.p2")}</p>
            </Clause>

            <Clause title={t("guide.database.title")}>
              <p>{t("guide.database.body")}</p>
            </Clause>

            <Clause title={t("guide.aiModel.title")}>
              <p>{t("guide.aiModel.body")}</p>
            </Clause>

            <Clause title={t("guide.channels.title")}>
              <p>{t("guide.channels.body")}</p>
            </Clause>

            <Clause title={t("guide.knowledge.title")}>
              <p>{t("guide.knowledge.body")}</p>
            </Clause>

            <Clause title={t("guide.agentsAutomations.title")}>
              <p>{t("guide.agentsAutomations.body")}</p>
            </Clause>

            <Clause title={t("guide.connections.title")}>
              <p>{t("guide.connections.body")}</p>
              <p>{t("guide.connections.p2")}</p>
            </Clause>

            <Clause title={t("guide.forms.title")}>
              <p>{t("guide.forms.body")}</p>
            </Clause>

            <Clause title={t("guide.ads.title")}>
              <p>{t("guide.ads.body")}</p>
            </Clause>

            <Clause title={t("guide.observability.title")}>
              <p>{t("guide.observability.body")}</p>
              <CodeBlock>{`docker compose --profile observability up -d jaeger
# .env
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"`}</CodeBlock>
              <p>{t("guide.observability.p2")}</p>
            </Clause>

            <Clause title={t("guide.deployment.title")}>
              <p>{t("guide.deployment.body")}</p>
            </Clause>
          </div>
        </Shell>
      </section>
    </MarketingShell>
  );
}
