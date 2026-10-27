# Facebook Login de Focus

## App y credenciales

Se utiliza la app Consumidor existente **focus**, ID **1106108992117051**. No se creó otra app ni se cambiaron sus propietarios o roles.

- [Ajustes básicos](https://developers.facebook.com/apps/1106108992117051/settings/basic/)
- [Facebook Login / OAuth](https://developers.facebook.com/apps/1106108992117051/fb-login/settings/)
- [Permisos y funciones](https://developers.facebook.com/apps/1106108992117051/app-review/permissions/)

`FACEBOOK_APP_ID` y `FACEBOOK_APP_SECRET` están preparados como variables **pendientes** del servicio `focus` en Railway, entorno `production`. La clave existente se transfirió sin incluirla en Git o en esta documentación. `FACEBOOK_GRAPH_VERSION=v26.0` coincide con la versión que la app muestra para todas sus llamadas y para sus roles. Mantener `FOCUS_AUTH_SIMULATED=0` y conservar el secreto de sesión preparado.

El servidor utiliza OAuth por código de autorización y solicita únicamente `public_profile,email`. El diálogo de acceso informa también del correo opcional. La contraseña de Facebook no pasa por Focus.

En Meta se guardaron el contacto **elustondo129@gmail.com**, la categoría **Utilidad y productividad** y el icono de gato que ya utiliza Focus. Se comprobó su persistencia al volver a los ajustes; el correo se verificó visualmente porque el navegador lo oculta en las lecturas de campos.

## URLs que registrar después del deploy

Cuando Railway asigne el dominio HTTPS real, usar ese mismo origen en `FOCUS_PUBLIC_URL` y en estos campos de Meta:

| Campo | Valor |
| --- | --- |
| Dominios de la app | Solo el hostname, sin protocolo ni ruta |
| Plataforma / Sitio web | `https://<dominio>/` |
| URL de la política de privacidad | `https://<dominio>/privacy` |
| Eliminación de datos / URL de instrucciones | `https://<dominio>/data-deletion` |
| URI de redireccionamiento de OAuth válido | `https://<dominio>/api/auth/facebook/callback` |

No guardar estos ejemplos como si fueran URLs reales ni usar comodines. Verificar primero que las páginas públicas respondan 200 sin iniciar sesión. La opción de eliminación es una **URL de instrucciones**, no un callback automático: esta versión atiende las solicitudes manualmente mediante **elustondo129@gmail.com**, correo público elegido por el responsable del servicio.

Las páginas `/privacy` y `/data-deletion` describen el tratamiento actual de los datos y ese canal manual. No implementan un borrado automático de cuenta. Quitar la app de Facebook tampoco borra por sí solo los archivos de Focus. El responsable debe atender las solicitudes verificadas de eliminación y retirar los registros de cuenta, el índice del proveedor y los proyectos/medios asociados según corresponda.

## Ajustes OAuth comprobados

El 27 de octubre de 2026, Meta mostraba:

- Inicio de sesión del cliente de OAuth y OAuth web: activados.
- HTTPS y coincidencia estricta del redirect: activados y bloqueados por Meta.
- Navegador integrado, dispositivos, SDK de JavaScript y Messenger: desactivados.
- Lista de redirects: vacía, pendiente del dominio de Railway.

Estos valores sirven para el flujo del servidor existente; no hace falta habilitar el SDK de JavaScript ni agregar permisos de fotos, videos, publicaciones o amigos.

## Publicación y prueba

La app permanece en **Desarrollo**. Meta indica **acceso estándar** y **Verificación obligatoria** para `public_profile` y `email`; el panel de Login exige acceso avanzado a `public_profile` para uso público. Completar lo que pida el flujo de verificación de Meta antes de anunciar el acceso a usuarios sin rol en la app. No se solicitó acceso avanzado ni se publicó la app durante esta preparación.

Después del deploy y de guardar el redirect exacto:

1. Probar con una cuenta administradora o de prueba de esta app. Comprobar la ida a Facebook, el retorno a Focus y que `/api/auth/session` identifique la sesión.
2. Comprobar cancelar el consentimiento y cerrar sesión. El correo puede no estar disponible: Focus lo admite como opcional.
3. Completar los requisitos de Meta y verificar de nuevo con un usuario sin rol antes de considerar habilitado el acceso público.

El perfil de Railway para la demo usa el trial con 500 MB de volumen y 1 GiB de RAM. Registrar las URLs después de desplegar y obtener el dominio HTTPS. Tener credenciales configuradas no significa que la ida y vuelta real por Facebook esté verificada.

## Comprobaciones locales

- Imagen de producción `focus:facebook-release`: build y TypeScript aprobados.
- ESLint de las páginas nuevas y el diálogo de acceso aprobado.
- `/privacy` y `/data-deletion`: HTML público con respuesta 200, correo y enlaces de contacto presentes, sin redirección a login.
- Lectura y navegación verificadas en navegador; a 390 px no hay desbordamiento horizontal y el contenido declara idioma español.
- Sin credenciales en el contenedor de prueba, el inicio de sesión de producción devuelve 503 y no habilita la simulación.

Estas pruebas no utilizaron claves de proveedor ni consumieron créditos de Meta. La ida y vuelta real por Facebook sigue pendiente del dominio y el redirect definitivos.
