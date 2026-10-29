# Flipbook: secuencia continua, audio y movimiento reutilizable

Fecha: 2026-10-28.

## Decisión del usuario

El comportamiento por defecto será **«Secuencia continua, con la duración
elegida»**, confirmado en el chat. Aumentar los dibujos por segundo añade
dibujos del movimiento y conserva la duración. La coreografía se desarrolla
durante el clip completo; no se obtiene repitiendo las ocho poses iniciales.

El usuario aprobó este diseño completo en el chat con «lo apruebo».
La implementación y sus verificaciones usan proveedores simulados; la aprobación
del diseño no inicia por sí sola una prueba con cientos de imágenes de pago.

## Problema verificado

- `shared/flipbook.ts` valida exactamente ocho poses para cada ciclo de un
  personaje y guarda los intermedios por separado. Sus esquemas de escenas
  admiten hasta 48 dibujos, pero solo para varias figuras durante 1–6 segundos.
- `server/animation/pose-planning.ts` pide exactamente ocho poses. Aumentar la
  duración exportada repite ese ciclo y aumentar su ritmo acelera las poses.
- `app/flipbook/frame-strip.tsx` muestra las poses clave, incluso si ya existen
  intermedios. El panel de corrección actúa sobre un dibujo individual.
- El reproductor y el MP4 tienen un reloj de salida de 60 fps. Ese reloj no
  equivale al número de dibujos distintos del personaje.
- La carga de audio existe en `living-panel.tsx` y `living-pictures.ts`, pero el
  exportador de flipbooks no la recibe. La duplicación con otro personaje y
  la referencia de movimiento por video no tienen un flujo propio.

## Alcance y orden

La mejora tiene cuatro partes que comparten la misma línea de tiempo:

1. Secuencia continua, generación completa y editor de todos sus dibujos.
2. Audio sincronizado en el reproductor y la exportación.
3. Duplicación con otro personaje, conservando el movimiento.
4. Video subido por el usuario como guía temporal de movimiento.

Se implementan en ese orden y se verifican por separado. La primera parte no
depende de que el análisis visual de un video alcance suficiente fidelidad.
El objetivo completo conserva las cuatro partes; una función no se presenta
como disponible hasta que su flujo funciona de extremo a extremo.

## 1. Secuencia continua

### Creación y edición

- La creación de un personaje ofrece «Secuencia continua» por defecto y «Ciclo
  repetido» como alternativa explícita. Los proyectos existentes conservan
  su comportamiento y sus medios.
- El modo continuo admite 1–20 segundos enteros y 8, 12 o 24 dibujos/s. El
  valor inicial es 4 segundos a 24 dibujos/s: 96 dibujos. Veinte segundos a
  24 dibujos/s son 480 dibujos. Estos límites describen la primera versión.
- La creación muestra duración, dibujos/s, total de dibujos y trabajo de
  referencia adicional antes de iniciar generación. No llama «60 dibujos/s»
  al MP4 de 60 fps.
- El plan distribuye la acción por toda la duración: preparación, desarrollo
  y cierre según la instrucción. No impone que el último dibujo vuelva al
  primero. Los movimientos naturalmente periódicos pueden repetir pasos,
  pero cada instante tiene su entrada temporal y su generación propia.
- El reproductor continuo se detiene al final. «Repetir» permite volver a
  reproducir el clip completo, sin alterar su contenido ni exigir un cierre
  circular. Buscar, avanzar y seleccionar funcionan sobre todos los dibujos.
- La línea de tiempo muestra todos los dibujos con número, tiempo y estado.
  Usa miniaturas y carga por ventanas para evitar decodificar cientos de
  imágenes grandes simultáneamente.
- Una edición de duración o densidad crea una revisión del plan y muestra los
  dibujos que faltan. Aumentar densidad conserva la duración; no acelera la
  reproducción. «Generar pendientes» es la acción explícita que dibuja lo
  nuevo. Las revisiones anteriores y sus exportaciones permanecen disponibles.

### Contrato temporal

- Añadir un modo de plan discriminado, `sequence` o `cycle`. La lectura de
  documentos antiguos sin modo los interpreta como `cycle`.
- Conservar los IDs y validadores históricos de ciclos y escenas. Introducir
  IDs propios para dibujos de secuencia; ampliar el límite de una escena no
  debe convertir una escena en una secuencia individual accidentalmente.
- El tiempo de una secuencia usa ticks enteros de 1/24 s. Cada dibujo guarda
  su tick; a 8 dibujos/s se usan los ticks 0, 3, 6…; a 12, 0, 2, 4…; a 24,
  todos los ticks. Esto permite reutilizar dibujos en instantes coincidentes
  cuando cambia la densidad, sin comparaciones imprecisas de decimales.
- Hay exactamente `duración × dibujosPorSegundo` entradas activas, ordenadas
  por tick, sin duplicados, sin huecos en la densidad elegida y sin envolver
  el índice al llegar al final. Un clip de 4 s a 24 dibujos/s tiene ticks
  0–95; el dibujo del tick 95 se mantiene hasta el final de los 4 s.
- El reloj de salida sigue a 60 fps. Preview, MP4, GIF y exportación de PNG
  consultan la misma función de tiempo a dibujo. El MP4 conserva su duración
  exacta aunque el último dibujo o el audio requieran relleno.
- Las posiciones del personaje pertenecen al escenario del clip. No se
  aplica automáticamente a una secuencia el registro de pies ni el reinicio
  del desplazamiento de un ciclo de caminata.

### Planificación y generación

- Separar el movimiento reutilizable de la identidad: tiempos, posición,
  orientación y postura describen la acción; rasgos, ropa y estilo proceden
  de la referencia del personaje que se está generando.
- Planificar una estructura global y desarrollar ventanas de hasta 2 s con
  sus tiempos absolutos y el contexto del tramo anterior. Validar cantidad,
  límites, continuidad e IDs en servidor antes de aceptar cada ventana.
- Guardar esa estructura de movimiento con tiempos independientes de la
  densidad de dibujos. Añadir muestras a 24 dibujos/s no vuelve a inventar
  la coreografía que ya estaba aprobada a 8 o 12 dibujos/s. Extender la
  duración desarrolla la continuación; acortarla cambia el punto final,
  conservando los dibujos anteriores en su revisión.
- No pedir al modelo un bloque ilimitado de 480 descripciones. Los tramos
  mantienen una sola acción global y no vuelven a empezar la coreografía.
- Cada dibujo usa la referencia inmutable del personaje y el contexto visual
  vecino cuando está disponible. El generador no puede sustituir la identidad
  por la del vecino o por la persona de un video de movimiento.
- Reutilizar el límite de dos solicitudes de imágenes simultáneas y programar
  trabajo por ventanas, sin crear cientos de solicitudes en espera con sus
  imágenes ya cargadas en memoria.
- Persistir por dibujo el estado, versión y consumo. Cancelar conserva lo
  terminado, detiene trabajo pendiente y permite continuar sin redibujarlo.
  Un reinicio del servidor deja un estado recuperable mediante «Continuar»;
  no empieza nuevas llamadas de pago por su cuenta.
- La revisión humana sigue siendo necesaria para evaluar identidad y
  anatomía. Tener 24 dibujos/s no certifica continuidad visual ni calidad.

### Presupuesto y errores

- La app calcula en servidor el total de dibujos pendientes y las referencias
  o fondos adicionales. Muestra cantidades exactas; solo muestra dinero si
  existe una tarifa configurada verificable.
- Mantener los límites de gasto, actividad y proveedor existentes. Elegir una
  secuencia no aumenta esos límites ni los elude silenciosamente. Si no cabe,
  informar del total y aplicar el mecanismo explícito de confirmación vigente.
- Reintentos no generan de nuevo dibujos terminados ni descuentan dos veces
  una reserva. Reembolsar solo fallos que el contrato actual identifica como
  no facturados; un resultado de facturación incierto no se declara gratuito.
- Los dibujos ausentes o fallidos son visibles en la línea de tiempo. No se
  exporta una secuencia incompleta rellenándola con el primer ciclo.
- El chat usa intervalos temporales y dibujos de la secuencia. Sus propuestas
  extensas se guardan en servidor y se aplican mediante un ID de propuesta
  ligado a la revisión, evitando enviar cientos de instrucciones en el cuerpo
  limitado de la API. Las poses aprobadas siguen protegidas.

### Exportación y memoria

- Cachear por revisión del plan, versiones de dibujos, fondo y audio. Cambiar
  contenido temporal invalida las exportaciones correspondientes.
- Cargar sprites del reproductor en una caché acotada de 12 imágenes grandes,
  aparte de sus miniaturas. Precargar alrededor del instante visible.
- Exportar fotogramas por flujo. Dividir los atlas en páginas de hasta
  4096 × 4096 píxeles, con un manifiesto que conserva tiempos y orden. No
  construir un único atlas de cientos de sprites en memoria.

## 2. Audio del flipbook

- Añadir un panel «Audio» con subir, sustituir, quitar, escuchar, volumen,
  punto de inicio en la pista y punto de entrada en el clip.
- Aceptar MP3, M4A, AAC, WAV y OGG con el límite vigente de 60 s y de bytes
  del audio de Living Pictures. Compartir validación y normalización AAC;
  guardar la pista bajo la propiedad y ciclo de vida del flipbook.
- El audio usa segundos absolutos del clip. Pausa, búsqueda, velocidad de
  previsualización y repetición mantienen sincronía. El audio se inicia tras
  una interacción del usuario; no se promete autoplay audible.
- Al exportar MP4, recortar lo sobrante y rellenar con silencio lo que falte.
  Un audio corto no recorta el video. En secuencias no aplicar automáticamente
  el fundido circular de Living Pictures, que cambiaría el final de la pista.
- GIF, atlas y PNG son formatos sin audio; la interfaz lo indica al elegirlos.
- Al reabrir el proyecto se recuperan pista, volumen y tiempos. Sustituir la
  pista invalida su caché de exportación sin alterar dibujos.

## 3. Duplicar con otro personaje

- Acción «Duplicar con otro personaje» dentro del flipbook. Permite escoger
  una versión de un personaje propio o subir una nueva referencia.
- Crear un flipbook con ID independiente y el mismo movimiento, tiempos,
  duración, densidad, cámara, fondo y ajustes de audio. Conservar intacto el
  original y abrir la copia con el nombre del personaje nuevo.
- Copiar el plan de movimiento y readaptar las instrucciones de apariencia a
  la identidad nueva. No copiar píxeles, aprobaciones, revisiones de calidad
  ni historial de dibujos del personaje anterior como si fueran del nuevo.
- Copiar los medios reutilizables a almacenamiento propio de la copia, para
  que borrar o editar el original no rompa el fondo, la pista o la referencia
  de movimiento de la nueva animación.
- Mostrar el trabajo de generación de la copia antes de iniciarlo. «Crear
  copia» prepara el proyecto; generar los dibujos usa la acción de generación
  y los controles de presupuesto habituales.
- Repetir la operación conserva ambos proyectos y admite un tercer personaje.

## 4. Video como referencia de movimiento

- Entrada «Usar video de referencia» en creación y en el editor. Subir MP4 o
  MOV, previsualizarlo y seleccionar un tramo de 1–20 segundos enteros, con
  inicio ajustable dentro del video. El movimiento se conserva a velocidad
  normal; la duración de la secuencia coincide con la del tramo seleccionado.
- Reutilizar la ingestión y validación de video, con límites vigentes de bytes,
  duración y resolución de origen. Normalizar rotación y tiempo antes de
  muestrear. No descargar enlaces ni aceptar rutas arbitrarias del cliente.
- Al adjuntar un video al editor, proponer una revisión de movimiento antes
  de sustituir el plan activo. Conservar la revisión y dibujos anteriores.
- Extraer guías visuales con tiempo absoluto en una cuadrícula de 24 Hz;
  una ventana de planificación solo lee las muestras que necesita. La
  referencia queda asociada al movimiento, separada de la identidad.
- El análisis describe postura, orientación y posición por instante. El
  generador recibe la guía correspondiente como movimiento y la ilustración
  elegida como identidad. La persona, ropa y fondo del video no sustituyen
  al personaje ni se convierten en el fondo de la animación.
- Conservar el audio del tramo solo cuando el usuario active «Usar audio del
  video»; ese audio se conecta al mismo panel Audio y al mismo reloj.
- La primera versión admite una persona visible y cámara fija. Si aparecen
  varias personas, pedir un tramo con una sola; el seguimiento de una persona
  elegida dentro de un grupo queda fuera de esta versión. Si la figura no
  es visible o el movimiento no se puede interpretar, presentar el error o
  los instantes inciertos sin fingir una extracción correcta.
- Usar el proveedor de imágenes y planificación ya configurado. No prometer
  captura de movimiento exacta ni añadir otro proveedor o plugin por defecto.
  La fidelidad visual se evalúa con un clip de prueba antes de dar por
  terminada esta función.

## Panel de corrección del dibujo

- Titular el panel «Corregir este fotograma» e identificar número y tiempo.
- Explicar cada acción junto a su control: mejorar conserva la pose, redibujar
  vuelve a generarla y sustituir carga una imagen del usuario. Mostrar que las
  dos primeras generan un dibujo, sin confundirlas con densidad o duración.
- Mover método de recorte, ajuste de tamaño y distancia de color a «Detalles
  técnicos». No presentar esos valores como una puntuación de calidad.
- Mantener notas, aprobación y versiones. En secuencias, cambiar el orden de
  un dibujo debe ser una edición temporal explícita, no un desplazamiento
  accidental que cambie el movimiento o su sincronía con el video.

## Límites de confianza

- Autorizar en servidor cada proyecto, personaje, versión y medio utilizado,
  también al duplicar, aplicar una propuesta, descargar o exportar. Los IDs
  del cliente y del modelo no prueban propiedad ni acceso.
- Validar el tipo real y bytes de las cargas. Trabajar con nombres generados
  por servidor y rutas confinadas a cada recurso. Rechazar entradas de red o
  listas de reproducción que hagan a FFmpeg abrir otros recursos.
- Ejecutar herramientas de medios con argumentos construidos por servidor,
  sin shell, protocolos permitidos y tiempos, disco, salida y concurrencia
  limitados. No convertir texto del modelo en comandos o filtros ejecutables.
- Tratar textos o instrucciones visibles dentro de videos e imágenes como
  datos de referencia. No pueden cambiar límites, permisos, identidad o
  autorización de llamadas de pago.
- Persistir progreso y consumo sin registrar las imágenes o pistas completas
  en logs. Los medios de la copia tienen su propio borrado y retención.

## Verificación y condiciones de aceptación

1. Matemática temporal: 4 s × 24 = 96 dibujos y 20 s × 24 = 480; los tiempos
   son monótonos y el último dibujo no vuelve al primero. Cambiar de 8 a 24
   añade posiciones conservando tiempos coincidentes y duración.
2. Ciclos históricos: mismos IDs, ritmos, intermedios y exportaciones; escenas
   de varios personajes y Living Pictures conservan sus límites y funciones.
3. Planificador: validación estricta de ventanas, cantidad e IDs; continuidad
   entre tramos y recuperación de respuestas incompletas con reintento acotado.
4. Generación con proveedor simulado: 96 y 480 estados completos; máximo dos
   imágenes simultáneas; cancelar y continuar; presupuesto, errores y edición
   de revisión sin doble cargo ni aplicación de resultados obsoletos.
5. Preview y export: mismos dibujos en los mismos instantes; MP4 de duración
   exacta a 60 fps; audio largo, corto, desplazado y ausente; audio sincronizado
   al buscar; GIF/PNG sin audio; atlas paginado en orden y con tiempos correctos.
6. Duplicación: el movimiento y ajustes coinciden, la identidad se renueva y
   los medios de la copia sobreviven a borrar el original. Comprobar denegación
   de acceso a proyectos o personajes de otra cuenta.
7. Referencia de video: rotación, recorte, sujeto único visible, muestras y
   tiempos correctos; rechazo de archivos ilegibles, exceso de límites y
   entradas con referencias externas. Un fallo no destruye el plan anterior.
8. UI: teclado, nombres accesibles, progreso y errores útiles en escritorio
   y móvil; no cargar todos los sprites grandes. Ningún ajuste de fps o tiempo
   genera imágenes de pago sin una acción explícita.
9. Ejecutar TypeScript, ESLint y pruebas de los módulos afectados. Realizar
   evaluación visual con un clip aportado para esa prueba y la autorización
   correspondiente a su cantidad de dibujos; los tests simulados no certifican
   la calidad de los dibujos generados.
