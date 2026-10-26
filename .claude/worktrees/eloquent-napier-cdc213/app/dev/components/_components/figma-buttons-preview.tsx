"use client";

import { useEffect, useRef, useState } from "react";
import {
  Add01Icon,
  ArrowUpRight01Icon,
  CheckIcon,
  Delete02Icon,
  AiVideo01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  Settings01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCatalogT } from "../_lib/catalog-i18n";
import { FigmaButton } from "./figma-button";
import styles from "./figma-buttons.module.css";

const FIGMA_URL = "https://www.figma.com/design/ta8y4G9BuAQxbHvZmZMoA3/Untitled?node-id=1-83";

function useCopy() {
  const { locale } = useCatalogT();
  const en = locale === "en";
  return {
    version: en ? "Version 03" : "Versión 03",
    pending: en ? "Approved · applied in the app" : "Aprobada · aplicada en la app",
    reference: en ? "View your Figma" : "Ver tu Figma",
    current: en ? "App components" : "Componentes de la app",
    proposal: en ? "Approved Figma reference" : "Referencia Figma aprobada",
    publish: en ? "Publish" : "Publicar",
    run: en ? "Run" : "Probar",
    settings: en ? "Settings" : "Ajustes",
    add: en ? "Add" : "Añadir",
    ai: en ? "Ask AI" : "Pedir a IA",
    more: en ? "More options" : "Más opciones",
    cancel: en ? "Cancel" : "Cancelar",
    duplicate: en ? "Duplicate" : "Duplicar",
    delete: en ? "Delete" : "Eliminar",
    light: en ? "Light · Figma reference" : "Claro · referencia Figma",
    dark: en ? "Dark · app adaptation" : "Oscuro · adaptación a la app",
    compact: en ? "Compact" : "Compacto",
    regular: en ? "For the app" : "Para la app",
    large: en ? "Large action" : "Acción grande",
    rest: en ? "Rest" : "Reposo",
    hover: en ? "Hover" : "Al pasar el cursor",
    pressed: en ? "Pressed" : "Pulsado",
    focus: en ? "Keyboard focus" : "Foco de teclado",
    disabled: en ? "Disabled" : "Deshabilitado",
    save: en ? "Save changes" : "Guardar cambios",
    saved: en ? "Changes saved" : "Cambios guardados",
    status: en ? "Saved in the demo." : "Guardado en la muestra.",
    saving: en ? "Simulating a save…" : "Simulando el guardado…",
    try: en ? "Try the button. You can also reach it with Tab and activate it with Enter." : "Prueba el botón. También puedes llegar con Tab y activarlo con Enter.",
    detail: en ? "10 px corners · 14 px medium type · layered shadows" : "Esquinas de 10 px · texto de 14 px medium · sombras en capas",
    sizeDetail: en ? "28, 32 and 36 px on desktop. Touch screens still get a 44 px target." : "28, 32 y 36 px en escritorio. En pantallas táctiles el área sigue siendo de 44 px.",
    edgeDetail: en ? "Enlarged buttons to inspect the corners, inner edge and colored shadows." : "Botones ampliados para revisar las esquinas, el borde interior y las sombras de cada color.",
  };
}

export function FigmaButtonsPreview() {
  const c = useCopy();
  return (
    <div className={styles.preview}>
      <div className={styles.intro}>
        <div className={styles.row}>
          <span className={styles.version}>{c.version}</span>
          <span className={styles.caption}>{c.pending}</span>
        </div>
        <a className={styles.reference} href={FIGMA_URL} target="_blank" rel="noreferrer">
          {c.reference}<HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={1.75} />
        </a>
      </div>

      <div className={styles.comparison}>
        <div className={styles.compareCell}>
          <p className={styles.label}>{c.current}</p>
          <div className={styles.row}>
            <Button size="sm"><HugeiconsIcon icon={Upload01Icon} size={16} strokeWidth={1.75} />{c.publish}</Button>
            <Button size="sm" variant="outline"><HugeiconsIcon icon={PlayIcon} size={16} strokeWidth={1.75} />{c.run}</Button>
            <Button size="sm" variant="ai"><HugeiconsIcon icon={AiVideo01Icon} size={16} strokeWidth={1.75} />{c.ai}</Button>
          </div>
        </div>
        <div className={styles.compareCell}>
          <p className={styles.label}>{c.proposal}</p>
          <div className={styles.row}>
            <FigmaButton size="sm"><HugeiconsIcon icon={Upload01Icon} size={16} strokeWidth={1.75} />{c.publish}</FigmaButton>
            <FigmaButton size="sm" variant="outline"><HugeiconsIcon icon={PlayIcon} size={14} strokeWidth={1.5} fill="currentColor" />{c.run}</FigmaButton>
            <FigmaButton size="sm" variant="accent"><HugeiconsIcon icon={AiVideo01Icon} size={14} strokeWidth={1.75} />{c.ai}</FigmaButton>
          </div>
        </div>
      </div>

      <div className={styles.surfaceGrid}>
        {(["light", "dark"] as const).map((theme) => (
          <div key={theme} className={styles.surface} data-preview-theme={theme}>
            <p className={styles.surfaceLabel}>{theme === "light" ? c.light : c.dark}</p>
            <div className={styles.toolbar}>
              <FigmaButton variant="outline" size="icon-sm" aria-label={c.settings}>
                <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
              </FigmaButton>
              <FigmaButton variant="outline" size="sm"><HugeiconsIcon icon={PlayIcon} size={14} strokeWidth={1.5} fill="currentColor" />{c.run}</FigmaButton>
              <FigmaButton size="sm"><HugeiconsIcon icon={Upload01Icon} size={16} strokeWidth={1.75} />{c.publish}</FigmaButton>
              <FigmaButton variant="outline" size="icon-sm" aria-label={c.more}>
                <HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={1.75} />
              </FigmaButton>
            </div>
            <div className={styles.row}>
              <FigmaButton variant="accent" size="sm"><HugeiconsIcon icon={AiVideo01Icon} size={16} strokeWidth={1.75} />{c.ai}</FigmaButton>
              <FigmaButton size="sm"><HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />{c.add}</FigmaButton>
            </div>
            <div className={styles.row}>
              <FigmaButton variant="outline" size="sm">{c.cancel}</FigmaButton>
              <FigmaButton variant="secondary" size="sm">{c.duplicate}</FigmaButton>
              <FigmaButton variant="destructive" size="sm"><HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.75} />{c.delete}</FigmaButton>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.caption}>{c.detail}</p>
    </div>
  );
}

export function FigmaButtonEdges() {
  const c = useCopy();
  return (
    <div className={styles.preview}>
      <div className={styles.intro}>
        <span className={styles.version}>{c.version}</span>
        <p className={styles.caption}>{c.edgeDetail}</p>
      </div>
      <div className={styles.edgeStudy} data-preview-theme="light">
        <div className={styles.edgeRows} aria-hidden="true">
          <div className={styles.row}>
            <FigmaButton variant="accent" size="sm" tabIndex={-1} static><HugeiconsIcon icon={AiVideo01Icon} size={14} strokeWidth={1.75} />{c.ai}</FigmaButton>
            <FigmaButton size="sm" tabIndex={-1} static><HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />{c.add}</FigmaButton>
          </div>
          <div className={styles.row}>
            <FigmaButton variant="outline" size="icon-sm" tabIndex={-1} static aria-label={c.settings}><HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} /></FigmaButton>
            <FigmaButton variant="outline" size="sm" tabIndex={-1} static><HugeiconsIcon icon={PlayIcon} size={14} strokeWidth={1.5} fill="currentColor" />{c.run}</FigmaButton>
            <FigmaButton size="sm" tabIndex={-1} static><HugeiconsIcon icon={Upload01Icon} size={14} strokeWidth={1.75} />{c.publish}</FigmaButton>
          </div>
          <div className={styles.row}>
            <FigmaButton variant="outline" size="sm" tabIndex={-1} static>{c.cancel}</FigmaButton>
            <FigmaButton variant="secondary" size="sm" tabIndex={-1} static>{c.duplicate}</FigmaButton>
            <FigmaButton variant="destructive" size="sm" tabIndex={-1} static><HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} />{c.delete}</FigmaButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FigmaButtonStates() {
  const c = useCopy();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function save() {
    if (saveState === "saving") return;
    setSaveState("saving");
    timer.current = setTimeout(() => setSaveState("saved"), 1500);
  }

  return (
    <div className={styles.preview}>
      <div className={styles.sizes}>
        {([
          ["sm", c.compact],
          ["default", c.regular],
          ["lg", c.large],
        ] as const).map(([size, label]) => (
          <div key={size} className={styles.sample}>
            <FigmaButton size={size}><HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />{c.add}</FigmaButton>
            <span className={styles.caption}>{label}</span>
          </div>
        ))}
      </div>
      <p className={styles.caption}>{c.sizeDetail}</p>
      <div className={styles.states}>
        {([
          [undefined, c.rest],
          ["hover", c.hover],
          ["pressed", c.pressed],
          ["focus", c.focus],
        ] as const).map(([state, label]) => (
          <div key={label} className={styles.sample}>
            <FigmaButton size="sm" previewState={state} static>{c.publish}</FigmaButton>
            <FigmaButton variant="accent" size="sm" previewState={state} static>{c.ai}</FigmaButton>
            <FigmaButton variant="outline" size="sm" previewState={state} static>{c.run}</FigmaButton>
            <span className={styles.caption}>{label}</span>
          </div>
        ))}
        <div className={styles.sample}>
          <FigmaButton size="sm" disabled>{c.publish}</FigmaButton>
          <FigmaButton variant="accent" size="sm" disabled>{c.ai}</FigmaButton>
          <FigmaButton variant="outline" size="sm" disabled>{c.run}</FigmaButton>
          <span className={styles.caption}>{c.disabled}</span>
        </div>
      </div>
      <div className={styles.interaction}>
        <FigmaButton
          className={styles.saveButton}
          disabled={saveState === "saving"}
          aria-busy={saveState === "saving"}
          onClick={save}
        >
          {saveState === "saving" ? <Spinner aria-hidden="true" /> : (
            <HugeiconsIcon icon={saveState === "saved" ? CheckIcon : Upload01Icon} size={16} strokeWidth={1.75} />
          )}
          {saveState === "saved" ? c.saved : c.save}
        </FigmaButton>
        <p className={styles.caption} role="status">
          {saveState === "saved" ? c.status : saveState === "saving" ? c.saving : c.try}
        </p>
      </div>
    </div>
  );
}
