# Focus · Design system (inventario para el editor)

Este documento resume la identidad que **ya existe** en el repositorio y cómo la usa el editor de video Focus. No introduce marca nueva. Cada valor cita su fuente; cuando algo no existe se indica como ausente.

Documentos detallados previos (siguen siendo la referencia normativa): [identity.md](identity.md), [foundations.md](foundations.md), [motion.md](motion.md), [patterns.md](patterns.md), [accessibility.md](accessibility.md), [components.md](components.md).

## 1. Marca

| Elemento | Valor | Fuente |
| --- | --- | --- |
| Nombre | Focus (wordmark en minúsculas `focus` + punto azul, en la barra del catálogo) | `catalog/_components/catalog.tsx` (`.focus-brand`) |
| Tagline de producto | "Make anything stand out." | `PHASES/PHASE_1.md` (no aparece en assets) |
| Símbolo | Trazo SVG propio, proporción 568:537, `currentColor`, azul `#325CFE` por defecto | `components/icons/focus-mark.tsx` |
| Logo original | `public/brand/focus-logo-original.svg` (relleno `#004DFD`, conservado sin cambios) | — |
| Variantes | `public/brand/focus-symbol.svg` y `public/brand/focus-symbol-dark.svg` (ambas `#325CFE`) | — |
| Favicon | `app/icon.svg`: mismo trazo centrado en lienzo 648×648 | — |
| Margen libre | ≥ ¼ de la altura del símbolo; no estirar ni encerrar en otra forma | `docs/identity.md` |

Ausentes: no hay logotipo tipográfico en SVG (el wordmark es texto HTML), ni versión monocroma blanca dedicada (se obtiene con `currentColor`). `public/oruka.svg` pertenece a la base de procedencia (Oruka), no a Focus, y no se usa en el editor.

Capturas de referencia (`preview-*.png`) existían en el commit inicial y están **borradas en el árbol de trabajo** antes de esta fase; siguen recuperables con `git show HEAD:preview-light.png`.

## 2. Color

Fuente efectiva: `styles/focus-theme.css` (sobrescribe `styles/base-tokens.css`). Exportado en `tokens/tokens.json`.

| Rol | Claro | Oscuro |
| --- | --- | --- |
| `--background` (papel) | `#F6F7FA` | `#14161E` |
| `--card` (superficie) | `#FFFFFF` | `#1C1F2A` |
| `--popover` | `#FFFFFF` | `#222632` |
| `--foreground` (tinta) | `#232735` | `#E8EAF2` |
| `--primary` (azul Focus) | `#325CFE` (hover `#244FE8`) | `#325CFE` |
| `--muted` / `--secondary` | `#EEF0F5` | `#252937` / `#292D3B` |
| `--muted-foreground` (pizarra) | `#626A7D` | `#A4ABC0` |
| `--accent` / `--accent-foreground` | `#EAF0FF` / `#244FE8` | `#202D50` / `#B8CAFF` |
| `--destructive` | `#B8344B` | `#FF9AAA` |
| `--border` | `#2327351A` | `#E8EAF21C` |
| `--input` | `#23273529` | `#E8EAF230` |

Estados (`--status-*-bg/fg`): success verde, failed rosa, pending ámbar, progress azul, submitted violeta, review oliva, expired gris. Un único acento (azul); sin degradados de marca.

## 3. Tipografía

- Familia única: **Optimistic Display** (variable, pesos 300–800, stretch 80–100 %), servida localmente desde `public/fonts/optimistic/optimistic.ttf` con su aviso de copyright. Declarada en `styles/typography.css`.
- Todos los roles (`--app-font-sans`, `heading`, `numeral`, `mono`) apuntan a ella.
- Tracking uniforme `-0.02em` en toda la UI.
- Pesos: 400 texto, 500 controles, 550–600 títulos. Títulos de página 30–36 px; cuerpo 14 px; metadatos 10–12 px. `tabular-nums` en cifras.

## 4. Iconografía

- Librería: **Hugeicons** (`@hugeicons/core-free-icons` + `@hugeicons/react`), trazo 1.75, 14–18 px en controles.
- Wrapper obligatorio: `components/icons/icon.tsx` (`HugeiconsIcon`) — oculta los iconos al lector de pantalla y gestiona marcas de color.
- No hay Lucide en el proyecto; el editor **no** lo añade.

## 5. Forma, bordes y elevación

- `--radius` = 12 px → `sm` 8, `md` 10, `lg` 12, `xl` 16. Controles 8–10, tarjetas 12–16. Marcos concéntricos (`FramedCard`) restan el padding al radio interior.
- Bordes: 1 px `--border`; dropzones con borde discontinuo (`FileUpload`).
- Sombras (`styles/base-tokens.css`): `--shadow-soft`, `--shadow-elevated`, `--shadow-float`, `--shadow-inset`, `--shadow-button`. Suaves, de baja opacidad; más densas en oscuro.

## 6. Espaciado y layout

- Escala `--space-1`…`--space-16` (4–64 px). 4–8 dentro de un control, 12–16 entre controles, 20–24 en tarjetas, 32–48 entre secciones.
- Tokens de composición: `--layout-sidebar` 15.5 rem, `--layout-reading` 46 rem, `--layout-content` 88 rem.
- Capas: base 0, sticky 30, overlay 50, toast 100.
- Breakpoints 640 / 768 / 1024 / 1280.

## 7. Superficies

Jerarquía: página (`--background`) → superficie (`--card`, borde + sombra suave) → campo hundido (`--muted` + `--shadow-inset`) → popover/diálogo (`--popover`, `--shadow-float`). Texturas opcionales: `public/textures/grain.svg`, `public/patterns/*.svg` (claro y `dark/`).

## 8. Movimiento

- Curvas: `--ease-smooth-out` `cubic-bezier(0.22,1,0.36,1)` y `--ease-expo-out` `cubic-bezier(0.16,1,0.3,1)` (`styles/tailwind-theme.css`); equivalentes JS y springs en `lib/ease.ts`.
- Escala: modal 250/150 ms, panel 400/350 ms, morph 350/250 ms, tooltip 150/90 ms.
- Motion (`motion/react`) para presencia y gestos; CSS para estados binarios. `useReducedMotion` (`lib/hooks`) es reactivo; las variantes reducidas quitan desplazamiento, escala y blur.

## 9. Temas

Claro y oscuro completos. Clase `.dark` en `<html>`, restaurada antes del primer pintado por el script de `app/layout.tsx` (clave `focus-theme` en `localStorage`). Cambio animado con `ThemeToggle`.

## 10. Componentes reutilizados por el editor

| Necesidad del editor | Componente existente |
| --- | --- |
| Marca | `FocusMark` |
| Acciones | `Button` (variantes `default`, `ai`, `outline`, `ghost`) |
| Subida de video | `FileUpload` (`components/motion/file-upload.tsx`), variante `centered` |
| Prompt | `Textarea` |
| Selección de efecto | `ToggleChip` |
| Errores recuperables | `ErrorBanner` |
| Estado / progreso | `Spinner`, `StatusBadge` |
| Feedback | `useToast` (vía `FocusProvider`) |
| Tema | `ThemeToggle` |
| Iconos | `HugeiconsIcon` |

## 11. Reglas aplicadas al editor

1. El video es el centro visual: lienzo oscuro neutro, sin marcos decorativos.
2. Un único acento azul para la acción primaria y la selección.
3. Sin degradados genéricos, glassmorphism ni sombras fuertes adicionales.
4. Voz en español, directa, mayúscula inicial; errores con problema + siguiente paso (`docs/identity.md`).
5. Ningún resultado de IA se muestra sin procesamiento real.
