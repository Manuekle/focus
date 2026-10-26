# Identidad de Focus

## Dirección

Focus prioriza legibilidad, atención y continuidad. Superficies frías, contraste estable, un acento azul y un ritmo espacioso. El sistema deriva su comportamiento de Oruka y tiene una identidad visual propia.

La marca es el logo SVG proporcionado para la app. `FocusMark`, importable desde `@focus/ui/brand`, conserva su trazado y proporciones originales (568:537), y utiliza `currentColor` con el azul `#325CFE` por defecto. No estires el dibujo ni lo encierres en la forma provisional anterior. Mantén un margen libre de al menos un cuarto de su altura. El original se conserva en `public/brand/focus-logo-original.svg`; las variantes listas para usar están en `public/brand/focus-symbol.svg` y `public/brand/focus-symbol-dark.svg`. El icono de navegador centra el mismo dibujo en un lienzo cuadrado con margen.

## Paleta principal

| Rol | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| Papel / página | `#F6F7FA` | `#14161E` | Fondo general |
| Superficie | `#FFFFFF` | `#1C1F2A` | Contenido agrupado |
| Tinta | `#232735` | `#E8EAF2` | Lectura principal |
| Azul | `#325CFE` | `#325CFE` | Acción y selección |
| Pizarra | `#626A7D` | `#A4ABC0` | Apoyo legible |
| Superficie neutra | `#EEF0F5` | `#252937` | Contexto secundario |

Los estados usan verde para éxito, rosa para fallo y ámbar para atención. Acompaña el color con texto o icono. La selección usa azul; una acción destructiva utiliza su variante semántica aunque sea la acción principal del diálogo.

## Tipografía

Inter en títulos, texto, cifras, código y metadatos, con tracking uniforme de -0.02em. La escala de lectura no depende de la plataforma. Los archivos se sirven localmente; no hay peticiones a Google Fonts.

Usa pesos 400 para texto, 500 para controles y 550–600 para encabezados. Un título de página tiene 30–36 px; la portada de documentación puede ampliar su escala. El cuerpo de producto utiliza 14 px y el contenido largo 16 px. Código: 11–12 px. Reserva metadatos de 10–12 px para información secundaria.

`font-heading`, `font-sans`, `font-numeral` y `font-mono` conservan sus nombres por compatibilidad; todos usan Inter con tracking de `-0.02em`. `tabular-nums` alinea importes y contadores.

## Forma y densidad

Base de radio 12 px. Controles: 8–10 px; tarjetas: 12–16 px. Los marcos concéntricos restan el padding al radio interior. Botones: xs 28, sm 32, default 36 y lg 40 px. Los iconos van de 14 a 18 px en controles; conserva un nombre accesible en acciones sin texto.

La densidad cómoda es la base de Focus. En un flujo táctil, deja espacio suficiente entre acciones y amplía el área interactiva hasta 44 px donde la tarea lo requiera. No reduzcas el texto para hacer caber contenido que necesita otra composición.

## Voz

Frases directas, verbos concretos y mayúscula inicial. «Guardar cambios», «Añadir persona», «Volver a intentar». Los errores explican el problema y el siguiente paso. Los estados vacíos dicen qué aparecerá y cómo empezar. Mantén el mismo verbo en botón, resultado y toast.
