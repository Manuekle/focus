# My characters: viabilidad y casos de uso para la hackathon

Fecha: 2026-10-27. Evaluación del código y la interfaz actuales; propuesta de alcance, todavía sin implementación. El usuario dispone de más de tres días para entregar, sin fecha exacta confirmada.

**Actualización posterior:** el alcance fue aprobado e implementado. Véase [My characters](MY_CHARACTERS.md) y [la validación real](MY_CHARACTERS_VALIDATION_2026-10-27.md). La restricción inicial de perfil descrita abajo fue retirada a petición del usuario: ahora se conserva la vista original y se pueden elegir otras cámaras, incluida la frontal. El texto siguiente conserva la evaluación previa a la implementación.

## Decisión recomendada

**Sí es viable añadir un estudio pequeño de personajes conectado con Flipbook.** No conviene construir ahora una plataforma completa de gestión de personajes. La calidad de los cambios de ropa y de la identidad entre versiones todavía requiere una prueba real.

La promesa del recorrido sería: **«Convierte tus referencias en un personaje, refina su apariencia y anímalo sin empezar de cero».**

El usuario principal es un creador que tiene imágenes de referencia, pero no tiene sprites, conocimientos de animación ni un personaje terminado. El resultado útil es una imagen reutilizable y una animación descargable de ese mismo diseño.

## Qué existe y qué falta

| Capacidad | Evidencia en el proyecto | Implicación |
| --- | --- | --- |
| Generación con varias imágenes e instrucciones | `server/animation/muse-image.ts:43` | Se puede reutilizar el cliente de Muse Image. |
| Modo de edición de imagen | `server/animation/muse-image.ts:48` | La integración acepta `action: edit`; falta el flujo específico de edición de personajes y comprobar su calidad. |
| Referencia principal y vistas adicionales | `server/animation/frame-generation.ts`, `shared/flipbook.ts:517` | Ya se preserva una referencia principal en cada dibujo. Los apoyos actuales representan al mismo personaje; para inspiración de ropa o estilo hacen falta instrucciones de rol específicas. |
| Preparación de referencia de perfil | `server/animation/reference-manager.ts:27` | Hay una base para obtener una imagen compatible con Flipbook, pero está vinculada a una animación. |
| Historial, sustitución y reparación de cuadros | `server/animation/flipbooks.ts`, `shared/flipbook.ts` | Hay patrones reutilizables; ese historial no es todavía un historial de personajes. |
| Animación y exportación | `server/animation/export.ts`, `docs/FLIPBOOK_REVIEW_2026-10-27.md:46` | Existe una prueba real de ocho dibujos con exportación MP4 y GIF verificada. |
| Cuenta y archivos persistentes | `server/projects.ts:54`, `server/animation/store.ts:241` | Se puede seguir la arquitectura de un contenedor con volumen, sin introducir otra infraestructura para la demo. |
| Selección de un personaje guardado | No existe entidad ni ruta de personajes; `createFlipbook` recibe un `imageId` | Hay que implementar la biblioteca y el traspaso. No basta con añadir una tarjeta en la interfaz. |

Muse Image documenta generación, edición y referencias en [su guía oficial](https://dev.meta.ai/docs/image-generation). La [guía de consistencia](https://dev.meta.ai/docs/cookbook/anchored-image-series) recomienda reutilizar referencias y comparar los resultados; no garantiza identidad perfecta.

## Tres alcances posibles

| Alternativa | Ventaja | Coste o límite | Decisión |
| --- | --- | --- | --- |
| Guardar únicamente la referencia de un Flipbook | Poca implementación | No resuelve crear y editar el personaje antes de animarlo | Alternativa si falla la prueba de edición o se reduce el tiempo disponible. |
| Biblioteca pequeña, edición por texto e historial | Cierra el recorrido de referencias a animación | Necesita persistencia propia, trabajos de generación y traspaso a Flipbook | **Recomendada.** |
| Vestuario separado, colecciones, vistas, expresiones y editor con pincel | Mayor alcance futuro | Multiplica pantallas, generación y casos de consistencia | Posponer. |

## Alcance concreto de la demo

1. **Mis personajes:** galería de personajes con nombre, imagen del diseño seleccionado y acceso al estudio. Acceso desde la navegación de Flipbook y desde su selector de entrada, conservando el mismo shell visual.
2. **Crear desde referencias:** una referencia principal y hasta dos apoyos opcionales. Los apoyos pueden indicar ropa o estilo; la principal define la apariencia de partida. Una instrucción y una imagen generada por acción, sin producir cuatro propuestas automáticamente.
3. **Editar con texto:** cambiar ropa, colores o un accesorio. La nueva imagen parte de la versión seleccionada y recibe la base del personaje como apoyo de identidad. Las instrucciones deben distinguir identidad de vestuario para no restaurar accidentalmente la ropa antigua.
4. **Versiones con nombre:** cada resultado exitoso se guarda, puede llamarse «Base», «Chaqueta roja» o «Invierno» y se puede seleccionar para seguir trabajando. No hay carpetas de vestuario ni un árbol visual de ramas. El origen de cada versión se registra internamente.
5. **Comparar y volver:** ver la versión seleccionada junto a otra y continuar desde cualquiera de ellas. Cambiar de selección o volver a un resultado anterior no genera imágenes ni consume IA.
6. **Usar en Flipbook:** transferir una copia de la versión seleccionada. También permitir elegir un personaje desde la pantalla de creación de Flipbook. El movimiento sigue siendo una elección separada y generar la animación requiere pulsar su botón.
7. **Descargar imagen:** PNG del diseño seleccionado. Los formatos de animación siguen disponibles en el exportador existente.

El diseño inicial se solicita de cuerpo completo, de perfil y sobre fondo sencillo para aumentar su compatibilidad con el motor actual. Esto es una restricción deliberada de esta primera experiencia. Una salida que incumpla esas condiciones debe poder corregirse; no se etiqueta como garantizada por una simple instrucción.

Quedan fuera: etiquetas y colecciones, entrenamiento de modelos, generación automática de tres vistas, biblioteca de expresiones, importación de sprite sheets, selección de zonas con pincel, rigging y nuevos movimientos de animación. La ropa se organiza mediante nombres de versiones. Ninguna de esas exclusiones elimina capacidades ya existentes de Flipbook.

## Qué hace que la experiencia se sienta premium

- **La imagen ocupa el centro.** En la pantalla actual observada, los paneles Character y Background preceden al reproductor. El estudio nuevo debe dedicar el espacio principal al personaje y mostrar referencias y detalles de forma secundaria.
- **Una acción principal según el momento:** «Crear personaje», «Generar cambio» o «Usar en Flipbook». El botón de animar siempre deja claro qué versión se usará.
- **Un editor breve:** imagen grande, instrucción de cambio y una tira de versiones. Los nombres de modelos y parámetros técnicos no necesitan ocupar la interfaz principal.
- **El resultado anterior sigue visible mientras se genera.** La espera comunica trabajo real; no se inventa un porcentaje ni se oculta el personaje detrás de un esqueleto vacío.
- **Guardado automático después de cada resultado válido.** Estado visible de guardado, selección persistente al recargar y errores que permiten reintentar sin perder la instrucción.
- **Comparación estable:** imágenes contenidas, misma proporción y sin recortes inesperados. En móvil se conserva primero la imagen y después los controles.
- **Continuidad visual:** reutilizar tipografía, colores, componentes y cuenta de Focus. La coherencia viene del recorrido completo, sin añadir otro sistema de diseño.

## Casos de uso

### CU-1 — Crear una mascota sin tener dibujos terminados

**Necesidad:** una creadora quiere una mensajera ilustrada para su canal; dispone de una referencia visual y otra del vestuario.

**Recorrido:** abre Mis personajes → sube referencias → describe «mensajera alegre, chaqueta verde y mochila» → genera una imagen → la llama Luna.

**Resultado:** Luna aparece en la galería y tiene una primera versión guardada. No se ha generado una animación ni se ha requerido un sprite.

**Criterio de éxito:** tras recargar se conservan el personaje, las referencias y la imagen. Una generación fallida conserva los datos de entrada y permite reintentar.

### CU-2 — Cambiar ropa sin perder el diseño anterior

**Necesidad:** la misma creadora quiere una versión de invierno de Luna.

**Recorrido:** selecciona Base → pide «cambia la chaqueta por un abrigo rojo; conserva rostro, cabello, mochila y pose» → genera → nombra el resultado Invierno → compara ambas imágenes.

**Resultado:** puede usar Base o Invierno sin sobrescribir ninguna. Si la cara cambió demasiado, puede continuar desde Base y reformular la instrucción.

**Criterio de éxito:** las imágenes y las instrucciones de ambos resultados siguen disponibles. Mantener identidad es un objetivo visual que debe comprobarse con la prueba real, no una garantía del esquema de datos.

### CU-3 — Explorar una corrección y volver atrás

**Necesidad:** prueba una mochila más pequeña y prefiere el resultado anterior.

**Recorrido:** genera la corrección → compara → selecciona Invierno otra vez → continúa trabajando desde ella.

**Resultado:** recupera inmediatamente una imagen que ya tenía. El intento nuevo permanece en el historial y no se vuelve a generar el resultado anterior.

**Criterio de éxito:** seleccionar o comparar versiones hace cero llamadas al proveedor. Un doble clic en generar no crea dos trabajos.

### CU-4 — Animar exactamente la apariencia elegida

**Necesidad:** quiere una animación de Luna con abrigo rojo saludando.

**Recorrido:** selecciona Invierno → Usar en Flipbook → elige Wave → genera → revisa → exporta GIF o MP4.

**Resultado:** Flipbook usa la imagen seleccionada sin descargarla y volverla a subir. Después puede volver a Luna y crear otra animación.

**Criterio de éxito:** el traspaso conserva nombre y procedencia, guarda una copia de las imágenes necesarias y mantiene un enlace al personaje. Crear una nueva versión de Luna no altera esta animación. Preparar la entrada a Flipbook no arranca por sí solo el trabajo de ocho dibujos.

### CU-5 — Reutilizar el personaje en otra sesión

**Necesidad:** días después necesita otra animación del mismo personaje.

**Recorrido:** inicia sesión → abre Mis personajes → selecciona Luna e Invierno → inicia una animación diferente.

**Resultado:** no busca archivos ni reconstruye instrucciones. Reutiliza el diseño ya guardado; únicamente la nueva generación consume trabajo de IA.

**Criterio de éxito:** el personaje sobrevive al reinicio de la aplicación y al vencimiento de uploads temporales. Otra cuenta no puede consultar sus referencias, versiones ni trabajos.

## Integración mínima que tendría sentido

```text
Referencias + instrucción
    → trabajo acotado de Muse Image
    → personaje + versiones persistentes
    → selección de una versión
    → copia de esa versión a la entrada de Flipbook
    → análisis y poses existentes → recortes → animación → exportación
```

Separar el personaje de la animación: un personaje tiene dueño, referencias, versiones y una selección actual; una animación conserva la versión que recibió. No conviene crear Flipbooks ficticios para poder generar una imagen.

Reutilizar el cliente de Muse Image, validación de uploads, escrituras atómicas, sesiones y patrones de trabajos en segundo plano. El cliente y el registro de uso hoy requieren `flipbookId`; hay que admitir trabajo de personajes sin atribuirlo a una animación inexistente. Los trabajos nuevos deben contar en el límite global y tener un presupuesto de imágenes propio. Una sola generación pendiente por personaje y una clave de operación evitan duplicados por reintentos o doble clic.

El guardado puede seguir en el volumen del contenedor actual. Referencias y versiones deben copiarse a almacenamiento retenido del personaje: enlazar el `imageId` temporal no basta, porque `cleanupFlipbooks` elimina los uploads tras 24 horas. Los recortes de SAM se difieren hasta que hacen falta para animar; editar una imagen no necesita ejecutar toda la cadena de Flipbook.

La biblioteca funciona con la cuenta existente. Las rutas de personajes, trabajos y medios verifican al propietario en el servidor. También hay que proteger los derivados privados al entrar en Flipbook: sus GET, acciones y medios actuales se resuelven principalmente por UUID y no equivalen por sí solos a acceso privado por cuenta. El patrón de `getProject(id, ownerId)` sí comprueba propiedad y sirve de referencia.

## Riesgos y condiciones para entregar

| Riesgo | Lo verificado | Condición antes de la demo |
| --- | --- | --- |
| La edición cambia rostro o proporciones además de la ropa | Existe el modo edit y el manejo de referencias; el flujo de vestuario no se ha probado en vivo en esta revisión | Probar creación y un cambio de ropa con las referencias que se usarán. Comparar las imágenes antes de ampliar la interfaz. |
| Una animación tarda varios minutos | La prueba real documentada tardó aproximadamente 5 min 12 s, con una pausa de revisión incluida | Tener un resultado real preparado e identificado como tal; mostrar el trabajo nuevo sin prometer que termina dentro del pitch. |
| Referencias que desaparecen | Los uploads temporales caducan tras 24 horas | Probar retención de personajes y copias independientes al animar. |
| Guardado que parece privado y se accede por enlace | La lista por cuenta existe; varios medios y acciones de Flipbook usan UUID | Verificar acceso por propietario también en la ruta de uso del personaje y sus derivados. |
| Duplicación y gasto de llamadas | Hay límites y presupuestos por Flipbook, no por personaje | Incluir trabajos de personajes en límites, uso y reintentos; ninguna llamada al navegar por versiones. |
| Integración lista localmente pero no en el entorno de presentación | El repo prepara contenedor, volumen y flags; no se verificó el despliegue objetivo en esta revisión | Probar la cuenta, el volumen y el recorrido en el host que se presentará. |

No se debe prometer la misma calidad de la carrera de LightWitch. El motor actual tiene ocho dibujos por acción; la prueba real disponible utiliza un personaje sencillo. Generar un vestuario convincente no demuestra por sí solo consistencia de una animación compleja.

## Prioridades con más de tres días

1. **Primero, reducir la incertidumbre visual:** una creación, un cambio de ropa y una animación con el tipo de referencias que se presentará. Si identidad o edición fallan repetidamente, recortar a guardar y reutilizar referencias del mismo personaje y mantener el flujo de animación existente.
2. **Después, cerrar el recorrido completo:** biblioteca pequeña, persistencia, generación, selección de versiones y traspaso. Mejor una sola propuesta por clic y una animación terminada que varias secciones incompletas.
3. **Luego, pulir:** composición, comparación, espera, errores, navegación de regreso y móvil. Renombrar versiones cubre el caso de categorizar ropa.
4. **Reservar un bloque final para la presentación:** prueba desde una cuenta nueva, recarga, fallo de generación, aislamiento por cuenta y descarga real en el entorno objetivo.

Este orden no es una estimación cerrada de entrega: quedan por medir la calidad del nuevo flujo, su integración y la disponibilidad real del equipo.

## Guion de demo recomendado

La historia completa usa una sola protagonista: **Luna cambia de vestuario y cobra vida.**

Mostrar las referencias y crear el personaje. Mostrar un cambio de abrigo, comparar y elegir Invierno. Usar esa versión en Flipbook, elegir Wave y mostrar una animación real exportada. Si el pitch es más corto que la generación, iniciar el trabajo real y enseñar un resultado preparado, dejando clara su procedencia. La prueba de valor es que el personaje y la ropa reconocibles llegan a un archivo reproducible.

Muse Image crea y edita el diseño; Muse Spark interpreta el personaje y prepara las poses; SAM recorta los dibujos para componerlos. Es el uso existente de los modelos en el proyecto, conectado en un recorrido comprensible. No se han verificado las bases específicas ni el criterio de evaluación de la hackathon; esta recomendación evalúa producto y viabilidad técnica.

Como referencia de coste, Meta publica [US$0,01 por imagen generada](https://dev.meta.ai/docs/pricing-rate-limits). Una creación, una edición y ocho dibujos sumarían US$0,10 solamente en Muse Image si cada paso produce una imagen y no se repite. Ese cálculo no incluye Muse Spark, SAM, referencias adicionales generadas, reintentos facturables ni alojamiento.

## Verificación realizada en esta revisión

- `pnpm typecheck`: pasó.
- Cinco suites seleccionadas de planificación, referencias/reparación, integración de Flipbook, exportación y autenticación: **84 pruebas pasaron**. Usan servicios simulados para las llamadas de IA; no prueban calidad visual del nuevo flujo.
- Inspección del navegador en `/flipbook` y en una animación real existente: entrada de dibujo, organización de controles, cuadros, versiones de exportación y guardado.
- Lectura del informe y los registros conservados de la prueba real anterior: ocho dibujos, nueve segmentaciones y exportaciones verificadas. En esta revisión no se hicieron nuevas llamadas pagadas.
- Los dos defectos del informe anterior no se tomaron como pendientes sin comprobar: el código actual ya reestablece el reloj de reproducción y la suite pasó la prueba que evita restaurar un primer dibujo sin recorte utilizable.

## Criterio para dar por terminada esta propuesta si se implementa

El recorrido CU-1 → CU-2 → CU-4 debe funcionar con imágenes reales, conservar sus datos al recargar y producir un archivo reproducible. CU-3 no debe hacer llamadas de IA. CU-5 debe conservar propiedad y referencias fuera del almacenamiento temporal. Un error o reinicio no puede borrar la última imagen válida. Las pruebas existentes de Flipbook deben seguir pasando.

La generación y edición de personajes siguen siendo trabajo propuesto. Este documento entrega la evaluación y los casos de uso; no afirma que esa funcionalidad esté construida o validada en vivo.
