# Fundamentos

## Fuentes de verdad

1. `styles/base-tokens.css`: variables y fuentes de la base extraída.
2. `styles/recipes.css`: recetas de controles y superficies.
3. `styles/typography.css`: métricas y tracking.
4. `styles/focus-theme.css`: identidad efectiva de Focus.
5. `styles/tailwind-theme.css`: correspondencia entre variables y utilidades.
6. `tokens/tokens.json`: exportación generada con `pnpm tokens`.

El orden de los imports importa. Los valores de Focus se aplican después de la base. `styles/tokens.css` reúne las variables efectivas para un consumidor sin Tailwind; `styles/index.css` añade el resto del sistema.

## Color semántico

Usa `background/foreground`, `card/card-foreground`, `popover/popover-foreground`, `primary/primary-foreground`, `muted/muted-foreground`, `accent/accent-foreground`, `destructive/destructive-foreground`, `border`, `input` y `ring`.

No deduzcas el texto de una superficie: cada relleno tiene un par de tinta. Cambia el tema con la clase `.dark` en `html` y `useTheme`; los componentes leen las variables. Evita añadir pares arbitrarios `dark:*` si el rol ya tiene un token.

Los botones y los campos tienen tokens de superficie propios. Un cambio de marca debe actualizar `--btn-primary-*`, `--btn-ai-*`, `--btn-focus-ring`, `--field-focus-*` y `--checkbox-on-*` junto a `--primary`.

## Espaciado

Escala en px: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48 y 64. Usa 4–8 dentro de un control, 12–16 entre controles relacionados, 20–24 dentro de tarjetas y 32–48 entre secciones. El espaciado comunica agrupación: las cosas que se usan juntas quedan más cerca.

Las variables `--space-1` a `--space-16` cubren la escala principal; Tailwind conserva sus utilidades para medidas intermedias. El archivo JSON documenta la escala en píxeles, sin convertirla en clases nuevas.

## Radios y elevación

`--radius` = 12 px. `sm` = 8, `md` = 10, `lg` = 12, `xl` = 16. Los marcos pueden usar 20/14 o 16/12 cuando el padding interior lo exige.

- `--shadow-soft`: reposo y tarjetas discretas.
- `--shadow-elevated`: superficie accionable o popover.
- `--shadow-float`: diálogo o panel invocado.
- `--shadow-inset`: campo y contenido hundido.

Los bordes agrupan y separan; las sombras indican elevación. No uses sombras fuertes en cada bloque de una pantalla.

## Layout y adaptación

Breakpoints: 640, 768, 1024 y 1280 px. Diseña desde el contenido. Una pantalla de trabajo puede tener navegación, cabecera, acciones y contenido principal; al estrecharse, reduce columnas y conserva la acción primaria visible.

El catálogo usa una barra lateral de 248 px, lectura de 46 rem y contenido máximo de 88 rem como referencias. Estas medidas son tokens de composición y no requisitos universales para el producto.

Usa `.x-fade` y `.y-fade` en scrollers discretos; conserva interacción por teclado. Evita scroll horizontal de la página; una tabla puede desplazarse en su propio contenedor.

## Capas

Base 0, sticky 30, overlays 50 y toasts 100 son los niveles de composición de Focus. Algunos motores de presencia conservan capas locales propias. Usa portales para overlays y evita crear contextos de apilado en contenedores de página sin una razón.
