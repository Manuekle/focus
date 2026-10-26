import { aiElements } from "./ai-elements";
import { appShell } from "./app-shell";
import { buttonStudy } from "./button-study";
import { foundations } from "./foundations";
import { lighting } from "./lighting";
import { motionSection } from "./motion";
import { petSection } from "./pet";
import { uiControls } from "./ui-controls";
import { uiOverlays } from "./ui-overlays";
import type { Section } from "../_lib/types";

/** The pending design study leads; the existing catalog follows. */
export function getCatalog(locale?: string): readonly Section[] {
  return [
    buttonStudy(locale),
    foundations(locale),
    uiControls(locale),
    uiOverlays(locale),
    motionSection(locale),
    lighting(locale),
    aiElements(locale),
    appShell(locale),
    petSection(locale),
  ];
}
