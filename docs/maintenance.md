# Mantenimiento

## Añadir una pieza

1. Comprueba si una primitiva o patrón ya resuelve el caso.
2. Ponla en components/ui, components/motion o components/patterns según su responsabilidad.
3. Usa tokens existentes y imports relativos dentro de la biblioteca.
4. Define estado controlado/default, callbacks y comportamiento de error cuando proceda.
5. Documenta la API, agrega ejemplos y los estados relevantes al registro del catálogo.
6. Revisa teclado, foco, nombres, claro/oscuro, móvil y movimiento reducido.
7. Ejecuta pnpm check y pnpm build.

No copies tipos o helpers del servidor para reutilizar un tipo de UI. Conserva vocabularios pequeños y límites claros. Las piezas que necesitan un servicio reciben datos o callbacks por props.

## Cambiar la identidad

Edita styles/focus-theme.css; actualiza los valores de ambas apariencias y las superficies específicas de los controles. Ejecuta pnpm tokens y comprueba el JSON generado. La identidad y las reglas deben coincidir con docs/identity.md y con los ejemplos de fundamentos.

## Procedencia

provenance.json registra la revisión de Oruka y el destino de las piezas extraídas. Los imports se hicieron relativos y los patrones se movieron desde app/_components a components/patterns. El proveedor de idioma es independiente del router y usa solo vocabulario de UI. ApiErrorCode se conserva como tipo, sin helpers de servidor. Focus aplica su identidad sobre las recetas originales.

Una modificación de Focus no cambia Oruka. Para incorporar cambios futuros, compara solo los módulos deseados con la revisión registrada y revisa también sus dependencias. No vuelvas a copiar la aplicación entera.

## Niveles de madurez

Los controles habituales y los patrones documentados son la base de composición. Goo, lighting y recursos de mascota son expresivos y optativos. AnimatedQR y las piezas de dominio conservan contratos particulares que están descritos en integration.md. No conviertas un experimento visual en dependencia de un flujo esencial sin revisar foco, presencia y coste.

## Comprobaciones

pnpm typecheck valida TypeScript; pnpm lint revisa el código; pnpm verify valida imports relativos, dependencias declaradas, exports y tokens; pnpm build compila el catálogo. Las comprobaciones automáticas no cubren todas las combinaciones de interacción: recorre los ejemplos que hayas cambiado.
