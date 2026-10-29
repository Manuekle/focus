# Propuesta: efectos por sujeto en video

Estado: propuesta de producto y arquitectura, 29 de octubre de 2026. Esta pasada implementa la landing; glitch, distorsión y el inventario completo de sujetos quedan para una implementación posterior.

## La experiencia

Subir un clip, revisar las personas y objetos detectados, elegir uno y aplicarle glitch o distorsión. El efecto sigue su máscara durante el fragmento elegido. El resto del video conserva sus píxeles originales. Ejemplo: “Aplica glitch a la persona de la derecha entre los segundos 2 y 5”.

“Identificar” significa distinguir sujetos dentro del clip: “Persona 1, camiseta roja”, una miniatura y los tramos donde aparece. No hace falta conocer sus nombres. La interfaz dice **Sujetos detectados**, permite añadir uno que falte mediante un clic y muestra cuándo el seguimiento necesita revisión. No promete encontrar todos los sujetos sin errores.

## Lo que ya existe

- `server/ai/suggest.ts`: Muse Spark sugiere sujetos e instrucciones mirando **solo el primer fotograma**. No constituye un inventario de todo el clip.
- `server/ai/planner.ts` y `shared/schemas.ts`: una instrucción se convierte en un plan validado, con concepto y selección individual, múltiple o de todas las coincidencias del concepto.
- `server/ai/sam.ts`, `shared/tracking.ts` y `server/jobs.ts`: seguimiento por concepto, IDs de objetos, máscaras, selección por clic, combinación de seguimientos y caché. Se puede completar un seguimiento incompleto.
- El render actual usa una selección de IDs y unos parámetros de efecto comunes. Faltan parámetros independientes por sujeto y las familias de efecto glitch y distorsión.
- El video normalizado ya proporciona una base temporal común para máscaras, vista previa y exportación. Debe conservarse.

## Muse y SAM

Muse Spark interpreta el clip y devuelve un inventario estructurado con categorías, descripciones cortas y momentos donde buscar. SAM 3.1 recibe conceptos simples o puntos/cajas y devuelve máscaras y seguimiento. Esta separación coincide con la [guía oficial de segmentación de Meta](https://dev.meta.ai/docs/media-segmentation). Muse también admite [comprensión de video](https://dev.meta.ai/docs/video-understanding).

SAM encuentra coincidencias del concepto pedido; no produce por sí solo un catálogo universal de lo que aparece. Varias categorías requieren varias solicitudes. Se agrupan conceptos duplicados antes de segmentar y se reutiliza la carga del clip. El procesamiento de planos y la unión de resultados son responsabilidad de Focus.

## Flujo propuesto

1. **Subir y normalizar.** Mantener los límites, validación y cancelación actuales. La pantalla ofrece analizar el clip; no aplicar ni renderizar un efecto antes de la elección.
2. **Descubrir sujetos durante el clip.** Muse analiza el video o fotogramas repartidos por el tiempo y por cambios de plano. Incluir sujetos que entran después del primer fotograma. Validar un inventario acotado; si el presupuesto no cubre todo el clip, mostrar el alcance analizado.
3. **Localizar y seguir.** SAM procesa los conceptos confirmados. Cada pista tiene un ID interno, categoría, miniatura, intervalos de presencia y calidad del seguimiento. No unir dos personas por compartir ropa o descripción. Tras un corte, conservar pistas separadas hasta que exista evidencia suficiente para unirlas o el usuario lo indique.
4. **Elegir.** Panel de sujetos y contornos sincronizados con el cabezal de reproducción. Clic sobre el video o tarjeta selecciona una pista. Selección y cambio de intensidad reutilizan máscaras guardadas. Añadir un sujeto ausente o completar máscaras sí puede requerir otro análisis, indicado antes de iniciarlo.
5. **Aplicar.** Elegir glitch o distorsión, intensidad e intervalo. Para una primera versión, un efecto por pista e intervalo, sin un constructor libre de capas.
6. **Previsualizar y exportar.** Comparación original/resultado, revisión de tramos con máscaras faltantes y MP4 con el audio original. Un fotograma sin máscara fiable conserva el original y queda señalado para revisión.

## Efectos y composición

**Glitch:** desplazamientos horizontales de bandas, separación de canales RGB y breves saltos temporales. Semilla y tiempo deterministas para que la vista previa y la exportación coincidan. Nada de destellos globales: el efecto se compone dentro de la máscara seleccionada.

**Distorsión:** deformación ondulada del sujeto, con frecuencia e intensidad acotadas. El primer alcance conserva la silueta de la máscara; expandir o desplazar la silueta sería una capacidad posterior que necesitaría resolver el fondo descubierto.

Por fotograma, calcular el efecto sobre la fuente y componerlo con la máscara del sujeto. Los píxeles fuera de esa máscara conservan la fuente. Limitar y suavizar el borde sin permitir que las muestras desplazadas modifiquen a otro sujeto. Los cruces y oclusiones respetan la máscara visible, sin inventar partes ocultas.

El esquema futuro necesita `subjectTracks` y una lista de ediciones con `trackId`, `effect`, parámetros acotados y rango temporal validado. El render y su caché incluyen versión del motor, IDs de máscaras, selección, parámetros, intervalos y semilla. Mantener compatibles los trabajos actuales. Muse devuelve datos permitidos, nunca comandos o argumentos de FFmpeg.

## Orden de implementación

Primero, inventario del clip y panel de pistas sobre el seguimiento actual. Después, glitch y distorsión sobre una pista, con comparación y exportación. Finalmente, varias pistas con efectos distintos y resolución explícita de intervalos superpuestos. La landing mantiene el flipbook como acción principal durante estas fases.

## Validación necesaria

- Dos sujetos: el seleccionado cambia y los píxeles del otro permanecen iguales fuera de la máscara.
- Una persona aparece a mitad del clip; aparece en el inventario.
- Sujetos similares, cruces, oclusiones y cortes: no intercambiar pistas silenciosamente.
- Varias personas del mismo concepto: seleccionarlas por separado y comprobar los intervalos.
- Glitch/distorsión desactivados o intensidad cero: identidad con la fuente; resultados deterministas al reexportar.
- Máscara ausente: conservar original, avisar y permitir corregir; no presentar seguimiento completo.
- Reutilización de máscaras sin nuevas llamadas; límites, cancelación y reanudación sin cargos duplicados.
- Pruebas de teclado, móvil y MP4 final; pruebas automáticas con modelos sustituidos. Las pruebas reales con Muse/SAM se ejecutan por separado con un presupuesto explícito.
