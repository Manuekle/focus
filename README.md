# Focus · Design system

Sistema completo con una identidad nueva, construido sobre los componentes e interacciones existentes de Oruka. Incluye código React reutilizable, temas claro y oscuro, tokens exportables y un catálogo interactivo independiente.

## Abrir

```sh
cd /Users/manudev/Dev/focus
pnpm install
pnpm dev
```

Abre http://localhost:3200. No requiere cuentas, variables de entorno ni backend. Las acciones de los ejemplos conservan datos solo en memoria. El sonido está desactivado inicialmente; puedes activarlo desde la barra del catálogo.

## Qué incluye

- **Fundamentos:** identidad azul/grafito, Optimistic Display, color semántico, tipografía, espaciado, radios, elevación, capas y movimiento.
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

La guía completa está en [docs/integration.md](docs/integration.md) y en `/guide` del catálogo. También puedes copiar componentes y sus imports relativos manteniendo la estructura `components/`, `lib/` y `styles/`.

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

La fuente Optimistic proporcionada conserva su archivo original y su aviso de copyright en `public/fonts/optimistic/`. Los componentes extraídos conservan la procedencia del proyecto; esta carpeta no concede una licencia pública sobre el código de Oruka.
