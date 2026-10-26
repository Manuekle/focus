import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  HelpCircleIcon,
  LockKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { SuccessCheck } from "@/components/ai-elements/success-check";
import { PaymentProviderMark } from "@/components/agents/payment-provider-mark";
import { listBusinesses } from "@/lib/business-scope";
import { getBusinessIdentity } from "@/lib/business-profile-store";
import { getContact } from "@/lib/business-store";
import type { Locale } from "@/lib/i18n/dictionaries";
import { translate } from "@/lib/i18n/server";
import { PAYMENT_PROVIDER_NAME, paymentAmount } from "@/lib/payment-format";
import { listPayments, type PaymentRecord } from "@/lib/payment-store";
import { withWorkspace } from "@/lib/workspace-context";

// What a buyer sees right after paying a link the agent sent on WhatsApp or
// Instagram. app/api/payments/return has already asked the processor and
// settled the payment; this page only reads the ledger, so a hand-edited URL
// can show at most the real state of a real payment, never a fake "paid".

export const metadata: Metadata = {
  title: "Pago",
  robots: { index: false, follow: false },
};

const WORKSPACE = /^[a-zA-Z0-9_-]{1,100}$/;
const REFERENCE = /^(plink_[A-Za-z0-9]{1,100}|oruka_[a-f0-9]{24})$/;

type View = {
  readonly state: "paid" | "pending" | "unknown";
  readonly record?: PaymentRecord;
  readonly channel?: string;
  readonly business?: string;
};

async function readPayment(workspaceId: string, reference: string): Promise<View> {
  if (!WORKSPACE.test(workspaceId) || !REFERENCE.test(reference)) return { state: "unknown" };
  const { businesses } = await listBusinesses();
  if (!businesses.some((business) => business.id === workspaceId)) return { state: "unknown" };
  return withWorkspace(workspaceId, async () => {
    const [payments, identity] = await Promise.all([listPayments(), getBusinessIdentity().catch(() => undefined)]);
    const business = identity?.name.trim() || undefined;
    const record = payments.find((payment) => payment.reference === reference && payment.provider !== "shopify");
    if (!record) return { state: "unknown", business };
    const contact = record.contactId ? await getContact(record.contactId).catch(() => undefined) : undefined;
    return { state: record.status, record, channel: contact?.channel, business };
  });
}

async function localeFrom(): Promise<Locale> {
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.trim().toLowerCase().startsWith("en") ? "en" : "es";
}

export default async function PaymentDonePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [view, locale] = await Promise.all([
    readPayment(typeof params.ws === "string" ? params.ws : "", typeof params.ref === "string" ? params.ref : "").catch(
      (): View => ({ state: "unknown" }),
    ),
    localeFrom(),
  ]);
  const provider = view.record?.provider === "mercadopago" ? "mercadopago" : "stripe";
  const channel =
    view.state !== "unknown" && (view.channel === "whatsapp" || view.channel === "instagram") ? view.channel : "other";
  const [title, body, secure] = await Promise.all([
    translate(locale, `payReturn.${view.state}.title`),
    translate(locale, `payReturn.${view.state}.body.${channel}`),
    translate(locale, "payReturn.secure", { provider: PAYMENT_PROVIDER_NAME[provider] }),
  ]);
  const amount = view.record
    ? paymentAmount({ amount: view.record.amountPaid ?? view.record.amount, currency: view.record.currency }, locale)
    : "";

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="content-enter w-full max-w-sm rounded-[22px] border border-border/70 bg-muted/50 p-1.5">
        <section className="flex flex-col items-center gap-4 rounded-[16px] border border-border/50 bg-card px-6 py-8 text-center shadow-xs">
          {view.state === "paid" ? (
            <span className="t-pay-pop grid size-16 place-items-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
              <SuccessCheck active className="text-[30px]">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={30} strokeWidth={1.75} />
              </SuccessCheck>
            </span>
          ) : (
            <span className="grid size-16 place-items-center rounded-full bg-muted text-muted-foreground">
              <HugeiconsIcon icon={view.state === "pending" ? Clock01Icon : HelpCircleIcon} size={28} strokeWidth={1.75} />
            </span>
          )}
          <div className="space-y-1.5">
            {view.business ? <p className="text-xs font-medium text-muted-foreground">{view.business}</p> : null}
            <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="text-sm text-balance text-muted-foreground">{body}</p>
          </div>
          {view.record ? (
            <div className="w-full rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-left">
              <p className="break-words text-sm text-muted-foreground">{view.record.productName}</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{amount}</p>
            </div>
          ) : null}
        </section>
        {view.record ? (
          <p className="flex items-center justify-center gap-1.5 px-3 pb-1 pt-2.5 text-xs text-muted-foreground">
            <HugeiconsIcon icon={LockKeyIcon} size={13} strokeWidth={1.75} />
            {secure}
            <PaymentProviderMark provider={provider} size={13} />
          </p>
        ) : null}
      </div>
    </main>
  );
}
