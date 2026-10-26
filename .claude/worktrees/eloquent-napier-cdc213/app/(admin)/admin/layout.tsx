import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { adminAccess, adminBasePath } from "@/lib/admin";
import { adminLocale } from "@/lib/admin-locale-server";
import { AdminLocaleProvider } from "./_components/admin-locale";
import { AdminShell } from "./_components/admin-shell";
import { TwoFactorGate } from "./_components/two-factor-gate";
import "./admin.css";

export const metadata = { title: "Admin — Oruka", robots: { index: false, follow: false } };

// Per request, never cached: who is asking decides whether this exists.
export const dynamic = "force-dynamic";

/**
 * The operator's panel (lib/admin.ts). Anyone who is not a signed-in
 * operator on the vendor install gets the same 404 as a page that does not
 * exist: the panel does not announce itself. An operator whose session has
 * not passed the second factor yet (lib/auth/two-factor.ts) gets that step first.
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const access = await adminAccess();
  if (access.state === "none") notFound();
  const locale = await adminLocale();
  // Password alone opens nothing: this session still owes its TOTP code.
  if (access.state === "needs_2fa") {
    return (
      <AdminLocaleProvider initial={locale}>
        <TwoFactorGate operator={access.operator} enrolled={access.status.enabled} locked={access.status.locked} />
      </AdminLocaleProvider>
    );
  }
  // This dynamic server request supplies one clock to both hydration renders.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  return (
    <AdminLocaleProvider initial={locale}>
      <AdminShell operator={access.operator} base={await adminBasePath()} renderedAt={renderedAt}>
        {children}
      </AdminShell>
    </AdminLocaleProvider>
  );
}
