# Revisión de sombras, frames y definición de Flipbook

Fecha: 29 de octubre de 2026. Revisión del código y de dibujos existentes; sin regeneraciones de pago ni cambios en el motor.

## Resultado

La exportación actual pierde detalle que sí existe en los originales y no añade sombras de contacto ni proyectadas al personaje. El dibujo tiene sombreado interno, pero no hay una dirección de iluminación compartida que especifique cómo debe cambiar ese sombreado con la pose. Los controles actuales no bastan para certificar un acabado de estudio.

La generación ya utiliza PNG y `reasoning_strength: "high"`. No corresponde atribuir el problema a una supuesta opción de generación en baja calidad. La documentación oficial de [Muse Image](https://dev.meta.ai/docs/image-generation) confirma que `high` realiza varias pasadas y que `size` establece la proporción, no los píxeles exactos devueltos.

## Evidencia observada

- Baile `e43bd63d-12a4-44da-a59a-f98d33dba5af`: ocho claves y 40 intermedios preparados. Se inspeccionaron las ocho claves, una hoja con los 48 dibujos y un detalle de cabeza y torso. Los originales muestreados son de 1280×1920; los sprites, de 512×768. La configuración guardada reproduce los 48 dibujos en cuatro segundos: 12 dibujos/s, dentro de un MP4 de 60 fps. No son 60 poses nuevas por segundo.
- MP4 existente `x-6f8a6cf7028ada70/focus-flipbook-dance.mp4`: FFprobe confirma H.264, yuv420p, 514×912, 60 fps y 20 segundos. Se abrió también en el reproductor del navegador. El personaje no tiene una sombra en el suelo que lo ancle al escenario.
- Saludo `1970433f-54ab-4490-b215-2eb74271a04e`: 32 dibujos, cuatro segundos, ocho dibujos/s. Se inspeccionaron ocho muestras y la referencia. El estado guardado contiene advertencias `color_shift` en 27 de 32 dibujos. Es una señal para revisar, no una prueba de que los 27 estén mal: la referencia está inclinada y la pose cambia la superficie visible.
- Salto `8e158ed2-9fe4-4bef-8777-5edb1b7201e1`: se inspeccionaron las ocho claves. Tampoco hay sombra proyectada o de contacto. Este caso permite comprobar que una sombra futura permanezca en el suelo y cambie con la separación del personaje.

Las hojas y comparativas locales están en `.focus-data/reviews/2026-10-29-animation-quality/`. La comparación `dance-original-vs-sprite-detail.png` muestra a la izquierda el recorte original y a la derecha el sprite, llevados a la misma altura de visualización. Es una comparación de pérdida de detalle; no una imagen nueva ni una propuesta de estilo.

## Hallazgos

| Gravedad | Ubicación | Actual | Cambio propuesto | Efecto |
| --- | --- | --- | --- | --- |
| Alta | `server/animation/frame-alignment.ts:16`, `server/animation/frame-alignment.ts:495`, `server/animation/frame-alignment.ts:589`, `server/animation/export.ts:53`, `shared/flipbook.ts:526` | Se normaliza a una celda de 768 px y un personaje de unos 600 px de alto. El exportador utiliza ese sprite reducido. El MP4 vertical revisado es de 514×912. | Conservar el recorte original como máster. Usar una copia pequeña para vista previa y componer la salida 1920×1080 o 1080×1920 desde el original, con una sola reducción al tamaño final. Avisar cuando el original no tenga detalle suficiente. | Recupera detalle real de ojos, líneas y ropa. Aumentar únicamente el tamaño del MP4 desde el sprite actual agrandaría el desenfoque. |
| Alta | `server/animation/pose-planning.ts:258`, `server/animation/sequence-planning.ts:101`, `server/animation/ensemble-planning.ts:231`, `app/flipbook/sequence-player.tsx:210`, `server/animation/export.ts:256` | Se prohíben las sombras proyectadas durante el dibujo para mantener limpio el fondo de recorte. Después se compone solamente fondo y personaje. | Mantener limpio el recorte y añadir en composición una sombra de contacto y otra proyectada, con luz estable. Posición, extensión, opacidad y suavidad deben responder a la pose, los apoyos y la altura. Compartir parámetros y reloj entre vista previa y exportación. | Ancla al personaje al suelo y hace legibles saltos, pasos y cambios de peso. Una sombra fija bajo toda la animación no cumple este objetivo. |
| Media | `server/animation/pose-planning.ts:255`, `server/animation/motion-continuity.ts:22`, `server/animation/ensemble-planning.ts:264` | Se pide conservar el sombreado exacto de la referencia, pero falta distinguir materiales y dirección de luz de las formas de sombra que cambian al articularse. | Bloquear paleta, materiales, contraste y luz. Permitir que sombras en ropa, pelo y cuerpo cambien coherentemente con orientación y oclusión. Aplicar el contrato a claves, intermedios y reparaciones. | Evita tanto el sombreado pegado a la imagen como cambios arbitrarios de luz entre dibujos. Los dibujos ya guardados necesitan una reparación explícita para cambiar su sombreado interno. |
| Media | `server/animation/quality-control.ts:78`, `server/animation/quality-control.ts:193` | Los controles miden escala, color, encuadre, silueta y holds. No miden definición efectiva, ampliación excesiva ni continuidad de sombras. | Añadir advertencias de resolución insuficiente y ampliación, y criterios de revisión visual para detalle facial, contactos, trayectoria de articulaciones y continuidad de iluminación. Evaluar color base separadamente de cambios de sombra justificados por la pose. | Un frame sin advertencias no debe interpretarse como aprobado en anatomía, nitidez o iluminación. |
| Media | `shared/flipbook.ts:448`, `server/animation/export.ts:58`, `app/flipbook/sequence-player.tsx:233` | El baile tiene suavizado 0.12. Se mezcla brevemente la pose anterior, hasta 33 ms; no se dibuja una pose nueva. En la hoja de intermedios se aprecian cambios de posición y orientación de pies que requieren revisión de continuidad. | Evaluar la calidad de los dibujos con suavizado desactivado y revisar los contactos y las trayectorias antes de aprobar cada tramo. Conservar el suavizado como elección separada, sin usarlo como criterio de calidad. | Una mezcla puede suavizar el salto visual, pero también ablanda las líneas y no corrige una articulación o un apoyo inconsistente. |

## Enfoques posibles

1. **Mejora completa, recomendada:** máster y vista previa separados, exportación 1080p desde originales, sombras animadas en composición, contrato de iluminación para nuevos dibujos y controles de calidad. Abarca los problemas encontrados y requiere más cambios y validación de memoria y tiempos de exportación.
2. **Composición primero:** definición y sombras del suelo, reutilizando dibujos existentes. Mejora el vídeo sin generar imágenes nuevas; conserva cualquier problema anatómico o de sombreado interno del dibujo original.
3. **Solo instrucciones de dibujo:** precisar iluminación y acabado para futuras generaciones y reparaciones. Es un cambio pequeño, pero no arregla la reducción a 768 px ni incorpora sombras al render actual. Regenerar dibujos consume llamadas y requiere el presupuesto correspondiente.

## Diseño propuesto para la mejora completa

- Resolución y registro: calcular la colocación en coordenadas comunes y escalarla al destino. Mantener originales y versiones anteriores. La vista previa puede utilizar proxies; el exportador debe leer los recortes de origen y redimensionar una sola vez. Versionar la caché de exportación para no devolver vídeos anteriores.
- Sombras: una capa detrás del personaje, en el plano del suelo, con contacto localizado y proyección según una dirección de luz estable. Al saltar, el contacto se debilita y la sombra se hace más suave y extensa; al aterrizar recupera densidad. No imponer esta sombra a escenas sin un suelo compatible ni contaminar el recorte original. La deformación debe responder al dibujo y ser temporalmente estable, sin parpadeos.
- Sombreado del dibujo: conservar identidad y materiales, describir el comportamiento de la luz con articulación y oclusión. El cambio del prompt afecta a dibujos futuros; no cambia retrospectivamente los existentes.
- Revisión: advertencias y comparación visual; ninguna regeneración automática. Las reparaciones conservan la acción explícita y el presupuesto existente. Las sombras de composición y la exportación desde originales no requieren llamadas de imagen.
- Validación: probar apoyo, vuelo y aterrizaje; comparar vista previa y MP4 en los mismos instantes; revisar claves e intermedios sin suavizado; comprobar 1080p real con FFprobe, detalle al 100 %, duración y transparencia de PNG; comprobar atlas y GIF según sus límites propios. Medir memoria y tiempo del render de 20 segundos.

Este diseño está propuesto, pendiente de aprobación. No se ha modificado el motor ni regenerado ningún dibujo.

## Cobertura de la revisión

| Categoría | Evidencia | Resultado |
| --- | --- | --- |
| Superficies y sombras | Prompts, composición en canvas y servidor, dibujos y MP4 existentes | Faltan sombras del suelo; sombreado interno sin contrato de luz por pose. |
| Animación | Exposición compartida, intermedios, suavizado, hojas de contacto y reproductor | Separar fps de vídeo, dibujos/s y continuidad. Revisión de poses necesaria. |
| Rendimiento y definición | Tamaños de origen y sprite, registro, caché y exportación | Reducción prematura confirmada. Rendimiento de un futuro render HD todavía no medido. |
| Tipografía | Fuera del encargo sobre dibujos y frames | No revisada. |
| Iconos | Fuera del encargo sobre dibujos y frames | No revisados. |

No se auditó el resto de la interfaz ni el motor independiente de imágenes vivas. Se comprobó el control de reproducción a 0.5× y se restituyó a 1×; no se hizo una reproducción al 10 %. Las conclusiones de detalle proceden de los archivos y recortes inspeccionados, y las de continuidad visual de muestras y hojas de contacto, no de una certificación de cada píxel de cada animación.

## Verificación

Comando ejecutado:

```sh
rtk pnpm test server/animation/export.test.ts server/animation/frame-generation.test.ts server/animation/frame-alignment.test.ts server/animation/appearance-consistency.test.ts server/animation/drawing-holds.test.ts
```

Resultado: cinco archivos y 56 pruebas aprobadas. Cubren funcionamiento de exportación, generación, registro, conservación de apariencia y holds; no certifican calidad artística. FFprobe corroboró las propiedades del MP4 existente. Se consultó la documentación oficial del generador sin ejecutar llamadas de generación.

Se descartaron: aumentar solo el bitrate (el codificador ya usa CRF 18 y la pérdida observada aparece antes de codificar); ampliar el sprite reducido como si añadiera detalle; añadir un `drop-shadow` al contenedor de la interfaz, porque no se incorporaría a los píxeles del vídeo ni representaría el contacto con el suelo.

Veredicto: **requiere cambios** para alcanzar el acabado solicitado. El resultado de una futura implementación, su rendimiento en HD y la calidad artística de dibujos nuevos siguen sin verificar.
