# Deploy de Focus en Railway

## Decisión

Railway permite conservar la arquitectura actual: un contenedor con Next.js, FFmpeg/FFprobe, Sharp, trabajos de IA en segundo plano y archivos en un volumen. No hace falta agregar una base de datos ni separar el frontend para este primer despliegue.

| Plataforma | Encaje con esta versión |
| --- | --- |
| **Railway — recomendada** | Docker, proceso continuo, volumen persistente y dominio HTTPS. Configuración preparada en este repositorio. |
| Render | Alternativa válida con un servicio Docker de pago y disco persistente. El disco también obliga a usar una instancia. |
| Vercel | Requiere separar almacenamiento y procesamiento: los uploads de Focus admiten 150 MB y Vercel Functions limita el cuerpo de una petición a 4,5 MB. Los trabajos en memoria y archivos locales tampoco se comparten entre funciones. Puede alojar el frontend si se cambia la arquitectura. |

Fuentes oficiales consultadas el 27 de octubre de 2026: [Vercel Functions](https://vercel.com/docs/functions/limitations), [volúmenes Railway](https://docs.railway.com/volumes), [discos Render](https://render.com/docs/disks).

## Configuración preparada

`railway.json` define:

- Build con el `Dockerfile` existente; Next.js standalone + FFmpeg/FFprobe.
- Una instancia, sin suspensión por inactividad. Los trabajos y bloqueos viven en un solo proceso.
- Volumen obligatorio en `/data`. El archivo exige el montaje; el volumen se crea en Railway.
- Salud en `/api/health`, con 120 segundos para iniciar.
- Reinicio ante fallo, hasta cinco intentos; sin solapamiento entre versiones.
- Límites máximos de 2 vCPU y 2 GiB de RAM. Son límites de consumo, no reservas ni un límite monetario.

`deploy/railway.env.example` contiene las variables para el servicio, sin secretos. Habilita Flipbook y mantiene Time Freeze deshabilitado. Los dos flags y los límites de upload se compilan: definirlos **antes** del primer deploy y reconstruir para cambiarlos. Railway transmite al Docker build las variables declaradas como `ARG`; el Dockerfile no declara argumentos para secretos.

Railway monta el volumen como root. `RAILWAY_RUN_UID=0` permite que `deploy/docker-entrypoint.sh` cambie el dueño de `/data`; después ejecuta Next.js como `node` (UID 1000). El servidor y FFmpeg no permanecen como root. En Docker normal, la imagen sigue usando `USER node`.

El healthcheck de Docker usa `PORT`, incluido cuando Railway lo asigna dinámicamente. No sobrescribir el Start Command: usar el `ENTRYPOINT` y `CMD` de la imagen.

## Configurar la cuenta y el servicio

1. Conectar la integración de Railway o iniciar sesión con `pnpm dlx @railway/cli login`.
2. Crear un proyecto `focus` y un servicio vacío `focus` en el workspace elegido. Para un proyecto nuevo por CLI:

   ```sh
   pnpm dlx @railway/cli init --name focus
   pnpm dlx @railway/cli add --service focus
   ```

   Si ya existe el proyecto, usar `pnpm dlx @railway/cli link` y seleccionar el proyecto y servicio correspondientes.

3. Adjuntar un volumen persistente al servicio, con montaje `/data`; configurar inicialmente **5 GB**. El volumen y su tamaño se configuran en Railway, no dentro de `railway.json`.

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

7. En la app de Meta, registrar `https://<dominio-del-servicio>/api/auth/facebook/callback` como **Valid OAuth Redirect URI**. Esta configuración de Facebook no se crea automáticamente al publicar en Railway.

8. Comprobar `/api/health`, `/editor` y `/flipbook`. La salud debe indicar `storageWritable: true`, `metaConfigured: true` y `aiEnabled: true`. Una respuesta 200 por sí sola no certifica que las claves o Facebook estén configurados: `/api/health` comprueba principalmente FFmpeg y almacenamiento.

No crear réplicas, regiones adicionales ni habilitar suspensión. Un deploy/reinicio interrumpe el trabajo que esté corriendo; los archivos completados se conservan. Publicar entre generaciones para reducir interrupciones.

## Costos

[Railway Hobby](https://railway.com/pricing) tiene un mínimo mensual de **US$5**, que incluye US$5 de uso. El consumo adicional y la salida de datos se cobran aparte. Como referencia oficial, RAM cuesta aproximadamente US$10/GB-mes, CPU US$20/vCPU-mes y el volumen US$0,15/GB-mes; se factura el uso real. Los límites de 2 vCPU/2 GiB no significan que el total sea US$5 ni constituyen un tope de gasto.

El plan gratuito, con 0,5 GB de RAM después del trial y 0,5 GB de volumen, no alcanza los recursos y almacenamiento elegidos. Configurar alertas y, si se desea, un límite de gasto en la cuenta antes de habilitar tráfico. El costo de Meta es independiente de Railway; los límites `FOCUS_*` controlan solicitudes/trabajos, no garantizan un importe mensual.

## Prueba de producción local, sin créditos de IA

```sh
docker build \
  --build-arg NEXT_PUBLIC_ENABLE_FLIPBOOK=true \
  --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false \
  --build-arg FOCUS_MAX_VIDEO_DURATION_SECONDS=60 \
  --build-arg FOCUS_MAX_UPLOAD_MB=150 \
  -t focus:railway .
pnpm test:deployment
```

La prueba usa un volumen nuevo y aislado, reproduce los permisos de Railway, inicia en `PORT=8080`, comprueba que PID 1 sea `node`, prueba salud/sesiones/Flipbook, valida un upload real con FFmpeg y comprueba que los medios sobrevivan al reinicio. Deshabilita la IA y deja vacías las claves de proveedor. Elimina únicamente sus propios contenedores/volúmenes y escribe `.focus-data/deployment/report.json`.

## Estado

Configuración preparada en el repositorio. Verificado localmente el 27 de octubre de 2026:

- `railway.json` válido contra el esquema oficial vigente.
- Imagen Docker `focus:railway` compilada con Flipbook habilitado.
- `pnpm test:deployment`: **8 comprobaciones aprobadas**, incluidas escritura en el volumen de Railway, ejecución sin privilegios, puerto dinámico, FFmpeg y persistencia de imagen/video después de reiniciar.
- ESLint, sintaxis del entrypoint/script y `git diff --check` sin errores.

Esta prueba corrió en Docker Linux/arm64 local; el build y la verificación en la infraestructura de Railway siguen pendientes.

La cuenta de Railway ya está conectada y existe el proyecto privado [focus](https://railway.com/project/f7e84859-2207-487c-b6f1-9dfc6a6d1e26) en el workspace `Manus projects`, con el entorno `production`. El servicio `focus` y sus 21 variables están preparados como cambios pendientes: todavía no hay una instancia ejecutándose. Los secretos se prepararon directamente en las variables de Railway; no forman parte de Git. `FOCUS_AI_DISABLED=1` mantiene la IA en espera durante esta preparación.

El usuario eligió continuar con Hobby. La cuenta todavía tiene un máximo de 500 MB por volumen: hay que activar Hobby antes de crear el volumen previsto de 5 GB. La integración permite administrar el proyecto, pero no cambiar el plan o completar el pago. Los límites de CPU/RAM y demás ajustes del servicio se aplicarán desde `railway.json` al desplegar el código.

La copia de despliegue está en `codex/railway-deploy`. Incluye los archivos locales de Flipbook que no estaban en `main`, sin secretos ni medios locales. El checkout de desarrollo permanece en su rama y conserva sus cambios. No hay una URL de producción verificada todavía.

Referencias adicionales: [configuración como código](https://docs.railway.com/config-as-code/reference), [esquema vigente](https://railway.com/railway.schema.json), [Docker y build args](https://docs.railway.com/builds/dockerfiles), [red y timeouts](https://docs.railway.com/networking/public-networking/specs-and-limits).
