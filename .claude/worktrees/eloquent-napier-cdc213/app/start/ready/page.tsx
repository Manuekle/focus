import type { Metadata } from "next";
import styles from "@/app/landing/_components/editorial.module.css";
import { Grain } from "@/app/landing/_components/grain";
import { MarketingShell } from "@/app/landing/_components/marketing-shell";
import { Shell } from "@/app/landing/_components/primitives";
import type { Locale } from "@/lib/i18n/dictionaries";
import { translate } from "@/lib/i18n/server";
import { ProvisioningProgress, type ProgressCopy } from "./_components/provisioning-progress";
import { STAGES } from "./_components/stages";

// Where Stripe sends a buyer after paying for a hosted plan (the fleet's
// FLEET_SIGNUP_DONE_URL, SR-R1), with `?session_id=<checkout session>`. The
// page follows the fleet's real progress for that checkout until the install
// is ready. One URL for every buyer; the copy follows the site's locale.

export const metadata: Metadata = {
  title: "Oruka",
  robots: { index: false, follow: false },
};

const SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

async function progressCopy(locale: Locale): Promise<ProgressCopy> {
  const t = (key: string) => translate(locale, `start.progress.${key}`);
  const stageEntries = await Promise.all(
    STAGES.map(async (stage) => [stage, { label: await t(`stage.${stage}`), detail: await t(`stage.${stage}.detail`) }] as const),
  );
  const keys = ["eyebrow", "title", "readyTitle", "lede", "readyBody", "readyCta", "address", "elapsed", "stepOf", "delayed", "unavailable", "noSession", "home"] as const;
  const values = await Promise.all(keys.map(t));
  const text = Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<(typeof keys)[number], string>;
  return { ...text, stages: Object.fromEntries(stageEntries) as ProgressCopy["stages"] };
}

export default async function SignupDonePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.session_id === "string" ? params.session_id : "";
  // Both languages: the client picks the one the rest of the site is in.
  const [es, en] = await Promise.all([progressCopy("es"), progressCopy("en")]);
  return (
    <MarketingShell>
      <section className={`${styles.surface} ${styles.publicBody} pb-24 pt-28 sm:pt-36`}>
        <Grain />
        <Shell className={styles.publicBodyContent}>
          <ProvisioningProgress copies={{ es, en }} session={SESSION.test(raw) ? raw : null} />
        </Shell>
      </section>
    </MarketingShell>
  );
}
