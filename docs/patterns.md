# Patrones de interfaz

## Formulario

Usa `Field` para agrupar etiqueta, control, ayuda y error. El control recibe `id`, `aria-describedby`, `aria-invalid`, `required` y `disabled` mediante render prop. No sustituyas la etiqueta por un placeholder. Usa `type=email` y autocomplete cuando corresponda.

Valida al enviar y después de un intento fallido corrige el error al editar. Mantén el contenido en el formulario si la petición falla. Para un resultado correcto, actualiza el estado real y muestra un toast cuando la confirmación no resulte obvia. El ejemplo del catálogo solo valida en memoria.

## Datos y tablas

`DataTable<T>` recibe columnas, filas y claves estables. `value` alimenta búsqueda y orden; `render` personaliza la celda. Define un caption que identifique la colección. La cabecera ordenable escribe aria-sort y se acciona como un botón.

Incluye estados con datos, cargando, sin elementos, sin resultados y error con reintento. Conserva búsqueda y página donde ayude a continuar el trabajo. Evita fijar anchos que provoquen scroll horizontal de toda la página. En móvil, la tabla se desplaza dentro de su contenedor.

## Decisión y edición

Dialog para una decisión o formulario breve. AlertDialog para confirmar una acción irreversible: nombra el objeto y la consecuencia, y ofrece una salida clara. Drawer para inspeccionar o editar mientras la lista sigue dando contexto. Popover para una acción pequeña anclada al control; Tooltip para una explicación breve, nunca como único acceso a una función.

Las superficies controladas piden el cierre al padre. Si el padre lo rechaza, deben permanecer abiertas. El foco vuelve al origen y la página del fondo queda aislada durante una superficie modal.

## Vacío, carga y error

EmptyState explica qué aparecerá y ofrece un siguiente paso. ProductFigure es decorativo; el texto vive fuera. Skeleton conserva el tamaño aproximado del contenido. Spinner representa una espera breve en un control. ErrorBanner ofrece contexto recuperable; Alert informa un estado en sitio. Los errores importantes permanecen visibles hasta resolverse o descartarse.

## Tarjetas, métricas y gráficos

Card agrupa contenido de una pantalla. FramedCard añade un marco concéntrico y un pie para acciones o estado. Mantén los títulos y las unidades junto a sus valores. Un delta necesita contexto de comparación. Los gráficos admiten texto y etiquetas; ofrece la misma información importante en palabras o datos accesibles.

No hagas toda una tarjeta clicable si ya contiene botones o enlaces en conflicto. Para datos que cambian, usa cifras tabulares y respeta movimiento reducido.

## Conversación e IA

Composer agrupa la entrada y SendButton. Deshabilita el envío cuando el texto está vacío y señala busy durante la petición. La aplicación controla envío y cancelación. ThinkingText/Orb comunican actividad, y Reasoning muestra contenido de apoyo cuando es útil. Las respuestas Markdown son contenido de terceros: cualquier acción, archivo o navegación requiere la política del producto consumidor.

Las sugerencias son acciones concretas que el usuario puede entender. Los errores no deben quedar ocultos en una animación de espera. El resultado de un tool call necesita un estado legible además del movimiento.

## Navegación y selección

SlidingTabs mantiene una única píldora y nombres claros. Para filtros de selección usa ToggleChip; para un ajuste binario, Switch; para múltiples valores, Checkbox; para uno dentro de un grupo, RadioGroup. SelectionRow en semantics=radio es una pieza de presentación/control: el grupo consumidor debe implementar navegación de teclado. El ejemplo aislado usa semantics=toggle para no prometer ese comportamiento.

## Recursos expresivos

Ilustraciones, lighting, goo y mascota se usan cuando aportan orientación o identidad. No pongas un loop ambiental detrás de una tabla o de un flujo repetitivo. Activa recursos pesados al acercarse al viewport y deténlos fuera de vista o con movimiento reducido.
