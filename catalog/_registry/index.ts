import { foundations } from './foundations';
import { uiControls } from './ui-controls';
import { uiOverlays } from './ui-overlays';
import { motionSection } from './motion';
import { aiElements } from './ai-elements';
import { appShell } from './app-shell';
import { lighting } from './lighting';
import { petSection } from './pet';
import { extended } from './extended';
import type { Section } from '../_lib/types';
export function getCatalog(locale?: string): readonly Section[] { return [foundations(locale),uiControls(locale),uiOverlays(locale),extended(locale),motionSection(locale),aiElements(locale),appShell(locale),lighting(locale),petSection(locale)]; }
