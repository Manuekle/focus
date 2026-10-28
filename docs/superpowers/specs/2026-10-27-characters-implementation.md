# My characters — implementación aprobada

Alcance aprobado: `docs/MY_CHARACTERS_HACKATHON.md`. Referencia de todas las pruebas y de la demostración: `public/characters/elf-chan.png`.

## Referencia fija

Conservar el original como ancla de identidad en cada generación de Elf-chan. Su cabello rubio trenzado, ojos verdes, orejas puntiagudas y estilo ilustrado deben mantenerse. El retrato no muestra el cuerpo completo; la primera generación completa las partes ausentes con ropa sencilla. Cada cambio conserva el diseño previo.

## Secuencia de implementación

- [x] Biblioteca y versiones con esquema validado, archivos permanentes y propietario.
- [x] Trabajos acotados de generación y edición con presupuesto, idempotencia y recuperación tras reinicio.
- [x] API de personajes, referencias, versiones y medios privados.
- [x] Estudio visual con referencia fija, edición, comparación, nombres y descarga.
- [x] Traspaso a Flipbook con copia independiente y procedencia; selección desde Flipbook.
- [x] Pruebas de aislamiento, persistencia, versiones, fallos y duplicados; regresiones de Flipbook.
- [x] Prueba real usando Elf-chan y revisión en navegador de escritorio y móvil.
- [x] Corrección solicitada durante el trabajo: cámaras frontal, tres cuartos, perfil, espalda, desde arriba y desde abajo; conservar la vista original por defecto. Prueba real frontal con Elf-chan.

## Decisiones

Una imagen por acción. Referencia principal inmutable y dos apoyos opcionales. Historial plano con nombres; la selección determina el siguiente cambio. Consultar o comparar versiones no llama a IA. La generación actual nunca reemplaza una versión válida hasta que el archivo nuevo se guarda correctamente. El motor de imágenes existente se reutiliza y sus herramientas de búsqueda y shell permanecen deshabilitadas.

La sección vive en `/characters`, con el shell y la cuenta de Focus. El inicio ofrece Elf-chan como referencia de ejemplo. Otras imágenes siguen siendo una entrada válida para el producto; todos los ensayos de este trabajo usan Elf-chan. Las imágenes privadas se verifican por propietario en cada ruta. Los derivados de personajes dentro de Flipbook conservan el control de acceso y una copia de la identidad original.

Verificación: TypeScript, ESLint, pruebas específicas y regresiones del flujo existente. La prueba real comprueba identidad visual y edición; los servicios simulados sólo comprueban la lógica. No se incorporan colecciones, pincel, rigging ni nuevos movimientos.
