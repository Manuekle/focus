"use client";

// components/ai-elements — las piezas de la superficie de chat: estados de
// espera, bloques de razonamiento, llamadas a herramientas y la navegación
// que las rodea.

import { useState } from "react";
import { ct } from "../_lib/catalog-i18n";
import { Button } from "@/components/ui/button";
import { NotificationBadge } from "@/components/ai-elements/notification-badge";
import { Pagination } from "@/components/ai-elements/pagination";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { LicenseCreditCard } from "@/components/ai-elements/license-credit-card";
import { Skeleton, SkeletonAvatar, SkeletonBar } from "@/components/ai-elements/skeleton";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { SuccessCheck } from "@/components/ai-elements/success-check";
import type { LicenseInfo } from "@/lib/license/types";
import type { Section } from "../_lib/types";

// ── Hosts con estado ────────────────────────────────────────────────

function TabsDemo() {
  const [tab, setTab] = useState("todos");
  return (
    <SlidingTabs
      value={tab}
      onValueChange={setTab}
      tabs={[
        { id: "todos", label: "Todos" },
        { id: "abiertos", label: "Abiertos" },
        { id: "humano", label: "Con humano" },
      ]}
    />
  );
}

function PaginationDemo() {
  const [page, setPage] = useState(3);
  const [size, setSize] = useState(25);
  return (
    <Pagination
      page={page}
      pageCount={12}
      pageSize={size}
      onPageChange={setPage}
      onPageSizeChange={setSize}
    />
  );
}

function SkeletonDemo() {
  const [loading, setLoading] = useState(true);
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Skeleton
        isLoading={loading}
        skeleton={
          <div className="flex items-center gap-3">
            <SkeletonAvatar />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBar className="h-3" width="60%" />
              <SkeletonBar className="h-3" width="85%" />
            </div>
          </div>
        }
      >
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">
            MG
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">María G.</p>
            <p className="truncate text-xs text-muted-foreground">
              ¿Tenéis cita para el jueves por la tarde?
            </p>
          </div>
        </div>
      </Skeleton>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setLoading((v) => !v)}>
        {loading ? "Cargar" : "Volver a esqueleto"}
      </Button>
    </div>
  );
}

function SuccessCheckDemo() {
  const [active, setActive] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <SuccessCheck active={active} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setActive(true);
          window.setTimeout(() => setActive(false), 1800);
        }}
      >
        Dibujar
      </Button>
    </div>
  );
}

// ── Licencia ────────────────────────────────────────────────────────
//
// La tarjeta se dibuja sola con lo que le pasás, así que el catálogo no
// necesita `/api/license`: acá van una licencia viva y una vencida.

function licenseFixture(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    status: "valid",
    maintenanceActive: true,
    daysUntilMaintenanceEnds: 214,
    installationMatches: true,
    payload: {
      licenseId: "9f14c2a7-63be-4d10-9d2f-5b81c0e4a733",
      company: "Estudio Bellagamba",
      customerEmail: "hola@bellagamba.ar",
      edition: "enterprise",
      deploymentType: "self-hosted",
      features: [],
      issuedAt: "2026-02-11T00:00:00.000Z",
      maintenanceUntil: "2027-03-01T00:00:00.000Z",
      schemaVersion: 1,
    },
    ...overrides,
  };
}

export function aiElements(_locale?: string): Section {
  return {
  id: "ai-elements",
  title: ct("ai.title"),
  desc: ct("ai.desc"),
  entries: [
    {
      id: "sliding-tabs",
      name: "SlidingTabs",
      source: "components/ai-elements/sliding-tabs.tsx",
      importLine: 'import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";',
      desc: ct("ai.slidingTabs.desc"),
      props: [
        { name: "tabs", type: "readonly SlidingTab[]", required: true, desc: ct("ai.slidingTabs.tabs.desc") },
        { name: "value", type: "string", required: true, desc: ct("ai.slidingTabs.value.desc") },
        { name: "onValueChange", type: "(id: string) => void", required: true, desc: "" },
        { name: "trailing", type: "ReactNode", desc: ct("ai.slidingTabs.trailing.desc") },
      ],
      demos: [
        {
          id: "sliding-tabs-basic",
          title: ct("ai.slidingTabs.title"),
          code: `<SlidingTabs
  value={tab}
  onValueChange={setTab}
  tabs={[{ id: "todos", label: "Todos" }, { id: "abiertos", label: "Abiertos" }]}
/>`,
          render: <TabsDemo />,
        },
      ],
    },
    {
      id: "pagination",
      name: "Pagination",
      source: "components/ai-elements/pagination.tsx",
      importLine: 'import { Pagination } from "@/components/ai-elements/pagination";',
      desc: ct("ai.pagination.desc"),
      props: [
        { name: "page", type: "number", required: true, desc: ct("ai.pagination.page.desc") },
        { name: "pageCount", type: "number", required: true, desc: ct("ai.pagination.pageCount.desc") },
        { name: "onPageChange", type: "(page: number) => void", required: true, desc: "" },
        { name: "pageSize", type: "number", desc: ct("ai.pagination.pageSize.desc") },
        { name: "onPageSizeChange", type: "(size: number) => void", desc: "" },
        { name: "pageSizeOptions", type: "readonly number[]", desc: ct("ai.pagination.pageSizeOptions.desc") },
      ],
      demos: [
        {
          id: "pagination-basic",
          title: ct("ai.pagination.title"),
          code: `<Pagination page={page} pageCount={12} pageSize={size}
  onPageChange={setPage} onPageSizeChange={setSize} />`,
          render: <PaginationDemo />,
        },
      ],
    },
    {
      id: "skeleton",
      name: "Skeleton",
      source: "components/ai-elements/skeleton.tsx",
      importLine: 'import { Skeleton, SkeletonBar, SkeletonAvatar } from "@/components/ai-elements/skeleton";',
      desc: ct("ai.skeleton.desc"),
      exports: [
        "Skeleton",
        "SkeletonBar",
        "SkeletonAvatar",
        "DashboardSkeleton",
        "ChatsSkeleton",
        "AutomationsSkeleton",
        "SettingsSkeleton",
      ],
      props: [
        { name: "isLoading", type: "boolean", required: true, desc: "" },
        { name: "skeleton", type: "ReactNode", required: true, desc: ct("ai.skeleton.skeleton.desc") },
        { name: "children", type: "ReactNode", required: true, desc: ct("ai.skeleton.children.desc") },
        { name: "width (Bar)", type: "string", desc: ct("ai.skeleton.width.desc") },
        { name: "size (Avatar)", type: "string", def: '"size-9"', desc: ct("ai.skeleton.size.desc") },
      ],
      demos: [
        {
          id: "skeleton-basic",
          title: ct("ai.skeleton.title"),
          code: `<Skeleton isLoading={loading} skeleton={<SkeletonBar className="h-3" width="60%" />}>
  <p>María G.</p>
</Skeleton>`,
          render: <SkeletonDemo />,
        },
      ],
    },
    {
      id: "success-check",
      name: "SuccessCheck",
      source: "components/ai-elements/success-check.tsx",
      importLine: 'import { SuccessCheck } from "@/components/ai-elements/success-check";',
      desc: ct("ai.successCheck.desc"),
      props: [
        { name: "active", type: "boolean", required: true, desc: ct("ai.successCheck.active.desc") },
      ],
      demos: [
        {
          id: "success-check-basic",
          title: ct("ai.successCheck.title"),
          code: '<SuccessCheck active={saved} />',
          render: <SuccessCheckDemo />,
        },
      ],
    },
    {
      id: "notification-badge",
      name: "NotificationBadge",
      source: "components/ai-elements/notification-badge.tsx",
      importLine: 'import { NotificationBadge } from "@/components/ai-elements/notification-badge";',
      desc: ct("ai.notificationBadge.desc"),
      props: [
        { name: "count", type: "number", desc: ct("ai.notificationBadge.count.desc") },
      ],
      demos: [
        {
          id: "notification-badge-basic",
          title: ct("ai.notificationBadge.title"),
          code: '<NotificationBadge count={3} />',
          render: (
            <div className="flex items-center gap-6">
              <div className="relative">
                <Button variant="outline" size="icon-sm" aria-label="Conversaciones">
                  ●
                </Button>
                <NotificationBadge count={3} />
              </div>
              <div className="relative">
                <Button variant="outline" size="icon-sm" aria-label="Conversaciones">
                  ●
                </Button>
                <NotificationBadge count={128} />
              </div>
            </div>
          ),
        },
      ],
    },
    {
      id: "reasoning",
      name: "Reasoning",
      source: "components/ai-elements/reasoning.tsx",
      importLine: 'import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";',
      desc: ct("ai.reasoning.desc"),
      exports: ["Reasoning", "ReasoningTrigger", "ReasoningContent", "useReasoning"],
      props: [
        { name: "isStreaming", type: "boolean", def: "false", desc: ct("ai.reasoning.isStreaming.desc") },
        { name: "open / defaultOpen", type: "boolean", desc: ct("ai.reasoning.open.desc") },
        { name: "duration", type: "number", desc: ct("ai.reasoning.duration.desc") },
        { name: "children (Content)", type: "string", required: true, desc: ct("ai.reasoning.children.desc") },
      ],
      demos: [
        {
          id: "reasoning-basic",
          title: ct("ai.reasoning.title"),
          code: `<Reasoning duration={4}>
  <ReasoningTrigger />
  <ReasoningContent>El cliente pregunta por horarios…</ReasoningContent>
</Reasoning>`,
          render: (
            <div className="w-full max-w-lg">
              <Reasoning duration={4}>
                <ReasoningTrigger />
                <ReasoningContent>
                  {"El cliente pregunta por horarios. Miro el calendario del jueves y veo dos huecos libres, así que ofrezco los dos en vez de proponer uno."}
                </ReasoningContent>
              </Reasoning>
            </div>
          ),
        },
      ],
    },
    {
      id: "license-credit-card",
      name: "LicenseCreditCard",
      source: "components/ai-elements/license-credit-card.tsx",
      importLine: 'import { LicenseCreditCard } from "@/components/ai-elements/license-credit-card";',
      desc: ct("ai.licenseCard.desc"),
      exports: ["LicenseCreditCard", "licenseTone"],
      props: [
        { name: "info", type: "LicenseInfo | null", required: true, desc: ct("ai.licenseCard.info.desc") },
        { name: "installationId", type: "string | null", required: true, desc: ct("ai.licenseCard.installationId.desc") },
      ],
      notes: [
        ct("ai.licenseCard.note1"),
        ct("ai.licenseCard.note2"),
        ct("ai.licenseCard.note3"),
        ct("ai.licenseCard.note4"),
      ],
      demos: [
        {
          id: "license-credit-card-active",
          title: ct("ai.licenseCard.active.title"),
          desc: ct("ai.licenseCard.active.desc2"),
          surface: "muted",
          code: `<LicenseCreditCard info={info} installationId={installationId} />`,
          render: (
            <div className="w-full max-w-md">
              <LicenseCreditCard
                info={licenseFixture()}
                installationId="a3f9c1d0-77b2-4e58-9c31-6de0f28a4b17"
              />
            </div>
          ),
        },
        {
          id: "license-credit-card-missing",
          title: ct("ai.licenseCard.missing.title"),
          desc: ct("ai.licenseCard.missing.desc2"),
          surface: "muted",
          code: `<LicenseCreditCard info={null} installationId={id} />`,
          render: (
            <div className="w-full max-w-md">
              <LicenseCreditCard info={null} installationId="a3f9c1d0-77b2-4e58-9c31-6de0f28a4b17" />
            </div>
          ),
        },
      ],
    },
  ],
  };
}
