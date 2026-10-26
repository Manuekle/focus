import type { Metadata } from "next";
import { redirect } from "next/navigation";
import styles from "@/app/landing/_components/editorial.module.css";
import { Grain } from "@/app/landing/_components/grain";
import { MarketingShell } from "@/app/landing/_components/marketing-shell";
import { Shell } from "@/app/landing/_components/primitives";
import { vendorFleetOrigin } from "@/lib/hosted";
import type { Locale } from "@/lib/i18n/dictionaries";
import { translate } from "@/lib/i18n/server";
import { WorkspaceFinder, type FinderCopy } from "./_components/workspace-finder";

// /signin — "sign in" on the vendor site (www.oruka.si).
//
// Each hosted customer has their own install at <slug>.oruka.si with its own
// accounts, so a sign-in here cannot reach them. This page asks for the
// address and sends them to its sign-in, or has the fleet email an owner the
// addresses on file. Anywhere but the vendor site it is the ordinary /login.

export const metadata: Metadata = {
  title: "Oruka",
  robots: { index: false, follow: false },
};

const KEYS = [
  "eyebrow", "title", "lede", "addressLabel", "addressPlaceholder", "continue", "checking",
  "notFound", "failed", "forgot", "emailLabel", "emailPlaceholder", "send", "sending", "sent",
  "newHere", "seePlans", "admin",
] as const;

async function finderCopy(locale: Locale): Promise<FinderCopy> {
  const values = await Promise.all(KEYS.map((key) => translate(locale, `workspace.${key}`)));
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]])) as FinderCopy;
}

export default async function WorkspaceSignInPage() {
  const fleet = vendorFleetOrigin();
  if (!fleet) redirect("/login");
  // fleet.oruka.si -> oruka.si: the suffix every workspace address shares.
  const baseDomain = new URL(fleet).hostname.split(".").slice(1).join(".");
  const [es, en] = await Promise.all([finderCopy("es"), finderCopy("en")]);
  return (
    <MarketingShell>
      <section className={`${styles.surface} ${styles.publicBody} pb-24 pt-28 sm:pt-36`}>
        <Grain />
        <Shell className={styles.publicBodyContent}>
          <WorkspaceFinder copies={{ es, en }} baseDomain={baseDomain} />
        </Shell>
      </section>
    </MarketingShell>
  );
}
