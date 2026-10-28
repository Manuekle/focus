# Deploy de Focus en Railway

## Decisión

Railway permite conservar la arquitectura actual: un contenedor con Next.js, FFmpeg/FFprobe, Sharp, trabajos de IA en segundo plano y archivos en un volumen. No hace falta agregar una base de datos ni separar el frontend para este primer despliegue.

| Plataforma | Encaje con esta versión |
| --- | --- |
| **Railway — recomendada** | Docker, proceso continuo, volumen persistente y dominio HTTPS. Configuración preparada en este repositorio. |
| Render | Alternativa válida con un servicio Docker de pago y disco persistente. El disco también obliga a usar una instancia. |
| Vercel | Requiere separar almacenamiento y procesamiento: los uploads de Focus admiten 150 MB y Vercel Functions limita el cuerpo de una petición a 4,5 MB. Los trabajos en memoria y archivos locales tampoco se comparten entre funciones. Puede alojar el frontend si se cambia la arquitectura. |

Fuentes oficiales consultadas el 27 de octubre de 2026: [Vercel Functions](https://vercel.com/docs/functions/limitations), [volúmenes Railway](https://docs.railway.com/volumes), [discos Render](https://render.com/docs/disks).

## Configuración de demo en el trial

El perfil elegido es una demo para pruebas: **500 MB en `/data`, 1 vCPU, hasta 1 GiB de RAM y un trabajo activo a la vez**. Los videos admiten **15 segundos y 10 MB**; las imágenes, **5 MB**. Los 5 GB de Hobby son una opción posterior con mayor margen, no un mínimo demostrado para Flipbook.

La demo configura `FOCUS_MAX_DATA_MB=350` y `FOCUS_MIN_FREE_MB=100`. Se comprueba el volumen antes de aceptar uploads y trabajo de IA, y antes de escribir imágenes, fotogramas y archivos de exportación. Las escrituras binarias se serializan y los encoders se interrumpen si alcanzan el umbral. El margen protege los archivos temporales entre comprobaciones; es un control de la aplicación, no una cuota del sistema de archivos. Al alcanzarlo, la API responde `storage_full` (507) y mantiene los archivos existentes. No se borran automáticamente personajes ni proyectos guardados. La limpieza normal de temporales expirados sigue vigente. `/api/health` muestra uso, límite y espacio disponible para nuevos medios.

`FOCUS_PUBLIC_URL=https://focusmeta.up.railway.app` define también el origen permitido para modificar personajes. La comparación usa la URL pública HTTPS aunque Next reciba una URL HTTP interna. Esto no requiere habilitar `FOCUS_TRUST_PROXY` ni confiar en cabeceras de IP arbitrarias.

`railway.json` define:

- Build con el `Dockerfile` existente; Next.js standalone + FFmpeg/FFprobe.
- Una instancia, sin suspensión por inactividad. Los trabajos y bloqueos viven en un solo proceso.
- Volumen obligatorio en `/data`. El archivo exige el montaje; el volumen se crea en Railway.
- Salud en `/api/health`, con 120 segundos para iniciar.
- Reinicio ante fallo, hasta cinco intentos; sin solapamiento entre versiones.
- Límites máximos de 1 vCPU y 1 GiB de RAM. Son límites de consumo, no reservas ni un límite monetario.

`deploy/railway.env.example` contiene las variables para el servicio, sin secretos. Habilita Flipbook y mantiene Time Freeze deshabilitado. Los dos flags y los límites de upload se compilan: definirlos **antes** del primer deploy y reconstruir para cambiarlos. Railway transmite al Docker build las variables declaradas como `ARG`; el Dockerfile no declara argumentos para secretos.

Railway monta el volumen como root. `RAILWAY_RUN_UID=0` permite que `deploy/docker-entrypoint.sh` cambie el dueño de `/data`; después ejecuta Next.js como `node` (UID 1000). El servidor y FFmpeg no permanecen como root. En Docker normal, la imagen sigue usando `USER node`.

El healthcheck de Docker usa `PORT`, incluido cuando Railway lo asigna dinámicamente. No sobrescribir el Start Command: usar el `ENTRYPOINT` y `CMD` de la imagen.

`FOCUS_PROVIDER_CONNECTIVITY_CHECK=1` consulta al arrancar, como usuario `node`, el catálogo de Meta Model API con la clave configurada y Graph API sin credenciales. Registra el estado HTTP, los modelos disponibles, un identificador hash de la clave y los errores de acceso; nunca registra la clave, envía prompts ni ejecuta modelos. El catálogo debe responder 200 con una clave válida; Graph puede responder 400 por no llevar un token. La prueba no bloquea el arranque si la red está restringida. Puede desactivarse después de verificarla.

## Configurar la cuenta y el servicio

1. Conectar la integración de Railway o iniciar sesión con `pnpm dlx @railway/cli login`.
2. Crear un proyecto `focus` y un servicio vacío `focus` en el workspace elegido. Para un proyecto nuevo por CLI:

   ```sh
   pnpm dlx @railway/cli init --name focus
   pnpm dlx @railway/cli add --service focus
   ```

   Si ya existe el proyecto, usar `pnpm dlx @railway/cli link` y seleccionar el proyecto y servicio correspondientes.

3. Adjuntar un volumen persistente al servicio, con montaje `/data`; configurar **500 MB** para esta demo. El volumen y su tamaño se configuran en Railway, no dentro de `railway.json`.

   ```sh
   pnpm dlx @railway/cli volume add --service focus --mount-path /data
   ```

   Revisar el tamaño en los ajustes del volumen. Las copias de seguridad se habilitan aparte en esos ajustes.

4. En **Variables / Raw Editor**, pegar `deploy/railway.env.example` y completar:

   - `MODEL_API_KEY`: una clave de producción de Meta Model API.
   - `FOCUS_SESSION_SECRET`: valor aleatorio de 32+ caracteres. Se puede generar con `openssl rand -base64 48`; guardarlo únicamente como secreto.
   - `FOCUS_ADMIN_TOKEN`: otro secreto aleatorio para consultar `/api/usage`.
   - `FACEBOOK_APP_ID` y `FACEBOOK_APP_SECRET`: necesarios para iniciar sesión después de las tres ediciones gratuitas. Mantener `FOCUS_AUTH_SIMULATED=0`.

   No pegar secretos en Git, archivos de configuración versionados, argumentos del build ni capturas. No hace falta usar las claves locales de desarrollo.

5. Hacer el primer deploy desde el checkout actual:

   ```sh
   pnpm dlx @railway/cli up --service focus --detach
   ```

   `.railwayignore` excluye secretos, cachés y medios locales. Este método incluye los archivos nuevos de Flipbook que todavía no están en Git. Antes de activar autodeploy desde GitHub, esos cambios deben estar revisados y publicados en la rama seleccionada.

6. Generar un dominio público HTTPS del servicio:

   ```sh
   pnpm dlx @railway/cli domain --service focus
   ```

   Verificar que `FOCUS_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` se resuelva al dominio asignado. Con un dominio propio, sustituirlo por ese origen HTTPS y actualizar Facebook.

7. En la app de Meta, registrar `https://<dominio-del-servicio>/api/auth/facebook/callback` como **Valid OAuth Redirect URI**. Registrar también las páginas `/privacy` y `/data-deletion`. Ver los campos y el estado de acceso en [Facebook Login](FACEBOOK_LOGIN.md). Esta configuración de Facebook no se crea automáticamente al publicar en Railway.

8. Comprobar `/api/health`, `/editor` y `/flipbook`. La salud debe indicar `storageWritable: true`, `metaConfigured: true` y `aiEnabled: true`. Una respuesta 200 por sí sola no certifica que las claves o Facebook estén configurados: `/api/health` comprueba principalmente FFmpeg y almacenamiento.

No crear réplicas, regiones adicionales ni habilitar suspensión. Un deploy/reinicio interrumpe el trabajo que esté corriendo; los archivos completados se conservan. Publicar entre generaciones para reducir interrupciones.

## Costos

El trial consume su crédito disponible hasta agotarlo o vencer el plazo mostrado en la cuenta. Admite un volumen de 500 MB y hasta 1 GB de RAM. **Limited Trial restringe conexiones salientes**: comprobar desde el servicio el acceso HTTPS a Meta Model API y Graph API; conectar/verificar GitHub puede habilitar Full Trial. El perfil no activa una suscripción Hobby.

[Railway Hobby](https://railway.com/pricing) queda como alternativa posterior: mínimo de **US$5/mes**, con US$5 de uso incluidos y consumo adicional aparte. El plan Free posterior al trial reduce la RAM disponible a 0,5 GB y tiene crédito mensual menor: no equivale al trial que se está probando. El costo de Meta es independiente de Railway; los límites `FOCUS_*` controlan solicitudes/trabajos, no garantizan un importe mensual.

Fuentes: [trial y restricciones de red](https://docs.railway.com/pricing/free-trial), [recursos por plan](https://docs.railway.com/pricing/plans).

## Prueba de producción local, sin créditos de IA

```sh
docker build \
  --build-arg NEXT_PUBLIC_ENABLE_FLIPBOOK=true \
  --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false \
  --build-arg FOCUS_MAX_VIDEO_DURATION_SECONDS=15 \
  --build-arg FOCUS_MAX_UPLOAD_MB=10 \
  --build-arg FOCUS_MAX_IMAGE_UPLOAD_MB=5 \
  -t focus:railway .
pnpm test:deployment
```

La prueba usa un volumen nuevo y aislado, limita el contenedor a **1 CPU / 1 GiB**, reproduce los permisos de Railway, inicia en `PORT=8080`, comprueba que PID 1 sea `node`, prueba salud/sesiones/Flipbook, valida un upload real con FFmpeg y comprueba que los medios sobrevivan al reinicio. Registra el pico de memoria cuando cgroup lo permite. Deshabilita la IA y deja vacías las claves de proveedor. Elimina únicamente sus propios contenedores/volúmenes y escribe `.focus-data/deployment/report.json`. El volumen local no impone una cuota de disco; los 500 MB se configuran en Railway.

## Estado

Configuración preparada en el repositorio. Verificado localmente el 27 de octubre de 2026:

- `railway.json` válido contra el esquema oficial vigente.
- Imagen Docker `focus:railway` compilada con Flipbook habilitado.
- `pnpm test:deployment`: **8 comprobaciones aprobadas**, incluidas escritura en el volumen de Railway, ejecución sin privilegios, puerto dinámico, FFmpeg y persistencia de imagen/video después de reiniciar.
- ESLint, sintaxis del entrypoint/script y `git diff --check` sin errores.

El perfil de demo también pasó las ocho comprobaciones con **1 CPU / 1 GiB**. El pico observado durante esas pruebas básicas de uploads/normalización fue de **265.936.896 bytes (unos 254 MiB)**; no es una medición de todas las generaciones de IA ni una prueba de carga. El diagnóstico opcional también se probó sin red: registra el fallo y permite ejecutar la aplicación como UID 1000.

La prueba de contenedor corrió en Docker Linux/arm64 local. El servicio también tiene un despliegue activo en Railway; `/api/health` verifica FFmpeg, FFprobe y escritura en el volumen.

La cuenta de Railway está conectada y existe el proyecto privado [focus](https://railway.com/project/f7e84859-2207-487c-b6f1-9dfc6a6d1e26) en el workspace `Manus projects`, con el entorno `production`. Se prepararon el servicio, el volumen de 500 MB y 25 variables, incluidas las dos credenciales y la versión de Graph API de Facebook Login. Los secretos se guardan en Railway y no forman parte de Git. La salud del servicio confirma `metaConfigured: true` y `aiEnabled: true`; esto comprueba la configuración, pero no sustituye una generación real ni la validación de Facebook Login.

El usuario eligió probar primero la demo en el trial. El volumen solicitado coincide con el límite de 500 MB de la cuenta. Los límites de CPU/RAM y demás ajustes del servicio se aplican desde `railway.json` al desplegar el código. Consultar el panel de Railway para el estado y el dominio vigentes.

La rama de publicación es `main`, que integra el trabajo de `codex/railway-deploy` y `feat/animate-as-is`, incluido el estudio de personajes y las nuevas herramientas de animación. El servicio debe seguir `Manuekle/focus@main` sin fijar un `commitSha`, para desplegar los próximos pushes a esa rama. Se conservan las páginas de privacidad, la configuración del trial y el volumen existente. El dominio activo es [focusmeta.up.railway.app](https://focusmeta.up.railway.app); usarlo también en `FOCUS_PUBLIC_URL` y las URLs de Facebook.

Referencias adicionales: [configuración como código](https://docs.railway.com/config-as-code/reference), [esquema vigente](https://railway.com/railway.schema.json), [Docker y build args](https://docs.railway.com/builds/dockerfiles), [red y timeouts](https://docs.railway.com/networking/public-networking/specs-and-limits).
