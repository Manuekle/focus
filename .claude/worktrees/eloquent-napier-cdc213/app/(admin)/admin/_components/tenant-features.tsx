"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/toast-provider";
import type { AdminTenant } from "@/lib/admin-types";
import { FEATURES, type FeatureId } from "@/lib/features";
import type { ModuleId } from "@/lib/modules";
import { useAdminLocale } from "./admin-locale";
import { PUSH_LABEL } from "./tenant-events";

// "Funciones": the operator's switches for one tenant (lib/features.ts).
//
// The app owns the list and each default; the fleet stores only what the
// operator changed and pushes it as runtime configuration, like the plan — a
// switch is seconds, never a release. Off hides a feature's screens, its routes
// and the agent's way into it; its code and its stored data stay, so turning
// it back on finds everything where it was.

export function TenantFeatures({ tenant }: { readonly tenant: AdminTenant }) {
  const router = useRouter();
  const { toast } = useToast();
  const { tr, locale } = useAdminLocale();
  const [busy, setBusy] = useState<FeatureId | null>(null);
  // A fleet older than its migration 013 sends no `features`: nothing to switch yet.
  const supported = tenant.features !== undefined;
  const overrides = tenant.features ?? {};
  const moduleLabel: Record<string, string> = { ads: tr("Anuncios", "Ads"), seo: "SEO" };
  const modules = [...new Set(FEATURES.map((feature) => feature.module))] as ModuleId[];

  const set = async (feature: FeatureId, on: boolean | null) => {
    setBusy(feature);
    const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "feature", feature, on }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { push?: string; message?: string; error?: string } | null;
    setBusy(null);
    const name = FEATURES.find((entry) => entry.id === feature)?.name[locale === "en" ? "en" : "es"] ?? feature;
    if (!response?.ok) {
      toast({
        title: tr("No se pudo", "It didn't work"),
        description: body?.message ?? body?.error ?? tr("El fleet no respondió.", "The fleet did not answer."),
        status: "error",
      });
      return;
    }
    const push = PUSH_LABEL[body?.push ?? ""];
    toast({
      title:
        on === null
          ? tr(`${name}: vuelve al valor por defecto`, `${name}: back to the default`)
          : on
            ? tr(`${name}: activada`, `${name}: on`)
            : tr(`${name}: apagada`, `${name}: off`),
      description: push ? tr(`Resultado: ${push[0]}.`, `Result: ${push[1]}.`) : body?.push,
      status: body?.push === "applied" || body?.push === "unchanged" ? "success" : "warning",
    });
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{tr("Funciones", "Features")}</CardTitle>
          <CardDescription>
            {tr(
              "Partes de un módulo que prendes o apagas para este cliente. Apagada no se ve, no tiene rutas y el agente no la ofrece; el código y los datos se quedan.",
              "Pieces of a module you switch on or off for this customer. Off, it is not shown, has no routes and the agent does not offer it; code and data stay.",
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>
        {!supported ? (
          <p className="mb-4 text-xs text-muted-foreground text-pretty">
            {tr(
              "El fleet todavía no guarda funciones por cliente: corre su migración 013 y despliégalo. Mientras tanto, cada cliente usa los valores por defecto.",
              "The fleet does not store per-customer features yet: run its migration 013 and deploy it. Until then every customer gets the defaults.",
            )}
          </p>
        ) : null}
        <div className="space-y-6">
          {modules.map((module) => (
            <div key={module}>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {moduleLabel[module] ?? module}
              </p>
              <ul className="divide-y divide-border">
                {FEATURES.filter((feature) => feature.module === module).map((feature) => {
                  const overridden = Object.hasOwn(overrides, feature.id);
                  const on = overridden ? overrides[feature.id] === true : feature.defaultOn;
                  const lang = locale === "en" ? "en" : "es";
                  return (
                    <li className="flex items-start gap-4 py-3 first:pt-0 last:pb-0" key={feature.id}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{feature.name[lang]}</p>
                          <StatusBadge
                            label={
                              overridden
                                ? tr("Cambiada por ti", "Set by you")
                                : feature.defaultOn
                                  ? tr("Por defecto: activada", "Default: on")
                                  : tr("Por defecto: apagada", "Default: off")
                            }
                            status={overridden ? "pending" : "draft"}
                          />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{feature.description[lang]}</p>
                        {overridden ? (
                          <button
                            className="mt-1 text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
                            disabled={busy !== null}
                            onClick={() => void set(feature.id, null)}
                            type="button"
                          >
                            {tr("Volver al valor por defecto", "Back to the default")}
                          </button>
                        ) : null}
                      </div>
                      <Switch
                        checked={on}
                        disabled={!supported || busy !== null}
                        label={feature.name[lang]}
                        onCheckedChange={(next) => void set(feature.id, next)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
