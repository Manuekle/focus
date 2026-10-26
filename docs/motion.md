# Movimiento

Focus conserva la mecánica de movimiento de los componentes extraídos de Oruka. La identidad y la densidad cambian mediante tokens y estilos; la presencia, el foco y los contratos de estado se mantienen.

## Principios

Cada animación comunica una relación o un cambio de estado. CSS para estados binarios; Motion para presencia, gestos y física. Prioriza transform y opacity. Si un vecino debe ceder espacio, una transición de geometría puede tener sentido. No añadas animaciones a acciones frecuentes si el resultado ya es claro.

El usuario puede interrumpir una interacción. Una superficie controlada pide el cierre al padre y solo sale cuando el padre lo acepta. Se libera la interacción al iniciar la salida y el dibujo se conserva hasta terminarla. El foco vuelve al origen.

## Escala existente

| Función | Entrada | Salida | Receta |
| --- | --- | --- | --- |
| Modal | 250 ms | 150 ms | `.t-modal`, `.t-scrim` |
| Panel lateral | 400 ms | 350 ms | `.t-panel-slide` |
| Morph | 350 ms | 250 ms | `.t-morph` |
| Tooltip | 150 ms | 90 ms | `.t-tooltip` |
| Selección de pestaña | 250 ms | Reversible | `.t-tabs-pill` |

Las curvas viven en `styles/tailwind-theme.css`: smooth-out para superficies y expo-out para revelados. Los springs viven en [lib/ease.ts](../lib/ease.ts): PRESS para presión, SWAP para intercambio, PANEL para superficies, LAYOUT para indicadores, GLIDE para arrastre y MOUSE para recursos decorativos opcionales.

## Herramientas

- [MotionProvider](../components/motion/provider.tsx) aplica `reducedMotion="user"` como base de montaje.
- [useReducedMotion](../lib/hooks/use-reduced-motion.ts) responde a cambios de preferencia durante la sesión.
- [useAnimationActive](../lib/hooks/use-animation-active.ts) combina visibilidad y preferencia para recursos ambientales.
- [PresenceGate](../lib/presence-gate.tsx) aísla interacción durante las salidas que lo requieren.
- [styles/recipes.css](../styles/recipes.css) contiene las recetas globales con sus variantes reducidas.

No sustituyas el hook reactivo de Focus por una lectura única. El servidor no conoce la preferencia; la primera pasada mantiene la hidratación estable y el provider reduce el movimiento al montar.

## Variantes reducidas

Quita desplazamiento, escala, blur y rotación. Conserva el estado final y, cuando comunique el cambio, un fundido breve. La reducción de movimiento nunca elimina el nombre, el estado ni la acción que comunica la interfaz.

## Verificación

Abre, cierra y reabre rápidamente. Cambia prefers-reduced-motion con la superficie abierta. Prueba Escape, retorno de foco y aislamiento del fondo. Revisa el desplazamiento fuera de pantalla y el coste de loops de ilustración. Las animaciones expresivas de lighting, goo y mascota son optativas y no deben interferir con flujos de trabajo.
