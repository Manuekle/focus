# Accesibilidad

Este documento es una guía de implementación y verificación. El catálogo y las primitivas ayudan a mantener buenas bases; cada pantalla consumidora requiere comprobar su contenido y recorrido real.

## Nombres y estructura

- Jerarquía de encabezados, un main y landmarks con nombres distintos cuando se repiten.
- Botones y enlaces describen su acción. Las acciones solo con icono tienen aria-label.
- Los iconos decorativos están ocultos al árbol accesible. Un icono informativo debe acompañarse de texto o tener un nombre explícito.
- Formulario con label visible, ayuda y error conectados. Field mantiene esa relación.
- No dependas únicamente de color, posición, sonido o animación para comunicar estado.

## Teclado y foco

Prueba Tab, Shift+Tab, Enter, Espacio y Escape. El foco debe ser visible y seguir el orden de lectura. Las superficies modales atrapan el foco, aíslan el fondo y lo devuelven al origen al cerrar. Comprueba abrir/cerrar/reabrir rápidamente y desmontar el trigger.

Radix conserva la base de diálogos, menús, select y tooltips. No reconstruyas sus roles con divs. Una composición puede romper el comportamiento de una primitiva: evita triggers anidados, varios controles en un botón y elementos enfocables dentro de un contenedor inerte.

## Contraste

Las tintas principales, de apoyo y sobre acciones de Focus tienen pares definidos para claro y oscuro. Verifica el texto real sobre su fondo efectivo, incluidos alfas, estados disabled, placeholders y transparencias. Los cambios del tema requieren volver a medir. Un borde de foco necesita distinguirse de las superficies contiguas.

Para texto pequeño usa al menos 4.5:1, texto grande 3:1 y controles/indicadores esenciales 3:1 como referencia WCAG AA. Estas referencias no sustituyen una auditoría de la pantalla completa.

## Movimiento y sonido

Respeta prefers-reduced-motion y los cambios de preferencia durante la sesión. Usa `lib/hooks/use-reduced-motion.ts`, que es reactivo. Conserva un estado final estático cuando quitas desplazamiento, escala o blur. Focus no activa sonido hasta que la persona lo habilita; cualquier resultado sonoro tiene también feedback visual.

## Datos y feedback

DataTable usa tabla semántica, caption y aria-sort. Los estados de carga y resultados tienen anuncios de estado. Los errores que requieren atención usan role=alert y una acción para recuperarse. Los errores de toast no desaparecen automáticamente. No repitas el mismo anuncio en varios live regions.

## Adaptación

Comprueba 320–390 px de ancho, zoom al 200 %, texto ampliado y una pantalla de escritorio. Evita pérdida de contenido o controles tapados. Una tabla puede desplazarse en su contenedor. Asegura separación entre acciones compactas; amplía áreas táctiles donde corresponda.

## Lista antes de integrar

Recorre el flujo con teclado, prueba cada estado, cambia tema y movimiento reducido, verifica nombres accesibles y revisa contraste. Una biblioteca de componentes no puede certificar por sí sola el cumplimiento de una aplicación completa.
