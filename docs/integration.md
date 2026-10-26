# Integración

## Requisitos

React 19, TypeScript con `moduleResolution: bundler`, soporte TSX/CSS Modules y Tailwind CSS 4. El catálogo usa Next.js 16. Los módulos de `components` y `lib` no importan Next, Eve ni acceso a bases de datos.

Focus es un paquete privado de código fuente, no una distribución de JavaScript precompilado. El consumidor compila los módulos importados. Se usan imports relativos internos para que el alias `@/` de otra aplicación no cambie su resolución.

## Como dependencia local

```sh
pnpm add @focus/ui@file:../focus
```

Con Next:

```ts
// next.config.ts
export default { transpilePackages: ['@focus/ui'] };
```

```css
/* app/globals.css */
@import "@focus/ui/styles";
@source ".";
@source "../components";
@source "../node_modules/@focus/ui/components";
```

Focus incluye la importación de Tailwind, el reset, el tema y las recetas. Evita duplicar una segunda base de Tailwind en ese mismo árbol. `@source` es relativo al CSS que lo declara; adapta las rutas a tu estructura. Si no usas los estilos completos, integra manualmente el orden de `styles/index.css` y documenta qué recetas dejas fuera.

Copia `public/fonts` al directorio público del consumidor. Optimistic Display son las fuentes activas. `public/logos/apps` contiene los assets de iconos de servicios; cópialo si usas `ChannelBadge` o marcas de integraciones. Los componentes de iluminación y las ilustraciones de producto se empaquetan con su código, sin backend.

## Proveedor

```tsx
'use client';
import { FocusProvider } from '@focus/ui/provider';
export function Providers({ children }: { children: React.ReactNode }) {
  return <FocusProvider locale="es" messages={{es:{'badge.active':'En marcha'}}}>
    {children}
  </FocusProvider>;
}
```

Monta el proveedor una vez por aplicación, dentro de `body`. Incluye tema, movimiento, idioma, sonido, tooltip y toast. El sonido empieza silenciado y solo se habilita desde una acción del usuario. No requiere red ni servicios de Oruka.

`locale` establece el idioma inicial. Para cambiarlo durante la sesión, usa `useI18n().setLocale`. `messages` sobreescribe claves concretas. Pasa textos traducidos a los componentes que reciben labels explícitos, como `DatePicker`.

`useTheme().setTheme('dark')` actualiza la clase, color-scheme y la preferencia guardada en `focus-theme`. Para evitar un flash de tema, restaura esa preferencia antes del primer dibujo. El script y el layout de ejemplo están en `app/layout.tsx`. El proveedor sincroniza su estado con esa clase al montarse.

## Imports públicos

```tsx
import { Button } from '@focus/ui/ui/button';
import { Field } from '@focus/ui/ui/field';
import { Input } from '@focus/ui/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@focus/ui/ui/dialog';
import { Drawer, DrawerContent } from '@focus/ui/ui/drawer';
import { Checkbox } from '@focus/ui/motion/checkbox';
import { SlidingTabs } from '@focus/ui/ai/sliding-tabs';
import { DataTable, type DataColumn } from '@focus/ui/patterns/data-table';
import { EmptyState } from '@focus/ui/patterns/empty-state';
import { ProductFigure } from '@focus/ui/hairline/product-figure';
import { HugeiconsIcon } from '@focus/ui/icons';
import { FocusMark } from '@focus/ui/brand';
import { useToast, useTheme, useI18n } from '@focus/ui/provider';
```

No hay un barrel global que cargue todo el catálogo. Usa el subpath de la pieza. Los utilitarios de motor internos, archivos CSS Modules y prototipos sin API de componente no son imports públicos.

## Copiar a otra base de código

Mantén la estructura relativa de las piezas copiadas y todas sus dependencias. La mayoría de los controles necesita `lib/utils.ts`; las superficies y controles animados pueden necesitar `lib/ease.ts`, hooks, CSS Modules y recetas globales. Para un uso extenso resulta más sencillo instalar el paquete local completo.

## Fronteras

- `FileUpload`: recoge archivos y muestra estados. `onFilesAdded` inicia tu subida; actualiza los items con progreso/resultado. Valida contenido, permisos y tamaño en el servidor.
- `DataTable`: búsqueda, orden y paginación en memoria. Para miles de registros, usa consulta y paginación de servidor.
- `AnimatedQR`: el consumidor suministra un endpoint que devuelve SVG y `?json`/`&json` con la matriz de módulos. No se conecta a Oruka.
- `LicenseCreditCard`: solo presentación con datos aportados por props. No activa licencias.
- `ChannelBadge` y `ProspectBadge`: conservan vocabulario del dominio de origen. Puedes usar labels propios o adoptar los componentes más genéricos `Badge`, `CategoryBadge` y `StatusBadge`.

## Actualización

La dependencia `file:` es una copia local administrada por el gestor de paquetes; después de editar Focus, actualiza o reinstala la dependencia del consumidor. Para desarrollo conjunto frecuente, agrega Focus a tu workspace y utiliza `workspace:*`. Un paquete fuente necesita acceso a sus archivos de fuentes y estilos tanto en desarrollo como en build.
