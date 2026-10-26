"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Delete01Icon,
  Download01Icon,
  PencilEdit01Icon,
  SearchIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMemo, useState } from "react";
import { Card } from "@/app/_components/dashboard-card";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/provider";
import type { ChannelId } from "@/lib/types";
import { AppChrome, HeaderAction } from "./screen-chrome";

/**
 * The inbox, as `app/(app)/inbox/page.tsx` renders it: the two header actions, the
 * search field, and one `Card` per contact — not rows inside a single divided
 * list. Lucía Romero starts expanded by default.
 *
 * Typing filters, the chevron toggles expansion, and `Reanudar` is inert.
 * Edit/delete remain in the expanded detail.
 */

type Contact = {
  readonly attributes?: Readonly<Record<string, string>>;
  readonly channel: ChannelId;
  readonly email: string;
  readonly lastMessage: string;
  readonly name: string;
  readonly notes: string;
  readonly phone: string;
  readonly source: string;
  readonly status: "waiting_human" | "followup_due";
  readonly when: string;
};

/**
 * `status` is a real `ContactStatus`. The page only ever lists contacts the
 * bot has stopped answering, so the two that appear are `waiting_human` and
 * `followup_due` — and the chip over the name says `Derivación` / `Seguimiento`,
 * which is the pair of words the row actually prints. The longer
 * `inbox.statusWaitingHuman` wording belongs to the status `Select` inside the
 * expanded card, where it is used below.
 */
function useContacts(t: (key: string) => string): readonly Contact[] {
  return [
    {
      attributes: { zona: "Palermo", presupuesto: "$120.000" },
      channel: "whatsapp",
      email: "maria.fernandez@example.com",
      lastMessage: t("landing.demo.msg.maria"),
      name: "María Fernández",
      notes: t("landing.demo.note.maria"),
      phone: "+54 9 11 4021-8871",
      source: "whatsapp",
      status: "followup_due",
      when: "2m",
    },
    {
      channel: "instagram",
      email: "lucia.romero@example.com",
      lastMessage: t("landing.demo.msg.lucia"),
      name: "Lucía Romero",
      notes: t("landing.demo.note.lucia"),
      phone: "+54 9 341 615-2290",
      source: "instagram",
      status: "waiting_human",
      when: "6m",
    },
    {
      channel: "whatsapp",
      email: "carlos.ruiz@example.com",
      lastMessage: t("landing.demo.msg.carlos"),
      name: "Carlos Ruiz",
      notes: t("landing.demo.note.carlos"),
      phone: "+54 9 11 3388-0142",
      source: "whatsapp",
      status: "waiting_human",
      when: "11m",
    },
    {
      channel: "instagram",
      email: "diego.salas@example.com",
      lastMessage: t("landing.demo.msg.diego"),
      name: "Diego Salas",
      notes: t("landing.demo.note.diego"),
      phone: "+54 9 11 2277-6630",
      source: "instagram",
      status: "followup_due",
      when: "24m",
    },
    {
      channel: "whatsapp",
      email: "paula.ibanez@example.com",
      lastMessage: t("landing.demo.msg.paula"),
      name: "Paula Ibáñez",
      notes: t("landing.demo.note.paula"),
      phone: "+54 9 11 5540-9917",
      source: "whatsapp",
      status: "waiting_human",
      when: "38m",
    },
    {
      channel: "instagram",
      email: "tomas.aguirre@example.com",
      lastMessage: t("landing.demo.msg.tomas"),
      name: "Tomás Aguirre",
      notes: t("landing.demo.note.tomas"),
      phone: "+54 9 11 6690-3312",
      source: "instagram",
      status: "followup_due",
      when: "52m",
    },
  ];
}

export function InboxScreen() {
  const t = useT();
  const reduced = useReducedMotion();
  const contacts = useContacts(t);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>("Lucía Romero");

  // The page's own filter: name, phone, email or note, lower-cased.
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(query) ||
        contact.phone.includes(query) ||
        contact.email.toLowerCase().includes(query) ||
        contact.notes.toLowerCase().includes(query),
    );
  }, [search, contacts]);

  return (
    <AppChrome
      active="/inbox"
      title={t("inbox.title")}
      subtitle={t("inbox.subtitle")}
      actions={
        <div className="flex items-center gap-2">
          <HeaderAction icon={Download01Icon} labelBelowSm>
            CSV
          </HeaderAction>
          <HeaderAction icon={Add01Icon} labelBelowSm>
            {t("inbox.createContact")}
          </HeaderAction>
        </div>
      }
    >
      <div className="relative mb-4">
        <HugeiconsIcon
          icon={SearchIcon}
          size={16}
          strokeWidth={1.75}
          className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("inbox.search")}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={UserIcon} size={20} strokeWidth={1.75} />
            </div>
            <p className="font-medium text-sm">{t("inbox.empty")}</p>
            <p className="max-w-xs text-muted-foreground text-xs">{t("inbox.emptyHint")}</p>
          </div>
        </Card>
      ) : (
        // Demo scope: no checkbox / select-all / bulk bar / Pagination here.
        // The real page has them (`app/(app)/inbox/page.tsx`), but in a
        // 608px-tall mockup they are noise over six static rows — selection
        // state with nowhere to send it. Deliberately omitted, not drift.
        <div className="space-y-2">
          {filtered.map((contact) => {
            const isExpanded = expanded === contact.name;
            const attrs = Object.entries(contact.attributes ?? {});
            return (
              <Card key={contact.name}>
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)] sm:size-10">
                    <ChannelIcon channel={contact.channel} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Name alone here, like the real row: the `StatusBadge`
                        lives in its own column on `sm+` and inline below only
                        on mobile. The pill used to sit next to the name at
                        every width, which the page never does. */}
                    <p className="truncate font-medium text-sm">{contact.name}</p>
                    <p className="truncate text-muted-foreground text-xs">{contact.lastMessage}</p>
                    {/* Status badge inline on mobile below the name */}
                    <div className="mt-1 sm:hidden">
                      <StatusBadge
                        label={contact.status === "followup_due" ? t("inbox.followup") : t("inbox.handoff")}
                        status={contact.status === "followup_due" ? "pending" : "warning"}
                      />
                    </div>
                  </div>
                  {/* Status badge — only visible sm+ (shown inline on mobile above) */}
                  <div className="hidden shrink-0 sm:flex sm:min-w-[110px] sm:items-center sm:justify-center">
                    <StatusBadge
                      label={contact.status === "followup_due" ? t("inbox.followup") : t("inbox.handoff")}
                      status={contact.status === "followup_due" ? "pending" : "warning"}
                    />
                  </div>
                  <span className="hidden text-muted-foreground text-xs sm:block">{contact.when}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setExpanded(isExpanded ? null : contact.name)}
                    aria-label={contact.name}
                  >
                    <span className="t-icon-swap" data-state={isExpanded ? "b" : "a"}>
                      <span className="t-icon" data-icon="a">
                        <HugeiconsIcon icon={ChevronDownIcon} size={14} strokeWidth={1.75} />
                      </span>
                      <span className="t-icon" data-icon="b">
                        <HugeiconsIcon icon={ChevronUpIcon} size={14} strokeWidth={1.75} />
                      </span>
                    </span>
                  </Button>
                  {/* Icon-only below `sm`, the way the page's own header
                      actions collapse there. The label is 90 of the 350
                      pixels a 390px row has, and the row spends them before
                      it gets to the contact's name. */}
                  <Button aria-label={t("inbox.resume")} size="sm" variant="outline">
                    <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={1.75} />
                    <span className="hidden sm:inline">{t("inbox.resume")}</span>
                  </Button>
                </div>

                {isExpanded ? (
                  <motion.div
                    initial={false}
                    animate={{ height: "auto", opacity: 1 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 300, damping: 25, mass: 0.8 }
                    }
                    style={{ overflow: "hidden" }}
                  >
                    <div className="space-y-2 border-border border-t px-5 py-3 text-muted-foreground text-xs">
                      {/* Conditional like the real detail: no empty lines when
                          a field is missing. Edit mode stays out — demo rows
                          are inert, Edit/Delete go nowhere. */}
                      {/* `suppressHydrationWarning`: browsers/extensions with
                          phone detection (Safari unless the page opts out via
                          `format-detection`, Skype click-to-call, …) rewrite
                          the number into `<a href="tel:…">` before hydration.
                          The text is static mock data; keep their DOM. */}
                      {contact.phone ? (
                        <p suppressHydrationWarning>
                          {t("inbox.phone")}: {contact.phone}
                        </p>
                      ) : null}
                      {contact.email ? (
                        <p>
                          {t("inbox.email")}: {contact.email}
                        </p>
                      ) : null}
                      <p>
                        {t("inbox.source")}: {contact.source}
                      </p>
                      <p>
                        {t("inbox.status")}: {contact.status}
                      </p>
                      {contact.notes ? (
                        <p>
                          {t("inbox.notes")}: {contact.notes}
                        </p>
                      ) : null}
                      {attrs.length > 0 ? (
                        <div className="mt-2">
                          <p className="font-medium text-foreground">{t("inbox.attributes")}:</p>
                          {attrs.map(([k, v]) => (
                            <p key={k}>
                              {k}: {v}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex gap-2 border-t border-border pt-2">
                        <Button size="sm" variant="outline">
                          <HugeiconsIcon icon={PencilEdit01Icon} size={14} strokeWidth={1.75} />
                          {t("inbox.edit")}
                        </Button>
                        <Button size="sm" variant="destructive">
                          <HugeiconsIcon icon={Delete01Icon} size={14} strokeWidth={1.75} />
                          {t("inbox.delete")}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </AppChrome>
  );
}
