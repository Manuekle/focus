# My characters — validación de entrega

Fecha: 2026-10-27. Entorno local: `http://127.0.0.1:3200`, con Flipbook habilitado. Cuenta de demostración local: **Elf-chan Studio**, creada mediante el acceso simulado existente. No se utilizó una cuenta externa ni se desplegó el cambio.

## Resultado comprobado

El recorrido funciona con imágenes reales: referencia original → primer diseño → cambio de abrigo → versión frontal → copia en Flipbook → ocho poses → corrección de un fotograma → exportación MP4 y GIF. Todas las generaciones de esta demostración usan la referencia suministrada `public/characters/elf-chan.png` como ancla de identidad. Las pruebas automáticas sustituyen los servicios de pago; los resultados descritos aquí usan los modelos reales del proyecto.

Personaje: `cf5d85dd-ddcd-496b-b412-30b0d4c64faf`. Original guardado: `v-f625769ba05d`.

| Versión conservada | ID | Resultado |
| --- | --- | --- |
| Base design | `v-b7d1738df517` | Cuerpo completo, ropa azul, trenza rubia, ojos verdes y orejas puntiagudas. |
| Forest coat | `v-bba966d6ae3b` | Cambio a abrigo verde, sin sobrescribir Base. |
| Front · forest coat | `v-1e2f8aab2f5c` | Mismo diseño con abrigo, mirando a cámara. Es la versión seleccionada al entregar. |

Las dos primeras imágenes conservan sus vistas de perfil en el historial. Tras la petición de cámaras libres se creó la tercera de frente; los nuevos diseños ya no reciben una instrucción que los fuerce a perfil. La referencia original sigue visible junto a las tres versiones.

## Animación frontal real

Flipbook: `93ffccf3-d1e1-4dfa-bb86-8801a5183a12`, acción **Wave**, `requestedView: front`, `plan.view: front`. Se importó la versión frontal seleccionada y se conservó una copia independiente de su imagen y de la identidad original. El análisis reconoció `view: front`, `facing: front`, cuerpo completo y pies visibles. La referencia se usó directamente, sin pagar un redibujo de perfil.

Los ocho fotogramas terminaron y se recortaron mediante SAM 3.1. La inspección de la hoja de contacto confirmó cara y torso de frente durante todo el ciclo, además del abrigo, cabello, orejas y botas reconocibles. En la primera salida el séptimo fotograma cambiaba de brazo. Se redibujó únicamente ese fotograma con una corrección explícita; el anterior quedó en su historial. La nueva hoja mantiene el mismo brazo. Los prompts finales también fijan la continuidad del brazo durante Wave.

Registros vinculados a este Flipbook: **1 análisis, 1 planificación, 9 dibujos** (ocho más una corrección) y **10 segmentaciones**; todos constan como exitosos. El presupuesto muestra 9/16 dibujos. No se llamó a la revisión opcional de IA.

| Exportación real | Verificación independiente |
| --- | --- |
| MP4 vertical | H.264, 514 × 912, 24 fps, 96 fotogramas, 4,00 s; decodificación completa sin errores. |
| GIF vertical | 361 × 640, ocho imágenes, 1,01 s por ciclo; decodificación completa sin errores. |

FFprobe verificó ambos archivos y FFmpeg los decodificó completos. El exportador de la aplicación también conserva sus metadatos verificados. Se guardaron copias en la carpeta de evidencias indicada abajo. La animación de perfil anterior `037db0f1-6d64-431b-b4bb-0dfe46c68986` permanece lista y permite comprobar compatibilidad con planes previos sin el campo `view`.

## Verificación del producto

- Selección persistente de la versión frontal al volver al estudio; tres imágenes e identidad original conservadas.
- Comparación y navegación por versiones sin llamar a IA. Nombre del personaje y nombres de versiones editables.
- Diseño de escritorio inspeccionado a 1360 px; móvil a 390 px, sin desbordamiento horizontal. Se corrigió un conflicto de especificidad que mostraba la biblioteca encima del personaje en móvil. La emulación de tamaño se restauró al finalizar.
- Las rutas reales sin sesión devuelven 401 para el personaje y su PNG; 404 para el Flipbook privado y sus exportaciones. Las pruebas cubren también el rechazo a otro propietario.
- El traspaso conserva procedencia, propietario y referencia original, sin depender del upload temporal ni iniciar automáticamente la animación.

## Comprobaciones de código

- Suite completa: **441 pruebas pasaron; una prueba de carga optativa omitida**, en 37 archivos de pruebas más un archivo omitido.
- Después de los ajustes finales de prompts y reconocimiento de cámaras alta/baja: **44 pruebas específicas pasaron**, incluyendo la continuidad de la vista frontal por las ocho llamadas del motor.
- TypeScript y ESLint pasaron; compilación de producción con `NEXT_PUBLIC_ENABLE_FLIPBOOK=true` exitosa.
- `git diff --check` sin errores. No se creó commit, pull request ni despliegue. Se conservaron los cambios simultáneos existentes del modo Animate as is.

La cobertura nueva incluye aislamiento por propietario, referencias inmutables, versiones, fallos y reinicios, presupuestos e idempotencia, medios privados, copia independiente a Flipbook, las seis cámaras, guías con ángulo compatible, reparación y exclusión de la medición lateral de zancada para las vistas frontal y trasera.

## Evidencias y límites

Carpeta local: `/Users/manudev/.codex/visualizations/2026/10/27/01a17efd-ae1d-7833-8df2-db14c3bdd80e/characters-review/`.

- `elf-chan-studio.png`: estudio con versión frontal, historial y referencia original.
- `elf-chan-mobile.png`: mismo personaje a 390 px.
- `desktop-comparison.png`: comparación de diseños.
- `elf-chan-front-frames.png`: ocho poses frontales después de la corrección.
- `elf-chan-front.mp4` y `elf-chan-front.gif`: exportaciones reproducibles.

La prueba visual real cubre la cámara frontal y el recorrido anterior de perfil. Las otras vistas tienen pruebas automáticas de contratos y propagación, pero no se generó una animación real para cada una. La cámara queda fija durante el ciclo: no hay rig 3D ni órbita continua. La imagen original es un retrato, por lo que ropa no visible, pies y ángulos nuevos se infieren.

El resultado aún presenta pequeñas variaciones de manos, pliegues y contornos, y restos de color del fondo de recorte alrededor de algunos dedos. Los controles automáticos no detectaron el cambio de brazo: hace falta revisión visual. Se entrega una demostración funcional de ocho dibujos, sin prometer la fluidez ni el acabado de una animación dibujada manualmente.

Persistencia y trabajos siguen la arquitectura existente de un contenedor con volumen. El host de la hackathon, su volumen, la cuenta real y el flag requieren una prueba de despliegue antes de presentar. No se añadieron colecciones, entrenamiento, pincel ni movimientos nuevos; la ropa se organiza mediante versiones con nombre.
