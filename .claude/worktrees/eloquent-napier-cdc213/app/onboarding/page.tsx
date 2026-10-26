import { cookies } from "next/headers";
import { OnboardingFlow } from "./onboarding-flow";
import { SESSION_COOKIE, getSessionAccountEmail } from "@/lib/auth/store";
import { DEFAULT_BUSINESS_ID, listBusinessesForOwner } from "@/lib/business-scope";
import { BrowserStorageScopeProvider } from "@/lib/browser-storage-scope";
import { WORKSPACE_COOKIE } from "@/lib/workspace-context";

export default async function OnboardingPage() {
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

  return (
    <BrowserStorageScopeProvider scope={storageScope}>
      <OnboardingFlow />
    </BrowserStorageScopeProvider>
  );
}
