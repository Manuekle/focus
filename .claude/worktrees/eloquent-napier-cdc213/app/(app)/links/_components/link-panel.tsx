"use client";

import { ArrowDown01Icon, ArrowUp01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n/provider";
import type { LinkKind, LinkPageItem } from "@/lib/types";
import { KINDS, KIND_ICONS } from "./kinds";
import { Field, PanelShell } from "./panel";

export function LinkPanel({
  index,
  item,
  onChange,
  onMove,
  onRemove,
  total,
}: {
  readonly index: number;
  readonly item: LinkPageItem | null;
  readonly onChange: (id: string, patch: Partial<LinkPageItem>) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onRemove: (id: string) => void;
  readonly total: number;
}) {
  const t = useT();
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-xs text-center text-sm leading-6 text-muted-foreground">{t("links.selectHint")}</p>
      </div>
    );
  }

  const placeholder =
    item.kind === "instagram" || item.kind === "tiktok" || item.kind === "facebook"
      ? "@tuusuario"
      : item.kind === "whatsapp" || item.kind === "phone"
        ? "+57 300 000 0000"
        : item.kind === "email"
          ? "hola@tunegocio.com"
          : "https://";

  return (
    <PanelShell title={item.title || t(`links.kind.${item.kind}`)} description={t("links.linksHint")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Not a `<label>`: a listbox trigger is a button, and a label that
            points at a button points at nothing. */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("links.kind")}</span>
          <Select
            value={item.kind}
            onValueChange={(kind) => onChange(item.id, { kind: kind as LinkKind })}
          >
            <SelectTrigger className="w-full" aria-label={t("links.kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  <HugeiconsIcon icon={KIND_ICONS[kind]} size={15} strokeWidth={1.75} />
                  {t(`links.kind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Field label={t("links.label")}>
          <Input
            value={item.title}
            maxLength={96}
            onChange={(event) => onChange(item.id, { title: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t("links.destination")}>
        <Input
          value={item.destination}
          maxLength={2000}
          placeholder={placeholder}
          onChange={(event) => onChange(item.id, { destination: event.target.value })}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-3">
        <span className="flex items-center gap-2 text-sm">
          <Switch
            checked={item.enabled}
            onCheckedChange={(enabled) => onChange(item.id, { enabled })}
            label={`${t("links.enabled")}: ${item.title || index + 1}`}
          />
          {t("links.enabled")}
        </span>
        <span className="flex items-center gap-2 text-sm">
          <Switch
            checked={item.featured}
            onCheckedChange={(featured) => onChange(item.id, { featured })}
            label={`${t("links.featured")}: ${item.title || index + 1}`}
          />
          {t("links.featured")}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button disabled={index <= 0} onClick={() => onMove(item.id, -1)} size="sm" type="button" variant="outline">
          <HugeiconsIcon icon={ArrowUp01Icon} size={14} strokeWidth={1.8} />
          {t("links.moveUp", { title: "" })}
        </Button>
        <Button
          disabled={index < 0 || index >= total - 1}
          onClick={() => onMove(item.id, 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.8} />
          {t("links.moveDown", { title: "" })}
        </Button>
        <Button className="ml-auto" onClick={() => onRemove(item.id)} size="sm" type="button" variant="ghost">
          <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.8} />
          {t("links.remove", { title: "" })}
        </Button>
      </div>
    </PanelShell>
  );
}
