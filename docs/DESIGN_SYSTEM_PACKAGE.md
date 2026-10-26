# Focus · Design system

Sistema completo con una identidad nueva, construido sobre los componentes e interacciones existentes de Oruka. Incluye código React reutilizable, temas claro y oscuro, tokens exportables y un catálogo interactivo independiente.

## Abrir

```sh
cd /Users/manudev/Dev/focus
pnpm install
pnpm dev
```

- http://localhost:3200 — **editor de video Focus** ("Make anything stand out."). Requiere `ffmpeg` y `ffprobe` en el `PATH` (o `FFMPEG_PATH` / `FFPROBE_PATH`). Los videos subidos se guardan en `.focus-data/` (ignorado por git; cambia la ruta con `FOCUS_DATA_DIR`).
- http://localhost:3200/system — catálogo del design system. No requiere cuentas ni backend; sus ejemplos conservan datos solo en memoria. El sonido está desactivado inicialmente; puedes activarlo desde la barra del catálogo.

IA (Meta Model API, solo en servidor): define `MODEL_API_KEY` en `.env` (también se acepta `META_API_KEY`; ver `.env.example`). Muse Spark 1.3 convierte la instrucción en un plan validado con Zod; SAM 3.1 segmenta y sigue el sujeto sobre el video normalizado. Planes y máscaras se guardan por video en `.focus-data/` y se reutilizan; `GET /api/usage` muestra llamadas, aciertos de caché, tokens y fotogramas de SAM. `pnpm test` no hace llamadas pagas; `pnpm test:live` sí (una llamada a Muse Spark y una pasada de SAM de ~50 fotogramas).

Efectos (`server/video/`): un solo compositor determinista decodifica el video normalizado fotograma a fotograma por pipe de FFmpeg, aplica las máscaras SAM de ese mismo fotograma y codifica H.264/yuv420p (con el audio original si existe). Reality Shift (color selectivo y fondo desenfocado), Break the Frame (lienzo 1080×1350, video recortado al marco interior y sujeto sin recortar) y Motion Echo (estelas del sujeto, pensado para cámara fija). Cada exportación se verifica con FFprobe; los renders se guardan por parámetros y cambiar un ajuste no vuelve a llamar a Meta AI.

Arquitectura del editor: `app/_editor` (UI del workspace), `app/api` (rutas), `server/` (FFmpeg, almacenamiento, contratos de Meta AI y del compositor), `shared/` (límites de media y esquemas Zod). Identidad aplicada: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). `pnpm test` ejecuta Vitest, incluida una prueba de ingesta real con FFmpeg.

## Qué incluye

- **Fundamentos:** identidad azul/grafito, Inter, color semántico, tipografía, espaciado, radios, elevación, capas y movimiento.
- **Controles:** botones, campos, agrupaciones, selectores, calendario, OTP, switches, checkbox, radio, sliders, chips, badges, avatares y medidores.
- **Superficies:** diálogos, confirmaciones, drawer, dropdown, menú contextual, command palette, hover card y tooltips.
- **Feedback:** alertas, errores recuperables, toasts, esqueletos, spinner, éxito y carga de archivos.
- **Patrones:** formularios accesibles, tablas con búsqueda/orden/paginación/estados, tarjetas, KPI, gráficos, estados vacíos y composer.
- **UI de IA:** razonamiento, respuestas Markdown, estado de pensamiento, sugerencias y cambios de contenido.
- **Recursos:** ilustraciones de producto, estados de sistema, marca Focus, iconos Hugeicons, lighting y mascota.
- **Documentación:** variantes, ejemplos con código copiable, API de las piezas principales, integración, accesibilidad, uso y mantenimiento.

## Reutilizar desde otro proyecto

Paquete privado de **código fuente** para React 19 + TypeScript + Tailwind 4. Next.js ejecuta el catálogo; los componentes no dependen de Next ni Eve. El consumidor debe procesar TSX, CSS Modules y los estilos de Tailwind.

```sh
# En un proyecto al lado de la carpeta focus:
pnpm add @focus/ui@file:../focus
```

```tsx
import { Button } from '@focus/ui/ui/button';
import { Field } from '@focus/ui/ui/field';
import { Input } from '@focus/ui/ui/input';
import { FocusProvider } from '@focus/ui/provider';
```

Importa `@focus/ui/styles` **una vez** en tu CSS principal. Copia `public/fonts` y, si usas iconos de servicios, `public/logos/apps` a `public` del consumidor. Añade sus directorios de código al escaneo `@source` de Tailwind. Con Next, configura `transpilePackages: ['@focus/ui']` y monta `FocusProvider` por debajo de `body`.

La guía completa está en [integration.md](integration.md) y en `/guide` del catálogo. También puedes copiar componentes y sus imports relativos manteniendo la estructura `components/`, `lib/` y `styles/`.

## Personalizar

`styles/focus-theme.css` es el lugar para modificar la identidad. Conserva valores para ambos temas y los tokens de controles que dependan del acento. La base extraída se conserva en `styles/base-tokens.css`; el tema de Focus la sobreescribe al final.

```sh
pnpm tokens      # Regenera tokens/tokens.json desde el CSS real
pnpm check       # Tipos, lint e integridad del paquete
pnpm build       # Catálogo de producción
pnpm start       # Sirve el build en :3200
```

Para usar solo variables CSS, importa `@focus/ui/tokens.css`. Para herramientas externas, usa `@focus/ui/tokens.json`; los valores que contienen `var(...)` se mantienen como referencias CSS.

## Mapa

| Carpeta | Contenido |
| --- | --- |
| `components/ui` | Primitivas y controles |
| `components/motion` | Feedback, presencia y controles con movimiento |
| `components/patterns` | Composición de pantallas, tablas y gráficos |
| `components/ai-elements` | Piezas de chat y contenido de IA |
| `components/hairline` | Ilustraciones y estados |
| `components/marketing`, `components/pet` | Recursos expresivos opcionales |
| `lib` | Utilidades, traducciones, hooks y tipos requeridos por UI |
| `styles` | Tokens, tema Focus y recetas originales |
| `tokens` | Exportación JSON de ambos temas y escalas |
| `catalog`, `app` | Documentación interactiva |
| `docs` | Guías de diseño, código y mantenimiento |
| `provenance.json` | Fuente y revisión de las piezas extraídas |

## Procedencia y límites

La base se extrajo de Oruka en la revisión registrada en `provenance.json`. La identidad de Focus, el catálogo y los patrones añadidos se mantienen aquí por separado. Los cambios de Oruka no se sincronizan automáticamente. No se modificó el repositorio original.

Los ejemplos son UI local. La aplicación que los adopte implementa autenticación, permisos, peticiones, persistencia y validación del servidor. `FileUpload` proporciona callbacks; `AnimatedQR` requiere un endpoint SVG/JSON suministrado por el consumidor. Las recetas de lighting y goo son optativas, para superficies expresivas.

Inter se sirve desde `public/fonts/inter/` y conserva su licencia SIL Open Font License 1.1 en `LICENSE.txt`. Los componentes extraídos conservan la procedencia del proyecto; esta carpeta no concede una licencia pública sobre el código de Oruka.
