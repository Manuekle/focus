"use client";

import { PageHeader, MarketingShell } from "@/app/landing/_components/marketing-shell";
import { Grain } from "@/app/landing/_components/grain";
import { Reveal, Shell } from "@/app/landing/_components/primitives";
import styles from "@/app/landing/_components/editorial.module.css";
import { useT } from "@/lib/i18n/provider";
import { ENTITY } from "@/app/landing/_components/legal-page";

export function Team() {
  const t = useT();

  return (
    <MarketingShell>
      <PageHeader eyebrow={t("team.eyebrow")} title={t("team.title")} titleClassName="font-cooper" lede={t("team.lede")} />

      <div className={`${styles.surface} ${styles.publicBody}`}>
        <Grain />
        <Shell className={`${styles.publicBodyContent} py-20 sm:py-28`}>
          {/* The people section waits for real profiles. It shipped with six
              placeholder cards ("Nombre pendiente", "Perfil placeholder"),
              which on a public page reads as a team that does not exist. Add
              each person here, with their consent, once there is a name, a
              role and a photo to show. */}
          <Reveal className="grid gap-8 md:grid-cols-2 md:gap-16">
            <div>
              <p className="lp-eyebrow">{t("team.missionLabel")}</p>
              <h2 className="mt-4 max-w-[15ch] font-cooper text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] font-medium tracking-[-0.02em]">{t("team.missionTitle")}</h2>
            </div>
            <p className="max-w-[43ch] self-center text-[15px] leading-relaxed text-muted-foreground">{t("team.missionBody")}</p>
          </Reveal>

          <Reveal className="mt-20 border-y border-border py-16 sm:mt-28 sm:py-20" delay={80}>
            <section id="team-contact" aria-labelledby="team-contact-heading" className="md:flex md:items-end md:justify-between md:gap-12">
              <div>
                <p className="lp-eyebrow">{t("team.hiringLabel")}</p>
                <h2 id="team-contact-heading" className="mt-4 max-w-[15ch] font-cooper text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-medium tracking-[-0.02em]">{t("team.hiringTitle")}</h2>
                <p className="mt-5 max-w-[43ch] text-[16px] leading-relaxed text-muted-foreground">{t("team.hiringBody")}</p>
              </div>
              {/* "Write to us" goes to an inbox, not to the pricing page it
                  used to open. No published address yet, no link. */}
              {ENTITY.email ? (
                <a className="lp-focus group mt-8 inline-flex min-h-6 w-fit items-center gap-2 text-sm font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground md:mt-0" href={`mailto:${ENTITY.email}`}>
                  {t("team.hiringCta")} <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">↗</span>
                </a>
              ) : null}
            </section>
          </Reveal>
        </Shell>
      </div>
    </MarketingShell>
  );
}
