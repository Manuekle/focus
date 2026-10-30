"use client";

import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { Logout01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ThemeToggle } from "../../components/theme-toggle";
import { cn } from "../../lib/utils";
import type { PublicUser, SessionInfo } from "../../shared/account";
import { signInWithFacebook, signOut } from "./session-client";

export function Avatar({ user, className }: { readonly user: PublicUser; readonly className?: string }) {
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Facebook CDN picture, not a local asset
    <img src={user.avatarUrl} alt="" className={cn("size-7 rounded-full object-cover", className)} referrerPolicy="no-referrer" />
  ) : (
    <span aria-hidden className={cn("grid size-7 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_22%,var(--muted))] text-xs font-semibold text-foreground", className)}>
      {user.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Header account control: generations left and "Sign in", or the signed-in person's menu. */
export function AccountButton({ session, next }: { readonly session: SessionInfo | null; readonly next: string }) {
  return <div className="flex items-center gap-2"><ThemeToggle /><AccountControl session={session} next={next} /></div>;
}

function AccountControl({ session, next }: { readonly session: SessionInfo | null; readonly next: string }) {
  const router = useRouter();
  if (!session) return <span aria-hidden className="h-8 w-24" />;
  if (!session.user) {
    const quota = session.quota;
    return (
      <div className="flex items-center gap-3">
        {quota ? (
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
            {quota.remaining === 0 ? "No generations left" : `${quota.remaining} of ${quota.limit} generations left`}
          </span>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => signInWithFacebook(next)}>
          Sign in
        </Button>
      </div>
    );
  }
  const user = session.user;
  return (
    <div className="flex items-center gap-3">
    {session.quota ? <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{session.quota.remaining} of {session.quota.limit} generations left</span> : null}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex items-center gap-2 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Account: ${user.name}`}>
          <Avatar user={user} />
          <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-border bg-card p-1 shadow-xl">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.simulated ? "Facebook (simulated locally)" : "Signed in with Facebook"}</p>
              {session.quota ? <p className="mt-1 text-xs text-muted-foreground" role="status">{session.quota.remaining} of {session.quota.limit} generations left</p> : null}
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => void signOut().then(() => router.push("/editor"))}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted"
            >
              <HugeiconsIcon icon={Logout01Icon} size={14} strokeWidth={1.75} />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
