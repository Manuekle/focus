"use client";

import { useState } from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  GooFilterDefs,
  GooSurface,
  gooItemReveal,
  gooShape,
} from "@/components/ui/goo";
import { GooeyDropdown } from "@/components/ui/gooey-dropdown";
import { ChatInput } from "@/app/_components/chat/chat-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Contact sheet for the goo dropdown, in the same spirit as /dev/scenes: the
 * fall is 190ms, which is too fast to judge live, so every frame of it is laid
 * out at once at a fixed progress.
 */

const FRAMES = [0, 0.12, 0.24, 0.36, 0.5, 0.7, 1];
const ROWS = ["Duplicar", "Renombrar", "Mover a…", "Eliminar"];
const ROW_H = 30;

function Frame({ p }: { p: number }) {
  const id = `goo-frame-${String(p).replace(".", "-")}`;
  const shape = gooShape(p, { triggerHeight: 40, panelHeight: 146 });

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[11px] text-muted-foreground">p = {p.toFixed(2)}</div>
      <div className="relative" style={{ width: 200, height: 210 }}>
        <GooFilterDefs id={id} />
        <GooSurface
          shape={shape}
          filterId={id}
          triggerWidth={200}
          triggerHeight={40}
          sheetWidth={200}
        />

        {/* Trigger fill and label: opaque, on top, outside the filter. */}
        <div className="absolute inset-x-0 top-0 flex h-10 items-center justify-between rounded-[11px] px-3.5 text-sm text-popover-foreground">
          <span>Acciones</span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} className="text-muted-foreground" />
        </div>

        {p > 0 ? (
          <div
            className="absolute left-0 overflow-hidden"
            style={{ top: shape.topEdge, width: 200, height: shape.height, borderRadius: shape.radius }}
          >
            <div className="p-1.5">
              {ROWS.map((row, i) => (
                <div
                  key={row}
                  className="flex items-center rounded-md px-2 text-sm text-popover-foreground"
                  style={{
                    height: ROW_H,
                    opacity: gooItemReveal(shape.height, 6 + i * (ROW_H + 2), ROW_H),
                  }}
                >
                  {row}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function GooContactSheet() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background p-10 pb-[600px] text-foreground">
      <h1 className="text-lg font-medium">Goo dropdown</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Un valor de progreso, dos bordes que caen. El relleno del trigger, sus
        letras y los items van opacos por encima y nunca entran al filtro.
      </p>

      <div className="mt-10 flex flex-wrap gap-10">
        {FRAMES.map((p) => (
          <Frame key={p} p={p} />
        ))}
      </div>

      <div className="mt-16 max-w-2xl space-y-10">
        <div>
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">
            ChatInput — panel hacia abajo (isEmpty)
          </div>
          <ChatInput onSubmit={() => {}} onStop={() => {}} isBusy={false} isEmpty />
        </div>
        <div className="pt-[420px]">
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">
            ChatInput — panel hacia arriba
          </div>
          <ChatInput onSubmit={() => {}} onStop={() => {}} isBusy={false} />
        </div>
      </div>

      <div className="mt-16 flex flex-wrap items-start gap-16">
        <div>
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">GooeyDropdown (vivo)</div>
          <GooeyDropdown
            open={open}
            trigger={
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex h-10 w-[200px] items-center justify-between rounded-[11px] px-3.5 text-sm text-popover-foreground"
              >
                <span>Acciones</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} className="text-muted-foreground" />
              </button>
            }
          >
            {ROWS.map((row) => (
              <div
                key={row}
                className="flex h-[30px] items-center rounded-md px-2 text-sm text-popover-foreground hover:bg-accent"
              >
                {row}
              </div>
            ))}
          </GooeyDropdown>
        </div>

        <div>
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">DropdownMenu (Radix)</div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-10 items-center rounded-[11px] border border-border px-3.5 text-sm">
              Abrir menú
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ROWS.map((row) => (
                <DropdownMenuItem key={row}>{row}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
