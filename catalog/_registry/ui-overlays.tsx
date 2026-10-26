"use client";

// components/ui — todo lo que se abre encima: diálogos, menús, tooltips.
// Casi todos son un envoltorio fino sobre Radix, así que la API real es la de
// Radix; lo que aporta el envoltorio es la superficie, la animación de entrada
// (`t-dropdown`, `t-dialog` en globals.css) y el cue de sonido.

import { useState } from "react";
import { ct } from "../_lib/catalog-i18n";
import { HugeiconsIcon } from "../../components/icons/icon";
import {
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { Beam } from "../../components/ui/beam";
import { Button } from "../../components/ui/button";
import { ActionSwapRollText } from "../../components/motion/action-swap-roll";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../../components/ui/command";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ErrorBanner } from "../../components/ui/error-banner";
import { Alert } from "../../components/ui/alert";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../components/ui/hover-card";
import { Input } from "../../components/ui/input";
import { Orb } from "../../components/ui/orb";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import type { OrbState } from "../../components/ui/orb";
import type { Section } from "../_lib/types";

// ── Hosts con estado ────────────────────────────────────────────────

function CollapsibleDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full max-w-md">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          <ActionSwapRollText value={open ? "hide" : "show"}>
            {open ? "Ocultar" : "Ver"}
          </ActionSwapRollText>{" "}
          la carga útil
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 rounded-lg border border-border bg-muted/60 p-3 font-mono text-[11px]">
{`{ "channel": "whatsapp", "from": "+34…" }`}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AlertDemo() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Alert tone="error" title="No se pudo cobrar la suscripción" onDismiss={() => {}}>
        La tarjeta fue rechazada. Actualizá el método de pago para no perder el servicio.
      </Alert>
      <Alert tone="warning" title="Falta configurar el webhook" onDismiss={() => {}}>
        El canal está conectado pero todavía no recibe mensajes.
      </Alert>
      <Alert tone="success" title="Instagram conectado" onDismiss={() => {}}>
        @oruka.si ya recibe mensajes y responde la Recepcionista IA.
      </Alert>
      <Alert tone="info" title="Nueva versión disponible" onDismiss={() => {}}>
        Recargá la página para usar la última versión.
      </Alert>
      <Alert tone="warning" size="sm">
        Versión compacta para diálogos y paneles estrechos.
      </Alert>
    </div>
  );
}

function ErrorBannerDemo() {
  const [visible, setVisible] = useState(true);
  return visible ? (
    <ErrorBanner
      message="No se pudo guardar el agente."
      detail="upstream timeout tras 30 s"
      onRetry={() => {}}
      onDismiss={() => setVisible(false)}
      className="w-full max-w-lg"
    />
  ) : (
    <Button variant="outline" size="sm" onClick={() => setVisible(true)}>
      Volver a mostrar
    </Button>
  );
}

/**
 * cmdk selects its first row as soon as the list mounts and scrolls that row
 * into view — which, on a page this tall, yanks the reader from the top of the
 * catalog down to here. So the inline variant mounts on demand; the palette
 * below is the shape the app actually ships (ModelPicker) and only mounts when
 * it is opened anyway.
 */
function CommandInlineDemo() {
  const [mounted, setMounted] = useState(false);

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" onClick={() => setMounted(true)}>
        Montar el buscador
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-border">
      <Command>
        <CommandInput placeholder="Buscar…" />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>
          <CommandGroup heading="Ir a">
            <CommandItem>
              Panel
              <CommandShortcut>⌘1</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Conversaciones
              <CommandShortcut>⌘2</CommandShortcut>
            </CommandItem>
            <CommandItem>Automatizaciones</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Acciones">
            <CommandItem>Crear agente</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

function CommandDialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Abrir la paleta
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Paleta de comandos">
        <CommandInput placeholder="Buscar…" />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>
          <CommandGroup heading="Ir a">
            <CommandItem>Panel</CommandItem>
            <CommandItem>Conversaciones</CommandItem>
            <CommandItem>Automatizaciones</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Acciones">
            <CommandItem>Crear agente</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

const ORB_STATES: readonly OrbState[] = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "composing",
  "breathing",
  "shaping",
];

// ── Sección ─────────────────────────────────────────────────────────

export function uiOverlays(_locale?: string): Section {
  return {
  id: "ui-overlays",
  title: ct("overlays.title"),
  desc: ct("overlays.desc"),
  entries: [
    {
      id: "dialog",
      name: "Dialog",
      source: "components/ui/dialog.tsx",
      importLine: 'import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@focus/ui/ui/dialog";',
      desc: ct("overlays.dialog.desc"),
      exports: [
        "Dialog",
        "DialogTrigger",
        "DialogPortal",
        "DialogOverlay",
        "DialogContent",
        "DialogHeader",
        "DialogFooter",
        "DialogTitle",
        "DialogDescription",
        "DialogClose",
        "DialogBody",
        "DialogCancel",
        "DialogShortcut",
        "useDialogOpenCue",
      ],
      props: [
        { name: "open / onOpenChange", type: "boolean / (open: boolean) => void", desc: ct("overlays.dialog.open.desc") },
        { name: "showCloseButton", type: "boolean", def: "true", desc: ct("overlays.dialog.showClose.desc") },
      ],
      notes: [
        ct("overlays.dialog.note1"),
        ct("overlays.dialog.note2"),
      ],
      demos: [
        {
          id: "dialog-basic",
          title: ct("overlays.dialog.title"),
          code: `<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Editar agente</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle icon={<HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} />}>
        Editar agente
      </DialogTitle>
      <DialogDescription>Cambia el nombre con el que responde.</DialogDescription>
    </DialogHeader>
    <Input defaultValue="Agente de ventas" />
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">Cancelar</Button>
      </DialogClose>
      <Button>Guardar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
          render: (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Editar agente</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle icon={<HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} />}>
                    Editar agente
                  </DialogTitle>
                  <DialogDescription>Cambia el nombre con el que responde.</DialogDescription>
                </DialogHeader>
                <Input defaultValue="Agente de ventas" />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancelar</Button>
                  </DialogClose>
                  <Button>Guardar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ),
        },
      ],
    },
    {
      id: "alert-dialog",
      name: "AlertDialog",
      source: "components/ui/alert-dialog.tsx",
      importLine: 'import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@focus/ui/ui/alert-dialog";',
      desc: ct("overlays.alertDialog.desc"),
      exports: [
        "AlertDialog",
        "AlertDialogTrigger",
        "AlertDialogContent",
        "AlertDialogHeader",
        "AlertDialogFooter",
        "AlertDialogTitle",
        "AlertDialogDescription",
        "AlertDialogAction",
        "AlertDialogCancel",
      ],
      notes: [
        ct("overlays.alertDialog.note"),
      ],
      demos: [
        {
          id: "alert-dialog-basic",
          title: ct("overlays.alertDialog.title"),
          code: `<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Eliminar</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle icon={<HugeiconsIcon icon={Delete02Icon} size={18} strokeWidth={1.75} />}>
        ¿Eliminar el agente?
      </AlertDialogTitle>
      <AlertDialogDescription>
        Se borran también sus conversaciones. No se puede deshacer.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction>Eliminar</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>`,
          render: (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Eliminar</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle icon={<HugeiconsIcon icon={Delete02Icon} size={18} strokeWidth={1.75} />}>
                    ¿Eliminar el agente?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Se borran también sus conversaciones. No se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction>Eliminar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ),
        },
      ],
    },
    {
      id: "dropdown-menu",
      name: "DropdownMenu",
      source: "components/ui/dropdown-menu.tsx",
      importLine: 'import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@focus/ui/ui/dropdown-menu";',
      desc: ct("overlays.dropdownMenu.desc"),
      exports: [
        "DropdownMenu",
        "DropdownMenuTrigger",
        "DropdownMenuContent",
        "DropdownMenuGroup",
        "DropdownMenuLabel",
        "DropdownMenuItem",
        "DropdownMenuCheckboxItem",
        "DropdownMenuRadioGroup",
        "DropdownMenuRadioItem",
        "DropdownMenuSeparator",
        "DropdownMenuShortcut",
        "DropdownMenuSub",
        "DropdownMenuSubTrigger",
        "DropdownMenuSubContent",
      ],
      props: [
        { name: "variant (Item)", type: '"default" | "destructive"', def: '"default"', desc: ct("overlays.dropdownMenu.variant.desc") },
        { name: "inset (Item, Label)", type: "boolean", desc: ct("overlays.dropdownMenu.inset.desc") },
      ],
      demos: [
        {
          id: "dropdown-basic",
          title: ct("overlays.dropdownMenu.title"),
          code: `<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Acciones">
      <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuLabel>Agente</DropdownMenuLabel>
    <DropdownMenuItem>Editar<DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
    <DropdownMenuItem>Duplicar</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Eliminar</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`,
          render: (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Acciones">
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={1.75} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Agente</DropdownMenuLabel>
                <DropdownMenuItem>
                  <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.75} />
                  Editar
                  <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.75} />
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.75} />
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
      ],
    },
    {
      id: "context-menu",
      name: "ContextMenu",
      source: "components/ui/context-menu.tsx",
      importLine: 'import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@focus/ui/ui/context-menu";',
      desc: ct("overlays.contextMenu.desc"),
      exports: [
        "ContextMenu",
        "ContextMenuTrigger",
        "ContextMenuContent",
        "ContextMenuItem",
        "ContextMenuLabel",
        "ContextMenuSeparator",
      ],
      demos: [
        {
          id: "context-menu-basic",
          title: ct("overlays.contextMenu.title"),
          code: `<ContextMenu>
  <ContextMenuTrigger>…</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem>Marcar como leído</ContextMenuItem>
    <ContextMenuItem variant="destructive">Archivar</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>`,
          render: (
            <ContextMenu>
              <ContextMenuTrigger className="grid h-24 w-full max-w-sm place-items-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                Clic derecho aquí
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuLabel>Conversación</ContextMenuLabel>
                <ContextMenuItem>Marcar como leída</ContextMenuItem>
                <ContextMenuItem>Asignar a humano</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive">Archivar</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ),
        },
      ],
    },
    {
      id: "select",
      name: "Select",
      source: "components/ui/select.tsx",
      importLine: 'import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@focus/ui/ui/select";',
      desc: ct("overlays.select.desc"),
      exports: [
        "Select",
        "SelectTrigger",
        "SelectValue",
        "SelectContent",
        "SelectGroup",
        "SelectLabel",
        "SelectItem",
        "SelectSeparator",
        "SelectScrollUpButton",
        "SelectScrollDownButton",
      ],
      props: [
        { name: "size (Trigger)", type: '"default" | "sm"', def: '"default"', desc: ct("overlays.select.size.desc") },
        { name: "value / onValueChange", type: "string / (value: string) => void", desc: ct("overlays.select.value.desc") },
      ],
      demos: [
        {
          id: "select-basic",
          title: ct("overlays.select.title"),
          code: `<Select defaultValue="opus">
  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Anthropic</SelectLabel>
      <SelectItem value="opus">Claude Opus 5</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>`,
          render: (
            <>
              <Select defaultValue="opus">
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Anthropic</SelectLabel>
                    <SelectItem value="opus">Claude Opus 5</SelectItem>
                    <SelectItem value="sonnet">Claude Sonnet 5</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Google</SelectLabel>
                    <SelectItem value="gemini">Gemini</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select defaultValue="es">
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </>
          ),
        },
      ],
    },
    {
      id: "command",
      name: "Command",
      source: "components/ui/command.tsx",
      importLine: 'import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@focus/ui/ui/command";',
      desc: ct("overlays.command.desc"),
      exports: [
        "Command",
        "CommandDialog",
        "CommandInput",
        "CommandList",
        "CommandEmpty",
        "CommandGroup",
        "CommandItem",
        "CommandShortcut",
        "CommandSeparator",
      ],
      notes: [
        ct("overlays.command.note"),
      ],
      demos: [
        {
          id: "command-dialog",
          title: ct("overlays.command.dialog.title"),
          desc: ct("overlays.command.dialog.desc"),
          code: `<CommandDialog open={open} onOpenChange={setOpen} title="Paleta de comandos">
  <CommandInput placeholder="Buscar…" />
  <CommandList>
    <CommandEmpty>Sin resultados.</CommandEmpty>
    <CommandGroup heading="Ir a">
      <CommandItem>Panel</CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>`,
          render: <CommandDialogDemo />,
        },
        {
          id: "command-inline",
          title: ct("overlays.command.inline.title"),
          desc: ct("overlays.command.inline.desc"),
          code: `<Command>
  <CommandInput placeholder="Buscar…" />
  <CommandList>
    <CommandEmpty>Sin resultados.</CommandEmpty>
    <CommandGroup heading="Ir a">
      <CommandItem>Panel<CommandShortcut>⌘1</CommandShortcut></CommandItem>
    </CommandGroup>
  </CommandList>
</Command>`,
          render: <CommandInlineDemo />,
        },
      ],
    },
    {
      id: "tooltip",
      name: "Tooltip",
      source: "components/ui/tooltip.tsx",
      importLine: 'import { Tooltip, TooltipContent, TooltipTrigger } from "@focus/ui/ui/tooltip";',
      desc: ct("overlays.tooltip.desc"),
      exports: ["Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider"],
      props: [
        { name: "side (Content)", type: '"top" | "right" | "bottom" | "left"', def: '"top"', desc: "" },
        { name: "sideOffset (Content)", type: "number", desc: ct("overlays.tooltip.sideOffset.desc") },
      ],
      notes: [
        ct("overlays.tooltip.note"),
      ],
      demos: [
        {
          id: "tooltip-basic",
          title: ct("overlays.tooltip.title"),
          code: `<Tooltip>
  <TooltipTrigger asChild><Button variant="outline">Arriba</Button></TooltipTrigger>
  <TooltipContent>Se envía en cuanto entra el mensaje</TooltipContent>
</Tooltip>`,
          render: (
            <>
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <Tooltip key={side}>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">{side}</Button>
                  </TooltipTrigger>
                  <TooltipContent side={side}>Se envía al entrar el mensaje</TooltipContent>
                </Tooltip>
              ))}
            </>
          ),
        },
      ],
    },
    {
      id: "hover-card",
      name: "HoverCard",
      source: "components/ui/hover-card.tsx",
      importLine: 'import { HoverCard, HoverCardContent, HoverCardTrigger } from "@focus/ui/ui/hover-card";',
      desc: ct("overlays.hoverCard.desc"),
      exports: ["HoverCard", "HoverCardTrigger", "HoverCardContent"],
      demos: [
        {
          id: "hover-card-basic",
          title: ct("overlays.hoverCard.title"),
          code: `<HoverCard>
  <HoverCardTrigger asChild><Button variant="link">@ventas</Button></HoverCardTrigger>
  <HoverCardContent>…</HoverCardContent>
</HoverCard>`,
          render: (
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button variant="link">Agente de ventas</Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-64">
                <p className="text-sm font-medium">Agente de ventas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  WhatsApp e Instagram · 1.284 conversaciones este mes.
                </p>
              </HoverCardContent>
            </HoverCard>
          ),
        },
      ],
    },
    {
      id: "collapsible",
      name: "Collapsible",
      source: "components/ui/collapsible.tsx",
      importLine: 'import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@focus/ui/ui/collapsible";',
      desc: ct("overlays.collapsible.desc"),
      exports: ["Collapsible", "CollapsibleTrigger", "CollapsibleContent"],
      demos: [
        {
          id: "collapsible-basic",
          title: ct("overlays.collapsible.title"),
          code: `const [open, setOpen] = useState(false);

<Collapsible open={open} onOpenChange={setOpen}>
  <CollapsibleTrigger asChild><Button variant="outline" size="sm">Ver</Button></CollapsibleTrigger>
  <CollapsibleContent>…</CollapsibleContent>
</Collapsible>`,
          render: <CollapsibleDemo />,
        },
      ],
    },
    {
      id: "alert",
      name: "Alert",
      source: "components/ui/alert.tsx",
      importLine: 'import { Alert } from "@focus/ui/ui/alert";',
      desc: ct("overlays.alert.desc"),
      props: [
        { name: "tone", type: '"error" | "warning" | "success" | "info"', required: true, desc: ct("overlays.alert.tone.desc") },
        { name: "title", type: "ReactNode", desc: ct("overlays.alert.title.desc") },
        { name: "action", type: "ReactNode", desc: ct("overlays.alert.action.desc") },
        { name: "onDismiss", type: "() => void", desc: ct("overlays.alert.onDismiss.desc") },
        { name: "size", type: '"sm" | "md"', def: '"md"', desc: ct("overlays.alert.size.desc") },
        { name: "role", type: '"status" | "alert" | null', def: '"status"', desc: ct("overlays.alert.role.desc") },
      ],
      demos: [
        {
          id: "alert-tones",
          title: ct("overlays.alert.demoTitle"),
          code: `<Alert tone="warning" title="Falta configurar el webhook">
  El canal está conectado pero todavía no recibe mensajes.
</Alert>`,
          render: <AlertDemo />,
        },
      ],
    },
    {
      id: "error-banner",
      name: "ErrorBanner",
      source: "components/ui/error-banner.tsx",
      importLine: 'import { ErrorBanner } from "@focus/ui/ui/error-banner";',
      desc: ct("overlays.errorBanner.desc"),
      props: [
        { name: "error", type: "UiError | null", desc: ct("overlays.errorBanner.error.desc") },
        { name: "messageKey", type: "string | null", desc: ct("overlays.errorBanner.messageKey.desc") },
        { name: "message", type: "string | null", desc: ct("overlays.errorBanner.message.desc") },
        { name: "detail", type: "string", desc: ct("overlays.errorBanner.detail.desc") },
        { name: "onRetry", type: "() => void", desc: ct("overlays.errorBanner.onRetry.desc") },
        { name: "onDismiss", type: "() => void", desc: ct("overlays.errorBanner.onDismiss.desc") },
      ],
      demos: [
        {
          id: "error-banner-basic",
          title: ct("overlays.errorBanner.title"),
          code: `<ErrorBanner
  error={error}
  onRetry={reload}
  onDismiss={() => setError(null)}
/>`,
          render: <ErrorBannerDemo />,
        },
      ],
    },
    {
      id: "orb",
      name: "Orb",
      source: "components/ui/orb.tsx",
      importLine: 'import { Orb } from "@focus/ui/ui/orb";',
      desc: ct("overlays.orb.desc"),
      props: [
        { name: "state", type: "OrbState", required: true, desc: ct("overlays.orb.state.desc") },
        { name: "size", type: "20 | 64", def: "20", desc: ct("overlays.orb.size.desc") },
        { name: "decorative", type: "boolean", def: "true", desc: ct("overlays.orb.decorative.desc") },
      ],
      demos: [
        {
          id: "orb-states",
          title: ct("overlays.orb.states.title"),
          code: '<Orb state="composing" />',
          render: (
            <div className="grid w-full grid-cols-3 gap-4 sm:grid-cols-5">
              {ORB_STATES.map((state) => (
                <div key={state} className="flex flex-col items-center gap-1.5">
                  <Orb state={state} />
                  <span className="font-mono text-[10.5px] text-muted-foreground">{state}</span>
                </div>
              ))}
            </div>
          ),
        },
        {
          id: "orb-large",
          title: ct("overlays.orb.large.title"),
          code: '<Orb state="composing" size={64} />',
          render: <Orb state="composing" size={64} />,
        },
      ],
    },
    {
      id: "beam",
      name: "Beam",
      source: "components/ui/beam.tsx",
      importLine: 'import { Beam } from "@focus/ui/ui/beam";',
      desc: ct("overlays.beam.desc"),
      props: [
        { name: "size", type: '"sm" | "md" | "line" | "pulse-inner" | "pulse-outside"', def: '"pulse-outside"', desc: ct("overlays.beam.size.desc") },
        { name: "colorVariant", type: '"colorful" | "mono" | "ocean" | "sunset"', desc: ct("overlays.beam.color.desc") },
        { name: "strength", type: "number", def: "0.55", desc: ct("overlays.beam.strength.desc") },
        { name: "active", type: "boolean", def: "true", desc: ct("overlays.beam.active.desc") },
        { name: "borderRadius", type: "number", desc: ct("overlays.beam.borderRadius.desc") },
      ],
      notes: [
        ct("overlays.beam.note"),
      ],
      demos: [
        {
          id: "beam-button",
          title: ct("overlays.beam.title"),
          code: `<Beam strength={0.5}>
  <Button variant="outline">Conectar WhatsApp</Button>
</Beam>`,
          surface: "page",
          render: (
            <div className="p-4">
              <Beam strength={0.5}>
                <Button variant="outline">Conectar WhatsApp</Button>
              </Beam>
            </div>
          ),
        },
      ],
    },
  ],
};
}
