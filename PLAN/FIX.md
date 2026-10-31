# FOCUS — MASTER ENGINEERING PROMPT
## Phase-Gated AI Animation Pipeline Repair

### ROLE

Actúa como un Principal AI Engineer, Computer Vision Engineer, Animation Systems Engineer y Senior TypeScript Architect.

Tienes que auditar, reparar, verificar y fortalecer el pipeline existente de Focus.

Focus transforma movimientos de un video en ilustraciones de un personaje utilizando modelos de Meta, incluyendo Muse Image, Muse Spark y SAM 3.1, junto con tracking de pose, deformación geométrica y validaciones de calidad.

**No quiero un plan teórico. Quiero modificaciones reales sobre el repositorio existente, con pruebas, resultados y evidencia.**

El trabajo debe dividirse estrictamente en fases secuenciales, con criterios de aceptación obligatorios.

---

# 0. GLOBAL EXECUTION CONTRACT

Estas reglas tienen prioridad absoluta durante todo el trabajo.

## Rule 1 — Strict sequential execution

Debes completar las fases en orden numérico.

No puedes comenzar una fase si la anterior está en estado FAILED, BLOCKED, INCOMPLETE o UNVERIFIED.

Estados permitidos:

- NOT_STARTED
- IN_PROGRESS
- PASSED
- FAILED
- BLOCKED

Solo PASSED permite avanzar.

## Rule 2 — Mandatory quality gates

Cada fase debe contener:

1. Inspección del código existente.
2. Identificación del problema.
3. Hipótesis respaldadas por evidencia.
4. Cambios de implementación.
5. Pruebas unitarias cuando correspondan.
6. Pruebas de integración cuando correspondan.
7. Verificación del comportamiento.
8. Reporte de resultados.
9. Decisión PASS/FAIL.

Si una prueba falla, corrige el problema dentro de la misma fase y repite las verificaciones.

Si no puedes resolverlo, detente y documenta el bloqueo.

Está prohibido avanzar con fallos pendientes.

## Rule 3 — Evidence over assumptions

Nunca declares algo como corregido basándote solamente en:

- Una compilación exitosa.
- Ausencia de errores de TypeScript.
- Ausencia de errores de ESLint.
- Una respuesta aparentemente correcta de un LLM.
- Una imagen que parece correcta sin comparación.
- Un test que utiliza mocks demasiado simplificados.

Cada afirmación debe estar respaldada por una prueba apropiada.

Distingue explícitamente entre:

- Unit-tested
- Integration-tested
- Visually verified
- Tested with real inference
- Not verified

## Rule 4 — No hardcoding

La solución debe ser generalizable.

No implementes reglas específicas para el personaje del ejemplo, su falda, su peinado, su pose o el video utilizado.

No hardcodees:

- Colores de referencia.
- Coordenadas corporales.
- Ángulos de articulaciones.
- Tamaños de cabeza.
- Dimensiones de brazos.
- Proporciones humanas universales.
- Cantidad fija de frames como supuesto arquitectónico.
- Umbrales arbitrarios diseñados para aprobar los ejemplos actuales.

Los nueve frames son el caso de reproducción actual, no una limitación del sistema.

## Rule 5 — Preserve the existing application

No reconstruyas Focus.

Conserva:

- Next.js y TypeScript.
- La arquitectura actual siempre que sea viable.
- La interfaz existente.
- Los datos y runs guardados.
- Los contratos públicos de las APIs, salvo cambios versionados necesarios.
- La compatibilidad con Railway.
- La integración de modelos de Meta.

No instales nuevas dependencias pesadas sin justificar la necesidad.

## Rule 6 — Prevent unnecessary inference costs

Durante el diagnóstico, prioriza pruebas offline con artefactos existentes.

En las fases de debug, una ejecución de single-frame debe realizar como máximo una nueva generación de imagen.

No hagas llamadas pagadas a modelos para pruebas unitarias.

No inicies automáticamente nuevos intentos para resolver diferencias estéticas.

Utiliza límites de coste, timeout y cancelación cuando el proveedor lo permita.

No expongas claves ni credenciales en logs.

## Rule 7 — Gate reporting

Crea:

`docs/focus-pipeline-repair/`

Dentro, mantén:

- `PROGRESS.md`
- `BASELINE.md`
- `ARCHITECTURE.md`
- `TEST_RESULTS.md`
- `KNOWN_LIMITATIONS.md`

Y un reporte por fase.

Cada reporte debe incluir:

- Estado.
- Causa raíz o hipótesis.
- Archivos modificados.
- Tests ejecutados.
- Tests fallidos.
- Evidencia.
- Riesgos pendientes.
- Decisión de gate.

Actualiza `PROGRESS.md` después de cada fase.

---

# PHASE 00 — REPOSITORY AUDIT AND BASELINE

## Goal

Comprender completamente cómo funciona el pipeline actual antes de modificarlo.

## Tasks

Inspecciona:

- Extracción de frames del video.
- Preprocesamiento y cropping.
- DWPose.
- Muse Spark.
- SAM 3.1.
- Character rig.
- Transformaciones geométricas.
- Construcción de prompts.
- Integración con Muse Image.
- Validadores.
- Retry policy.
- Frame approval.
- Animación temporal.
- Persistencia de runs.
- UI de Rotoscope.

Analiza el caso real observado:

- 9 frames.
- Video extraído a 9 fps.
- Crop registrado: 828×1472+0+160.
- 3 intentos en frame 1.
- 0/9 frames aprobados.
- Todos los intentos rechazados.

Los problemas registrados incluyen:

- Proportions: forearm +19%, +45% y +60%.
- Head differences: -13% y -4%.
- Palette similarity: 92.6%, 92.9% y 93.8%.
- Umbral de color: 95%.
- Pose evaluada utilizando 4 bones.
- Mirroring detectado en un intento.
- Visual review skipped.
- Character rig rechazado por rightUpperArm.
- 282 folded triangles.
- 3.3% over-stretched.
- Deformación de área ×0.87.

No asumas que las métricas registradas son correctas; audita sus implementaciones.

## Deliverables

Documenta:

1. Diagrama real del pipeline.
2. Mapa de funciones y módulos.
3. Flujo real de datos.
4. Dependencias entre modelos.
5. Origen de cada referencia visual.
6. Causas confirmadas.
7. Hipótesis pendientes.
8. Baseline reproducible.

No modifiques algoritmos todavía, salvo lo estrictamente necesario para instrumentación no invasiva.

## QUALITY GATE 00

PASS únicamente si:

- El flujo completo está trazado.
- Cada componente tiene un propietario identificable en el código.
- Se pueden localizar los evaluadores que rechazaron los tres intentos.
- Existe una línea base reproducible mediante artefactos guardados o fixtures representativos.
- Los problemas sin evidencia están identificados como hipótesis, no como hechos.

Si faltan datos esenciales, reporta BLOCKED.

No avances a Phase 01 hasta pasar el gate.

---

# PHASE 01 — REFERENCE ISOLATION

## Goal

Separar completamente movimiento e identidad visual.

El sistema debe trabajar con tres entidades distintas:

A = Source video frame.
B = Character reference.
C = Generated output.

## Tasks

Crea contratos de datos explícitos para:

`PoseSource`
`CharacterIdentity`
`GenerationTarget`
`GeneratedFrame`

A debe proporcionar movimiento y geometría.

B debe proporcionar apariencia, diseño y proporciones del personaje.

C debe ser el resultado generado.

Verifica que:

- Muse Spark no confunda A con B.
- Los prompts no mezclen vestuario de B con anatomía observada de A.
- El skeleton provenga del video original.
- El personaje conserve una referencia de identidad estable.
- Una imagen generada previamente no sustituya silenciosamente las referencias originales.
- Las transformaciones de crop y resize mantengan correctamente los sistemas de coordenadas.
- Los lados anatómicos izquierdo/derecho se diferencien claramente de izquierda/derecha de imagen.

Introduce identificadores y hashes de referencias para detectar sustituciones accidentales.

Añade tests con personajes de apariencia muy distinta realizando la misma pose.

## QUALITY GATE 01

PASS si:

- La procedencia de cada dato está verificada.
- La pose se extrae de A.
- La identidad procede de B.
- No hay contaminación accidental de atributos.
- Los tests de intercambio de personajes mantienen idéntica la referencia de pose.
- Las transformaciones de coordenadas son reproducibles.

Si falla, corrige esta fase antes de avanzar.

---

# PHASE 02 — POSE TRACKING AND GEOMETRY

## Goal

Crear una representación anatómica consistente, independiente del estilo visual.

## Tasks

Audita DWPose y el sistema actual de mapping.

Investiga por qué únicamente aparecen cuatro huesos en determinados reportes.

Define un esquema canónico con:

- joint ID
- anatomical side
- image-space position
- normalized position
- confidence
- visibility
- occlusion state
- coordinate transform
- source provenance

Estados de visibilidad:

VISIBLE
OCCLUDED
INFERRED
UNKNOWN

Un punto oculto no debe tratarse como medición confirmada.

Maneja:

- Vista frontal.
- Vista lateral.
- Vista trasera.
- Rotación corporal.
- Brazos cruzados.
- Manos delante del torso.
- Piernas superpuestas.
- Ropa holgada.
- Personajes estilizados.
- Pérdida temporal de articulaciones.
- Diferencias de escala y perspectiva.

No supongas que todos los personajes son anatómicamente humanos.

Si el detector actual no ofrece cobertura suficiente, compara alternativas compatibles, como RTMPose y MediaPipe Pose.

No cambies de detector sin benchmarks.

Considera:

- Precision de keypoints.
- Cobertura.
- Estabilidad temporal.
- Latencia.
- Consumo de memoria.
- Coste de despliegue.
- Comportamiento con anime.

Mantén el mejor detector demostrado para los casos soportados o implementa selección adaptativa con criterios medibles.

## QUALITY GATE 02

PASS si:

- Todos los puntos disponibles se representan con confianza y visibilidad.
- No se inventan mediciones de articulaciones ocultas.
- La conversión de coordenadas es verificable.
- El mirroring está correctamente detectado.
- Las métricas no se declaran confiables usando pocos puntos sin suficiente cobertura.
- Existe un benchmark reproducible del tracker.
- No hay regresiones importantes frente al baseline.

No avances sin pruebas de geometría.

---

# PHASE 03 — CHARACTER RIG AND DEFORMATION

## Goal

Corregir los errores geométricos del character rig existente.

## Observed failures

- rightUpperArm exceeds stretch limits.
- 282 folded triangles.
- 3.3% overstretched.
- area ×0.87.

## Tasks

Inspecciona:

- Construcción de malla.
- Triangulación.
- Transformaciones afines.
- Correspondencia de joints.
- Peso de deformación.
- Escalado.
- Transformación de extremidades.
- Orden de capas.
- Regiones ocultas.
- Preservación de volumen.

Identifica por qué aparecen triángulos invertidos.

Verifica si la transformación está intentando deformar incorrectamente una superficie que debería redibujarse.

Evita estirar excesivamente:

- Cabeza.
- Manos.
- Antebrazos.
- Brazos.
- Torso.
- Piernas.

Evalúa estrategias geométricas más robustas, incluyendo deformación localizada y transformaciones que preserven mejor la estructura.

No implementes una técnica solamente porque su nombre parece adecuado.

Benchmarks antes y después.

Implementa un fallback controlado cuando el rig no puede representar una pose.

El fallback no debe marcar una deformación inválida como válida.

## QUALITY GATE 03

PASS si:

- La orientación de triángulos es comprobada.
- Las inversiones se detectan correctamente.
- El sistema rechaza deformaciones físicamente inconsistentes.
- No hay estiramientos silenciosos.
- Se identifica claramente cuándo necesita redibujarse una región.
- Los tests de transformaciones funcionan.
- El sistema conserva adecuadamente sus regiones visibles en casos soportados.

Si existen casos que no pueden resolverse geométricamente, deben pasar a un fallback explícito y verificable.

---

# PHASE 04 — MUSE IMAGE GENERATION

## Goal

Garantizar que Muse Image reciba las referencias correctas y que su salida pueda evaluarse de forma reproducible.

## Tasks

Inspecciona el request real enviado a Meta.

Comprueba:

- Orden de imágenes.
- Tipos de contenido.
- Resoluciones.
- Transparencia.
- Cropping.
- Conversión de formato.
- Prompt final.
- Contexto heredado.
- Historial entre generaciones.
- Parámetros soportados por el endpoint.

No asumas que Muse Image admite control estructural de pose o máscaras como condicionamiento si la API utilizada no lo documenta.

Si solo dispone de referencias visuales y texto, conserva explícita esa limitación.

Prueba dos estrategias de prompt:

A. Descripción existente.
B. Descripción estructurada más breve.

No des por hecho que el prompt corto es mejor.

Compara ambas utilizando exactamente las mismas referencias y, cuando exista soporte, parámetros equivalentes.

Implementa:

`single_frame_debug`

Este modo debe:

- Generar una imagen.
- Guardar request y response.
- Guardar prompt exacto.
- Registrar referencias.
- Guardar imagen sin modificaciones.
- Registrar uso y latencia.
- Evitar regeneraciones automáticas.
- Conservar artefactos para pruebas offline.

## QUALITY GATE 04

PASS si:

- Las referencias enviadas son correctas.
- El request respeta el contrato real de Meta.
- Una invocación produce como máximo una generación.
- El output original se guarda.
- Los fallos de API se distinguen de fallos de calidad.
- Los tests de integración verifican la construcción del request.

La prueba con inferencia real es obligatoria para validar el comportamiento real del proveedor. Si no hay acceso o presupuesto autorizado, reporta BLOCKED en vez de fingir una validación completa.

---

# PHASE 05 — QUALITY VALIDATION ENGINE

## Goal

Reemplazar las decisiones incorrectas del evaluador por validación confiable y contextual.

No desactives indiscriminadamente los checks.

## A. Pose evaluation

Evalúa:

- Keypoint correspondence.
- Joint angles.
- Relative distances.
- Normalized bone lengths.
- Body orientation.
- Hand placement.
- Global silhouette.

Utiliza únicamente observaciones suficientemente confiables.

Diferencia error de pose de error del detector.

## B. Proportion evaluation

Las proporciones deben medirse respecto al personaje de referencia y teniendo en cuenta:

- Estilo.
- Perspectiva.
- Oclusión.
- Ropa.
- Foreshortening.
- Variación anatómica legítima.

Investiga específicamente por qué right-of-image forearm registra +19%, +45% y +60%.

No asumas que estas diferencias son errores reales hasta validar los landmarks utilizados.

## C. Colour evaluation

Audita los cálculos actuales.

La similitud de color debe tomar como referencia el personaje, no el video.

Distingue:

- Colores base.
- Sombras.
- Reflejos.
- Piel.
- Lineart.
- Transparencia.
- Antialiasing.

Investiga por qué Mapping indica 53% de color overlap mientras otro evaluador indica 92.6% palette similarity.

Documenta qué mide cada score.

No cambies simplemente el umbral de 95% por otro número sin calibración.

## D. SAM 3.1

Utiliza segmentación para comparar siluetas y regiones cuando exista soporte real.

No atribuyas a SAM capacidades de estimación de pose que no tenga.

Maneja máscaras vacías, errores de segmentación y fondos transparentes.

## E. Visual review

Corrige:

`Visual review skipped: a measured check failed first`

En modo debug, la revisión visual debe ejecutarse independientemente de los resultados numéricos, siempre que exista una imagen válida y el evaluador esté disponible.

Debe identificar errores como:

- Extremidades fusionadas.
- Manos deformadas.
- Dedos incorrectos.
- Proporciones visualmente incoherentes.
- Identidad alterada.
- Diferencias importantes de pose.
- Errores de vestuario.
- Artefactos de segmentación.

No utilices el juicio de un LLM como métrica infalible.

## F. Decision engine

Estados:

ACCEPTED
REVIEW_NEEDED
REJECTED
INCONCLUSIVE

Clasifica hallazgos según severidad y confianza.

Un error crítico verificable puede justificar un rechazo.

Una advertencia estética leve no debe producir reintentos automáticos.

Una medición insuficiente debe producir INCONCLUSIVE.

## QUALITY GATE 05

PASS si:

- Cada métrica tiene definición comprobable.
- Las oclusiones están consideradas.
- El color no produce falsos rechazos conocidos.
- Se explica la disparidad entre métricas de color.
- La revisión visual se ejecuta en debug.
- Los estados están cubiertos por tests.
- Existen pruebas de falsos positivos y falsos negativos.
- La decisión final conserva trazabilidad.

---

# PHASE 06 — SINGLE FRAME END-TO-END

## Goal

Verificar el pipeline completo utilizando una sola imagen antes de continuar con secuencias.

## Tasks

Ejecuta:

Video frame → Pose → Character reference → Rig/Fallback → Muse Image → Validation → Output.

Conserva artefactos de cada etapa.

Primero reproduce el ejemplo problemático.

Después utiliza entradas adicionales diferentes.

Para cada resultado registra:

- Pose fidelity.
- Identity fidelity.
- Geometry validity.
- Proportion reliability.
- Silhouette consistency.
- Visual defects.
- Confidence.
- Processing time.
- API cost.

Una evaluación inconclusa no puede contarse como éxito.

## QUALITY GATE 06

PASS si:

- El flujo completo funciona con inferencia real.
- Las referencias son correctas.
- No existen errores de estado.
- Los resultados se conservan.
- Los evaluadores producen diagnósticos coherentes.
- Los fallos relevantes se detectan.
- Los casos aceptados tienen evidencia suficiente.
- No existe regeneración automática en debug.

Si este gate falla, no pases a nueve frames.

---

# PHASE 07 — TEMPORAL CONSISTENCY

## Goal

Corregir la pérdida de consistencia en secuencias de animación.

## Tasks

Analiza por qué los primeros frames pueden funcionar y los siguientes desviarse.

Verifica si existe:

- Reference drift.
- Identity drift.
- Pose drift.
- Repeated rescaling.
- Recursive cropping.
- Context accumulation.
- Reuse of generated frames.
- Error propagation.
- Temporal jitter.
- Inconsistent segmentation.
- Unstable pose tracking.

Diseña una arquitectura que mantenga:

- Referencia de identidad original estable.
- Pose original independiente por frame.
- Coordenadas consistentes.
- Escala y anclajes temporales.
- Coherencia de lineart.
- Coherencia de paleta.
- Continuidad del movimiento.

No uses únicamente el frame anterior generado como fuente de verdad para el siguiente.

Puedes usar información temporal cuando mejore la consistencia, pero sin sustituir las referencias originales.

Mide:

- Diferencia entre poses consecutivas.
- Desviación respecto al video.
- Variación de escala.
- Variación de identidad.
- Parpadeo visual.
- Cambios de silueta.
- Errores de acumulación.

Los principios de animación deben complementar las poses de referencia, no modificar arbitrariamente el movimiento original.

Primero verifica secuencias offline.

Después prueba la secuencia real de nueve frames con límites explícitos de inferencia.

## QUALITY GATE 07

PASS si:

- Los nueve frames completan el pipeline o reportan fallos legítimos y trazables.
- No se reutilizan incorrectamente salidas anteriores.
- La identidad permanece anclada a la referencia.
- Las transformaciones no acumulan errores de escala.
- La consistencia temporal mejora respecto a la línea base.
- Las métricas detectan jitter y cambios anómalos.
- No se aceptan frames claramente defectuosos por falta de cobertura.

No basta con conseguir 9/9 aprobados: la calidad debe ser verificable.

---

# PHASE 08 — GENERALIZATION AND RELEASE VALIDATION

## Goal

Demostrar que el arreglo no funciona exclusivamente con el ejemplo actual.

## Tasks

Crea un conjunto diverso de pruebas con entradas autorizadas o fixtures adecuados.

Debe cubrir, según las capacidades realmente soportadas:

- Anime.
- Cartoon.
- Diferentes proporciones.
- Personajes con ropa holgada.
- Personajes con ropa ajustada.
- Brazos levantados.
- Brazos cruzados.
- Movimientos laterales.
- Giros.
- Oclusiones.
- Movimiento rápido.
- Fondos variados.
- Diferentes resoluciones.
- Diferentes cantidades de frames.

Incluye casos adversos y no soportados.

No declares éxito universal cuando el detector o generador no pueda interpretar una entrada.

Para cada grupo mide:

- Pose accuracy.
- Identity consistency.
- Validation accuracy.
- Temporal stability.
- Failure rate.
- Latency.
- Resource usage.
- Regression count.

Compara con el baseline de Phase 00.

Separa benchmarks offline de evaluaciones con inferencia real.

Ejecuta:

- Tests unitarios.
- Integration tests.
- Typecheck.
- Lint.
- Build.
- Tests de regresión.
- Verificación de APIs.
- Verificación de persistencia de runs.
- Verificación de UI.
- Verificación de compatibilidad con Railway.

## QUALITY GATE 08

PASS si:

- No quedan regresiones críticas conocidas.
- Los cambios demuestran mejoras medibles.
- Las limitaciones están documentadas.
- Las nuevas rutas funcionan con el despliegue existente.
- Los ejemplos iniciales ya no dependen de reglas hardcodeadas.
- Los tests relevantes pasan.
- El comportamiento real de los modelos se ha verificado donde exista acceso autorizado.

No declares compatibilidad universal si solo se probaron unas pocas entradas.

---

# FINAL DELIVERY

Cuando todas las fases estén en PASSED, entrega:

1. Resumen ejecutivo de los problemas encontrados.
2. Causas raíz confirmadas.
3. Arquitectura final implementada.
4. Archivos creados y modificados.
5. Resultados de cada quality gate.
6. Comparación antes/después.
7. Resultados de pruebas single-frame.
8. Resultados de pruebas multi-frame.
9. Casos de regresión.
10. Limitaciones existentes.
11. Costes y requisitos de despliegue.
12. Cómo ejecutar y depurar el pipeline.

Si alguna fase está BLOCKED, entrega solamente lo verificado hasta ese punto, explica el bloqueo y no marques el proyecto como terminado.

# FINAL INSTRUCTION

Comienza inmediatamente por Phase 00.

Inspecciona el repositorio real.

No reescribas Focus desde cero.

No avances por cumplir una lista de tareas.

**Cada fase debe demostrar que funciona antes de desbloquear la siguiente.**

No quiero código que simplemente parezca correcto. Quiero un pipeline con pruebas reproducibles, evidencia visual, métricas confiables y comportamiento generalizable.
