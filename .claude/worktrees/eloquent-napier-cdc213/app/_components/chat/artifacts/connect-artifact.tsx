"use client";

import {
  AlertCircleIcon,
  Blockchain05Icon,
  CheckmarkCircle02Icon,
  ExternalLinkIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ConnectionIcon } from "@/components/connections/connection-icon";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import type { ConnectAction, ConnectStatus, ConnectTarget } from "@/lib/connect-targets";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The card the agent draws when it needs something connected.
 *
 * `request_connection` returns which integrations a request needed and where
 * each one actually stands; this is the row of buttons that answer costs
 * instead of a sentence pointing at a page. See agent/tools/request_connection.ts
 * for why the sentence was not good enough.
 *
 * ## Everything readable is translated here
 *
 * The tool returns enums and dictionary keys, never prose. The console has its
 * own language toggle (lib/i18n) and the tool runs on the server where that
 * toggle is out of scope, so a status composed server-side would be a Spanish
 * card in an English console. Brand names are the exception — "Shopify" is
 * "Shopify" in both — and arrive as plain strings.
 *
 * ## New tab, deliberately
 *
 * Connecting is a round trip through a provider's consent screen, and doing it
 * in this tab throws away the conversation that explained why. It opens beside
 * the chat instead: agent/instructions/connections.ts re-reads the live state
 * at the start of every turn, so coming back and saying "listo" is enough for
 * the agent to see the account and carry on.
 *
 * ## An already-connected row still shows
 *
 * The tool refuses outright when *nothing* asked for is missing, but a mixed
 * card keeps its settled rows: "Shopify ✓, WhatsApp — conectar" is the answer
 * to "why can't you message my customers", and dropping the tick would make
 * the card look like it was asking for Shopify too.
 */
export function ConnectArtifact({
  reason,
  targets,
}: {
  readonly reason?: string;
  readonly targets: readonly ConnectTarget[];
}) {
  const t = useT();
  const pending = targets.filter((target) => target.status !== "ready").length;

  return (
    <FramedCard as="section" className="my-1.5">
      <FramedCardPanel className="p-4">
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]"
          >
            <HugeiconsIcon icon={Blockchain05Icon} size={16} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("chat.connect.title")}
            </span>
            {reason ? (
              <p className="text-pretty text-[15px] leading-relaxed text-foreground">{reason}</p>
            ) : null}
          </div>
        </header>

        <ul className="mt-3 grid gap-1.5">
          {targets.map((target) => (
            <li key={target.id}>
              <ConnectRow target={target} />
            </li>
          ))}
        </ul>
      </FramedCardPanel>
      <FramedCardFooter>
        <p>{pending > 0 ? t("chat.connect.hint") : t("chat.connect.allSet")}</p>
      </FramedCardFooter>
    </FramedCard>
  );
}

function ConnectRow({ target }: { readonly target: ConnectTarget }) {
  const t = useT();
  const name = target.labelKey ? t(target.labelKey) : (target.label ?? target.id);
  const ready = target.status === "ready";

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md bg-background",
          ready ? "opacity-60" : undefined,
        )}
      >
        <ConnectionIcon id={target.id} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        {/* Wraps rather than truncates. The console's panes are a couple of
            hundred pixels narrower than the breakpoints suggest, and with the
            status badge beside it a truncating name rendered "S… Session
            expired" — the one row where the reader has to know *which*
            account died. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span
            className={cn(
              "text-sm leading-snug",
              ready ? "text-muted-foreground" : "font-medium text-foreground",
            )}
          >
            {name}
          </span>
          <StatusMark status={target.status} />
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-pretty text-muted-foreground">
          {t(target.descriptionKey)}
        </span>
      </span>
      {ready ? null : (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-foreground">
          {t(ACTION_KEYS[target.action])}
          <HugeiconsIcon
            className="text-muted-foreground/60 transition-colors duration-150 group-hover:text-muted-foreground"
            icon={ExternalLinkIcon}
            size={15}
            strokeWidth={1.75}
          />
        </span>
      )}
    </>
  );

  const shell = cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left",
    "transition-[background-color,border-color,color] duration-150",
  );

  if (ready) {
    return <div className={cn(shell, "border-border/40 bg-muted/20")}>{body}</div>;
  }

  return (
    <a
      className={cn(
        shell,
        "group cursor-pointer border-border/60 bg-muted/40 hover:border-input hover:bg-muted/70",
        "outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--btn-focus-ring)]",
      )}
      href={target.href}
      rel="noreferrer"
      target="_blank"
    >
      {body}
    </a>
  );
}

/** The one-word state next to the name, for the two that are not "go do this". */
function StatusMark({ status }: { readonly status: ConnectStatus }) {
  const t = useT();
  if (status === "ready") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
        {t("chat.connect.ready")}
      </span>
    );
  }
  if (status === "needs_reconnect" || status === "blocked") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={2} />
        {t(status === "blocked" ? "chat.connect.blocked" : "chat.connect.expired")}
      </span>
    );
  }
  return null;
}

const ACTION_KEYS: Record<ConnectAction, string> = {
  connect: "chat.connect.actionConnect",
  configure: "chat.connect.actionConfigure",
  reconnect: "chat.connect.actionReconnect",
  settings: "chat.connect.actionSettings",
  open: "chat.connect.actionOpen",
};
