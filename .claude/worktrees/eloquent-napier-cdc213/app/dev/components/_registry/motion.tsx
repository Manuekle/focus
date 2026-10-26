"use client";

// components/motion — la capa con física. Todo lo de aquí respeta
// prefers-reduced-motion; varios además dejan de animar en cuanto el puntero
// no es un ratón (use-hover-capable), porque un hover en táctil no existe.

import { useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Mail02Icon } from "@hugeicons/core-free-icons";
import { ActionSwapButton } from "@/components/motion/action-swap";
import { Checkbox } from "@/components/motion/checkbox";
import { DownloadAnimation } from "@/components/motion/download-animation";
import { Input as MotionInput } from "@/components/motion/input";
import { RadioGroup, RadioGroupItem } from "@/components/motion/radio";
import { TextReveal } from "@/components/motion/text-reveal";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { ThinkingText } from "@/components/motion/thinking-text";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import type { Section } from "../_lib/types";
import { ct } from "../_lib/catalog-i18n";

// ── Hosts con estado ────────────────────────────────────────────────

function CheckboxDemo() {
  const [checked, setChecked] = useState(true);
  const [partial, setPartial] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Checkbox checked={checked} onCheckedChange={setChecked} label="Responder fuera de horario" />
      <Checkbox
        checked={partial}
        onCheckedChange={setPartial}
        indeterminate={!partial}
        label="Algunos canales activos"
      />
      <Checkbox checked disabled onCheckedChange={() => {}} label="Bloqueado" />
    </div>
  );
}

function RadioDemo() {
  const [value, setValue] = useState("auto");
  return (
    <RadioGroup value={value} onValueChange={setValue}>
      <RadioGroupItem value="auto" label="Responder siempre" />
      <RadioGroupItem value="hours" label="Solo en horario" />
      <RadioGroupItem value="off" label="Nunca" disabled />
    </RadioGroup>
  );
}

function MotionInputDemo() {
  const [value, setValue] = useState("");
  const invalid = value.length > 0 && !value.includes("@");
  return (
    <div className="w-full max-w-sm">
      <MotionInput
        label="Correo"
        value={value}
        onChange={setValue}
        error={invalid ? "Eso no parece un correo." : false}
        success={value.includes("@")}
        leftIcon={<HugeiconsIcon icon={Mail02Icon} size={16} strokeWidth={1.75} />}
        placeholder="nombre@empresa.com"
      />
    </div>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() =>
          toast({
            title: "Guardado",
            description: "Los cambios se sincronizaron con el servidor.",
            status: "success",
          })
        }
      >
        success
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          toast({
            title: "Sincronizando…",
            description: "Esto puede tardar unos segundos.",
            status: "loading",
          })
        }
      >
        loading
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          toast({
            title: "No se pudo conectar",
            description: "Revisa el App Secret en Ajustes.",
            status: "error",
          })
        }
      >
        error
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          toast({
            title: "Falta un dato",
            description: "El canal recibe mensajes, pero no puede agendar sin la zona horaria.",
            status: "warning",
          })
        }
      >
        warning
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          toast({
            title: "Nada que hacer",
            description: "No hay elementos pendientes por procesar.",
            status: "info",
          })
        }
      >
        info
      </Button>
    </div>
  );
}

function DownloadAnimationDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <DownloadAnimation
        fileType="csv"
        onDownload={() => toast({ title: "Descargado", description: "reporte.csv", status: "success" })}
      >
        <Button size="sm" variant="outline">
          Descargar CSV
        </Button>
      </DownloadAnimation>
      <DownloadAnimation
        fileType="pdf"
        onDownload={() => toast({ title: "Descargado", description: "informe.pdf", status: "success" })}
      >
        <Button size="sm" variant="outline">
          Descargar PDF
        </Button>
      </DownloadAnimation>
      <DownloadAnimation
        fileType="default"
        onDownload={() => toast({ title: "Descargado", description: "datos.xlsx", status: "success" })}
      >
        <Button size="sm" variant="outline">
          Descargar archivo
        </Button>
      </DownloadAnimation>
    </div>
  );
}

// ── Sección ─────────────────────────────────────────────────────────

export function motionSection(_locale?: string): Section {
  return {
  id: "motion",
  title: ct("motion.title"),
  desc: ct("motion.desc"),
  entries: [
    {
      id: "motion-checkbox",
      name: "Checkbox",
      source: "components/motion/checkbox.tsx",
      importLine: 'import { Checkbox } from "@/components/motion/checkbox";',
      desc: ct("motion.checkbox.desc"),
      props: [
        { name: "checked", type: "boolean", required: true, desc: ct("motion.checkbox.checked.desc") },
        { name: "onCheckedChange", type: "(checked: boolean) => void", required: true, desc: "" },
        { name: "indeterminate", type: "boolean", desc: ct("motion.checkbox.indeterminate.desc") },
        { name: "label", type: "ReactNode", desc: ct("motion.checkbox.label.desc") },
        { name: "disabled", type: "boolean", desc: "" },
        { name: 'aria-describedby', type: "string", desc: ct("motion.checkbox.aria.desc") },
      ],
      demos: [
        {
          id: "motion-checkbox-basic",
          title: ct("motion.checkbox.title"),
          code: `const [checked, setChecked] = useState(true);

<Checkbox checked={checked} onCheckedChange={setChecked} label="Responder fuera de horario" />`,
          render: <CheckboxDemo />,
        },
      ],
    },
    {
      id: "motion-radio",
      name: "RadioGroup",
      source: "components/motion/radio.tsx",
      importLine: 'import { RadioGroup, RadioGroupItem } from "@/components/motion/radio";',
      desc: ct("motion.radio.desc"),
      exports: ["RadioGroup", "RadioGroupItem"],
      props: [
        { name: "value / defaultValue", type: "string", desc: ct("motion.radio.value.desc") },
        { name: "onValueChange", type: "(value: string) => void", desc: "" },
        { name: "orientation", type: '"vertical" | "horizontal"', def: '"vertical"', desc: "" },
        { name: "value (Item)", type: "string", required: true, desc: "" },
        { name: "label (Item)", type: "string", desc: "" },
      ],
      demos: [
        {
          id: "motion-radio-basic",
          title: ct("motion.radio.title"),
          code: `<RadioGroup value={value} onValueChange={setValue}>
  <RadioGroupItem value="auto" label="Responder siempre" />
  <RadioGroupItem value="hours" label="Solo en horario" />
</RadioGroup>`,
          render: <RadioDemo />,
        },
      ],
    },
    {
      id: "motion-input",
      name: "Input (motion)",
      source: "components/motion/input.tsx",
      importLine: 'import { Input } from "@/components/motion/input";',
      desc: ct("motion.input.desc"),
      props: [
        { name: "label", type: "string", desc: ct("motion.input.label.desc") },
        { name: "value / onChange", type: "string / (value: string) => void", desc: ct("motion.input.onChange.desc") },
        { name: "error", type: "string | boolean", desc: ct("motion.input.error.desc") },
        { name: "success", type: "boolean", desc: ct("motion.input.success.desc") },
        { name: "leftIcon / rightIcon", type: "ReactNode", desc: "" },
        { name: "classNames", type: "InputClassNames", desc: ct("motion.input.classNames.desc") },
      ],
      demos: [
        {
          id: "motion-input-basic",
          title: ct("motion.input.title"),
          code: `<Input
  label="Correo"
  value={value}
  onChange={setValue}
  error={invalid ? "Eso no parece un correo." : false}
/>`,
          render: <MotionInputDemo />,
        },
      ],
    },
    {
      id: "action-swap",
      name: "ActionSwapButton",
      source: "components/motion/action-swap.tsx",
      importLine: 'import { ActionSwapButton, ActionSwapIcon, ActionSwapText } from "@/components/motion/action-swap";',
      desc: ct("motion.actionSwap.desc"),
      exports: [
        "ActionSwapButton",
        "ActionSwapText",
        "ActionSwapIcon",
        "ActionSwapRollButton",
        "ActionSwapRollText",
        "ActionSwapRollIcon",
      ],
      props: [
        { name: "items", type: "ActionSwapItem[]", required: true, desc: ct("motion.actionSwap.items.desc") },
        { name: "value / defaultValue", type: "string", desc: ct("motion.actionSwap.value.desc") },
        { name: "onValueChange", type: "(value: string, item: ActionSwapItem) => void", desc: "" },
        { name: "animation", type: '"blur" | "roll" | "cascade"', def: '"blur"', desc: ct("motion.actionSwap.animation.desc") },
        { name: "cycle", type: "boolean", def: "true", desc: ct("motion.actionSwap.cycle.desc") },
        { name: "iconOnly", type: "boolean", def: 'size === "icon"', desc: ct("motion.actionSwap.iconOnly.desc") },
      ],
      demos: [
        {
          id: "action-swap-basic",
          title: ct("motion.actionSwap.title"),
          desc: ct("motion.actionSwap.desc2"),
          code: `<ActionSwapButton
  animation="cascade"
  items={[
    { id: "copy", label: "Copiar" },
    { id: "done", label: "Copiado" },
  ]}
/>`,
          render: (
            <>
              {(["blur", "roll", "cascade"] as const).map((animation) => (
                <ActionSwapButton
                  key={animation}
                  animation={animation}
                  variant="outline"
                  items={[
                    { id: "copy", label: animation },
                    { id: "done", label: "Copiado" },
                  ]}
                />
              ))}
            </>
          ),
        },
      ],
    },
    {
      id: "theme-toggle",
      name: "ThemeToggle",
      source: "components/motion/theme-toggle.tsx",
      importLine: 'import { ThemeToggle } from "@/components/motion/theme-toggle";',
      desc: ct("motion.themeToggle.desc"),
      exports: ["ThemeToggle", "useThemeToggle"],
      props: [
        { name: "variant", type: '"rectangle" | "circle" | "circle-blur" | "blinds"', def: '"rectangle"', desc: ct("motion.themeToggle.variant.desc") },
        { name: "start", type: '"top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "bottom-up"', def: '"bottom-up"', desc: ct("motion.themeToggle.start.desc") },
        { name: "iconClassName", type: "string", desc: "" },
      ],
      demos: [
        {
          id: "theme-toggle-variants",
          title: ct("motion.themeToggle.title"),
          desc: ct("motion.themeToggle.desc2"),
          code: '<ThemeToggle variant="circle-blur" start="top-right" />',
          render: (
            <>
              {(["rectangle", "circle", "circle-blur", "blinds"] as const).map((variant) => (
                <div key={variant} className="flex flex-col items-center gap-1.5">
                  <ThemeToggle variant={variant} />
                  <span className="font-mono text-[10.5px] text-muted-foreground">{variant}</span>
                </div>
              ))}
            </>
          ),
        },
      ],
    },
    {
      id: "text-reveal",
      name: "TextReveal",
      source: "components/motion/text-reveal.tsx",
      importLine: 'import { TextReveal } from "@/components/motion/text-reveal";',
      desc: ct("motion.textReveal.desc"),
      props: [
        { name: "text", type: "string | string[]", required: true, desc: ct("motion.textReveal.text.desc") },
        { name: "as", type: "TextTag", def: '"p"', desc: ct("motion.textReveal.as.desc") },
        { name: "split", type: '"word" | "char"', desc: ct("motion.textReveal.split.desc") },
        { name: "stagger", type: "number", desc: ct("motion.textReveal.stagger.desc") },
        { name: "delay", type: "number", desc: ct("motion.textReveal.delay.desc") },
        { name: "blur", type: "number", desc: ct("motion.textReveal.blur.desc") },
        { name: "yOffset", type: "string | number", desc: ct("motion.textReveal.yOffset.desc") },
        { name: "whileInView / once", type: "boolean", desc: ct("motion.textReveal.view.desc") },
      ],
      demos: [
        {
          id: "text-reveal-basic",
          title: ct("motion.textReveal.title"),
          code: `<TextReveal as="h3" text="Cada canal en una sola bandeja" split="word" />
<TextReveal text="Sin copiar y pegar entre pestañas" split="char" />`,
          render: (
            <div className="flex w-full flex-col gap-3">
              <TextReveal
                as="h3"
                className="font-heading text-xl tracking-[-0.02em]"
                text="Cada canal en una sola bandeja"
                split="word"
              />
              <TextReveal
                className="text-sm text-muted-foreground"
                text="Sin copiar y pegar entre pestañas"
                split="char"
                stagger={0.012}
              />
            </div>
          ),
        },
      ],
    },
    {
      id: "text-shimmer",
      name: "TextShimmer",
      source: "components/motion/text-shimmer.tsx",
      importLine: 'import { TextShimmer } from "@/components/motion/text-shimmer";',
      desc: ct("motion.textShimmer.desc"),
      props: [
        { name: "children", type: "ReactNode", required: true, desc: "" },
        { name: "as", type: "TextTag", def: '"span"', desc: "" },
        { name: "duration", type: "number", def: "2.5", desc: ct("motion.textShimmer.duration.desc") },
      ],
      demos: [
        {
          id: "text-shimmer-basic",
          title: ct("motion.textShimmer.title"),
          code: '<TextShimmer>Generando la respuesta…</TextShimmer>',
          render: <TextShimmer className="text-sm">Generando la respuesta…</TextShimmer>,
        },
      ],
    },
    {
      id: "thinking-text",
      name: "ThinkingText",
      source: "components/motion/thinking-text.tsx",
      importLine: 'import { ThinkingText } from "@/components/motion/thinking-text";',
      desc: ct("motion.thinkingText.desc"),
      props: [
        { name: "states", type: "readonly string[]", required: true, desc: ct("motion.thinkingText.states.desc") },
        { name: "hold", type: "number", def: "2000", desc: ct("motion.thinkingText.hold.desc") },
      ],
      demos: [
        {
          id: "thinking-text-basic",
          title: ct("motion.thinkingText.title"),
          code: `<ThinkingText states={["Leyendo el historial", "Buscando en el catálogo", "Redactando"]} />`,
          render: (
            <ThinkingText
              className="text-sm text-muted-foreground"
              hold={1600}
              states={["Leyendo el historial", "Buscando en el catálogo", "Redactando la respuesta"]}
            />
          ),
        },
      ],
    },
    {
      id: "download-animation",
      name: "DownloadAnimation",
      source: "components/motion/download-animation.tsx",
      importLine: 'import { DownloadAnimation } from "@/components/motion/download-animation";',
      desc: ct("motion.downloadAnimation.desc"),
      exports: ["DownloadAnimation"],
      props: [
        { name: "fileType", type: '"csv" | "pdf" | "default"', def: '"default"', desc: ct("motion.downloadAnimation.fileType.desc") },
        { name: "onDownload", type: "() => void", required: true, desc: ct("motion.downloadAnimation.onDownload.desc") },
        { name: "disabled", type: "boolean", desc: "" },
      ],
      demos: [
        {
          id: "download-animation-basic",
          title: ct("motion.downloadAnimation.title"),
          desc: ct("motion.downloadAnimation.desc2"),
          code: `<DownloadAnimation fileType="csv" onDownload={handleDownload}>
  <Button>Descargar CSV</Button>
</DownloadAnimation>`,
          render: <DownloadAnimationDemo />,
        },
      ],
    },
    {
      id: "toast",
      name: "Toast",
      source: "components/toast-provider.tsx",
      importLine: 'import { useToast } from "@/components/toast-provider";',
      desc: ct("motion.toast.desc"),
      exports: ["useToast", "ToastProvider", "AnimatedToastStack", "useAnimatedToastStack"],
      props: [
        { name: "title", type: "ReactNode", required: true, desc: "" },
        { name: "description", type: "ReactNode", desc: "" },
        { name: "status", type: '"neutral" | "info" | "loading" | "success" | "warning" | "error"', def: '"neutral"', desc: ct("motion.toast.status.desc") },
        { name: "action", type: "{ label, onClick }", desc: ct("motion.toast.action.desc") },
        { name: "duration", type: "number", desc: ct("motion.toast.duration.desc") },
      ],
      demos: [
        {
          id: "toast-basic",
          title: ct("motion.toast.title"),
          code: `const { toast } = useToast();

toast({ title: "Guardado", status: "success" });`,
          render: <ToastDemo />,
        },
      ],
    },
  ],
  };
}
