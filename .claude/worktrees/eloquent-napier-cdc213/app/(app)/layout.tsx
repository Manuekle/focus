import type { ReactNode } from "react";
import "./shell.css";
import "./text-fonts.css";
import { ShellI18n } from "@/lib/i18n/shell-provider";
import { RouteI18n } from "@/lib/i18n/route-provider";
import { cookies } from "next/headers";
import { AppShell } from "@/app/_components/app-shell";
import { BrowserStorageScopeProvider } from "@/lib/browser-storage-scope";
import { SESSION_COOKIE, getSessionAccountEmail } from "@/lib/auth/store";
import { DEFAULT_BUSINESS_ID, listBusinessesForOwner } from "@/lib/business-scope";
import { WORKSPACE_COOKIE } from "@/lib/workspace-context";
import { isHosted } from "@/lib/hosted";
import { HostedProvider } from "@/lib/hosted-context";
import { billingLocked } from "@/lib/billing-lock";
import { BillingLockProvider } from "@/lib/billing-lock-context";
import { ModulesProvider, type ModuleStateValue } from "@/lib/modules-context";
import { getModuleState } from "@/lib/modules-store";
import { FeaturesProvider } from "@/lib/features-context";
import { enabledFeatures } from "@/lib/features-server";
import { enabledFeatureSet, type FeatureId } from "@/lib/features";
import { NotificationProvider } from "@/components/notifications/notification-provider";
import { withWorkspace } from "@/lib/workspace-context";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Every signed-in route renders inside the shell. It lives here rather than in
 * each page so the sidebar mounts once and stays mounted across navigation —
 * remounting it per page reset the collapsed state, refetched the badges and
 * replayed the entrance animation on every click.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const jar = await cookies();
  const email = await getSessionAccountEmail(jar.get(SESSION_COOKIE)?.value);
  let workspaceId = DEFAULT_BUSINESS_ID;
  if (email) {
    const owned = await listBusinessesForOwner(email);
    const selected = jar.get(WORKSPACE_COOKIE)?.value;
    workspaceId = owned.businesses.some((business) => business.id === selected)
      ? (selected as string)
      : owned.activeId;
  }
  const storageScope = `${email?.trim().toLowerCase() ?? "anonymous"}:${workspaceId}`;
  // Read here, not fetched after mount, so the first paint of the sidebar
  // already leaves out the modules this business switched off. A failure
  // keeps every module: a menu with too much beats one with pages missing.
  const modules: ModuleStateValue = await withWorkspace(workspaceId, () => getModuleState()).catch(
    () => ({ enabled: null, sources: [] }),
  );
  // Read with the page, so a lapsed subscription never paints the panel first.
  const locked = await billingLocked();
  // The operator's per-tenant switches (lib/features.ts), read here for the
  // same reason as the modules: a feature that is off never paints. A failed
  // read falls back to the defaults, not to everything or nothing.
  const features: FeatureId[] = [...(await enabledFeatures().catch(() => enabledFeatureSet()))];

  return (
    <BrowserStorageScopeProvider scope={storageScope}>
      <ShellI18n>
        <HostedProvider hosted={isHosted()}>
          <ModulesProvider initial={modules}>
            <FeaturesProvider enabled={features}>
              <BillingLockProvider locked={locked}>
                <NotificationProvider key={storageScope}>
                  <AppShell><RouteI18n>{children}</RouteI18n></AppShell>
                </NotificationProvider>
              </BillingLockProvider>
            </FeaturesProvider>
          </ModulesProvider>
        </HostedProvider>
      </ShellI18n>
    </BrowserStorageScopeProvider>
  );
}
