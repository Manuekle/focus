# Reference Motion — operación

Estado al 29 de octubre de 2026. Arquitectura y decisiones: `docs/animation-architecture.md`.

## Qué hay

| Pieza | Dónde |
| --- | --- |
| Contrato compartido (estados, errores, manifest, archivos) | `shared/reference-motion.ts` |
| Store JSON, locks, recuperación tras reinicio, limpieza | `server/reference-motion/store.ts` |
| Subidas (Sharp / FFprobe + normalización a H.264 24 fps) | `server/reference-motion/assets.ts` |
| Job: validar, recortar, despachar, seguir, verificar | `server/reference-motion/jobs.ts` |
| URLs firmadas HMAC para el worker | `server/reference-motion/signing.ts` |
| Cliente del worker GPU | `server/reference-motion/worker-client.ts` |
| API pública (sesión obligatoria) | `app/api/animations/{engines,uploads,jobs}` |
| Entrada del worker (solo URL firmada) | `app/api/animations/worker/[id]/[file]` |
| UI | `/animate` (pestaña "Motion"), `app/animate/*` |
| Import a Flipbook | `server/reference-motion/flipbook-import.ts`, `importSequence` en `server/animation/flipbooks.ts`, `POST /api/animations/jobs/:id/flipbook` |
| Worker GPU | `services/animation-worker` (README propio) |

Estados: `queued → validating → awaiting_gpu → preprocessing → generating → postprocessing → uploading → verifying → completed`, más `failed`, `cancel_requested`, `cancelled`. El progreso es etapas completadas / etapas totales; nunca un temporizador. `preprocessing` (poses) ocurre en el worker después del despacho, por eso va detrás de `awaiting_gpu`. Los tiempos que Focus no llega a ver entre dos consultas se guardan como `workerTimings`.

Errores: `INPUT_INVALID`, `POSE_NOT_FOUND`, `GPU_UNAVAILABLE`, `MODEL_OOM`, `GENERATION_FAILED`, `CANCELLED`, `OUTPUT_INVALID`, `TIMEOUT`, `INTERRUPTED`. Todos menos `INPUT_INVALID` y `POSE_NOT_FOUND` son reintentables; un reintento con la misma `Idempotency-Key` cuenta una vez y no consume generación.

## Import a Flipbook

"Open in Flipbook" convierte un render verificado en una secuencia continua de Flipbook, privada del usuario: un frame por tick a 24 dibujos/s (un render a 16 fps mantiene sus frames, no se inventan), el personaje subido como referencia y, si el render tiene sonido, su pista como audio del flipbook. Una vez por job y método de recorte; repetir abre el mismo flipbook.

- **Fondo plano (por defecto, gratis):** cada frame se recorta por su color de fondo, sin SAM. Un frame con fondo no plano falla con su motivo y puede reemplazarse a mano.
- **SAM 3.1 (opcional, de pago):** interruptor "Background isn’t plain". Una sola pasada de SAM sobre el clip a 24 fps (concepto `person`, y `character` solo si no encuentra nada); el objeto presente más tiempo es el personaje y su máscara de cada frame pasa a ser la transparencia de ese frame. Pasa por `guardAiRequest` (interruptor de emergencia, presupuesto diario de frames SAM, cupo de generaciones, límite por hora). El id de archivo subido a Meta se guarda en el job para no volver a subirlo.
- Registro de cámara fija: cada frame queda donde se renderizó.
- Los frames llevan `source: "imported"` y el flipbook `importedFrom`. Redibujar, mejorar con IA, chat de movimiento, plan de secuencia, referencia de vídeo, duplicar y cambiar referencia quedan bloqueados en servidor y ocultos en la UI. Reemplazar, reordenar, aprobar, fondo, audio y exportar siguen disponibles.
- Si la subida del personaje ya caducó (24 h), el import se rechaza: falta la referencia.

## Motor experimental: Wan2.2 vía demo ZeroGPU

`wan-zerogpu` (`services/animation-worker/app/providers/wan_zerogpu.py`) llama a la API Gradio de una demo pública de Hugging Face que ejecuta Wan2.2-Animate (por defecto ninguna; se activa con `ZEROGPU_SPACE=alexnasa/Wan2.2-Animate-ZEROGPU`). La inferencia corre en Hugging Face con la cuota gratuita de ZeroGPU: el worker no necesita GPU y no se factura nada. Las poses, el retarget, la exportación y la verificación siguen siendo los del worker y de Focus.

- **Tercero:** la imagen del personaje y el segmento recortado se suben a ese Space. La UI lo avisa en "Before generating". Usar solo material que se pueda compartir.
- **Restricciones de la demo** (leídas con `Client.view_api()` el 29/10/2026, commit `96e899b7…`): 2–20 s, modo "Pose Retarget", "Low Res" 360×640 o "Medium Res" 480×832, salida a 30 fps. Focus exige segmentos de 2–3 s y 480p para este motor; el export de Focus lo lleva a 16/24 fps.
- **Cuota:** `ZEROGPU_LOW_RES=1` (por defecto) usa "Low Res", la mitad de cuota que "Medium Res". Sin `HF_TOKEN` la cuota diaria es la anónima; con token de una cuenta gratuita, mayor. Cuota agotada, cola llena o Space dormido terminan en `GPU_UNAVAILABLE` reintentable; el detalle muestra la posición en la cola.
- **Cambios de la demo:** antes de subir nada, el provider comprueba que `/animate_scene` sigue teniendo los parámetros esperados; si no, falla con `GPU_UNAVAILABLE` sin enviar archivos. Cada render guarda en `render_report.json` el commit del Space usado (`engineCommit`) y su origen (`engineSource`).
- **No es producción:** depende de un Space ajeno, su cola y su cuota. Sirve para probar el flujo con inferencia real sin gasto.
- Instalación: `pip install ".[pose,zerogpu]"` (el Dockerfile ya lo incluye). Como no usa GPU local, el worker puede correr en una máquina CPU con `POSE_DEVICE=cpu`.

## Variables

Focus (Railway):

```env
NEXT_PUBLIC_ENABLE_REFERENCE_MOTION=true   # compilada: requiere rebuild
GPU_WORKER_URL=https://<space>.hf.space
GPU_WORKER_TOKEN=<openssl rand -hex 32>    # mismo valor en el worker
ANIMATION_URL_SECRET=<openssl rand -hex 32> # firma de URLs; obligatoria en producción
ANIMATION_CALLBACK_BASE_URL=https://focusmeta.up.railway.app  # opcional; por defecto FOCUS_PUBLIC_URL
ANIMATION_DEFAULT_ENGINE=steadydancer
ANIMATION_MAX_DURATION_SECONDS=3
ANIMATION_MAX_ACTIVE_JOBS_PER_USER=1
ANIMATION_MAX_ACTIVE_JOBS=1
ANIMATION_JOBS_PER_HOUR=6
ANIMATION_JOB_TIMEOUT_SECONDS=2700
```

Worker: ver `services/animation-worker/README.md`. `ALLOWED_CALLBACK_HOSTS` debe contener el host público de Focus.

## Desarrollo local sin GPU

1. Worker (otra terminal):

```bash
cd services/animation-worker && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev,pose]"
```

```bash
GPU_WORKER_TOKEN=<token> ALLOWED_CALLBACK_HOSTS=127.0.0.1 ALLOW_INSECURE_CALLBACKS=1 ANIMATION_ALLOW_FAKE_ENGINE=1 POSE_DEVICE=cpu services/animation-worker/.venv/bin/uvicorn app.main:app --app-dir services/animation-worker --port 7860
```

2. Focus, en `.env.local`: `NEXT_PUBLIC_ENABLE_REFERENCE_MOTION=true`, `GPU_WORKER_URL=http://127.0.0.1:7860`, `GPU_WORKER_TOKEN=<token>`. Reiniciar `pnpm dev` y abrir `/animate`.

El motor "Test engine (no AI)" recorre el pipeline completo con poses reales: mueve el personaje, rígido, con la cadera del baile y dibuja encima el esqueleto transferido. El resultado lleva `synthetic: true` en Focus y en `render_report.json`, y la UI lo advierte. No es una animación.

## Despliegue del worker en Hugging Face

1. Crear un Space **privado**, SDK Docker, con el contenido de `services/animation-worker` (el `README.md` ya trae `sdk: docker`, `app_port: 7860`).
2. Secrets del Space: `GPU_WORKER_TOKEN`, `ALLOWED_CALLBACK_HOSTS`, `GPU_HOURLY_USD` según el hardware elegido.
3. Motores: construir una imagen derivada (o montar almacenamiento persistente) con el checkout de SteadyDancer o Wan2.2, sus pesos y **su propio entorno Python**, y definir `STEADYDANCER_*` / `WAN_*`. Sus versiones de PyTorch/CUDA/MMCV entran en conflicto con las del worker; no instalarlos en el mismo venv.
4. Sleep/pause activado para no pagar inactividad. Focus espera el arranque en frío en `awaiting_gpu` hasta el plazo del job; si el Space olvida el run (reinicio), el job falla con `GPU_UNAVAILABLE` reintentable.
5. Consultar precios vigentes antes de activar hardware: https://huggingface.co/pricing.

Si HF Spaces no sirve, el mismo contenedor corre en RunPod, Modal u otro host con GPU: solo cambia `GPU_WORKER_URL`.

## Smoke test GPU (FOCUS-RM-001) — pendiente

No ejecutado con el worker propio: este entorno no tiene GPU NVIDIA local. Antes de habilitar un motor real:

1. Desplegar el worker con un motor configurado; `GET /readyz` debe listarlo.
2. Desde `/animate`: personaje anime distinto sobre fondo simple + 3 s del baile de 16,29 s (segmento 4–7 s, brazos y piernas visibles), 480p, 24 fps, sin RIFE.
3. Registrar en `docs/animation-model-benchmark.md`: commit del motor y pesos (`render_report.json` → `engineCommit`, `weights`), GPU y VRAM pico, tiempos por etapa, costo, y revisión visual humana (movimiento, identidad, líneas, manos/pies, fondo, flicker).
4. Repetir con `RIFE` activado y comparar `animation.mp4` con `animation_rife.mp4`.
5. Solo entonces cambiar `ANIMATION_DEFAULT_ENGINE` y quitar `ANIMATION_ALLOW_FAKE_ENGINE` del worker de producción.

## Verificación hecha

- Prueba exploratoria gratuita de Wan2.2-Animate en el Space comunitario `alexnasa/Wan2.2-Animate-ZEROGPU` (29/10/2026), por API Gradio: Seita + 2 s del recorte de baile usado anteriormente, Pose Retarget, Low Res, sin RIFE. Resultado real: H.264 yuv420p 336×672, 30 fps, 60 frames, 2,00 s; FFprobe y decodificación completa correctos. Tiempo total del cliente 76,73 s, usando cuota gratuita. Movimiento transferido y apariencia reconocible, con desenfoque visible en manos/rostro; revisión humana pendiente. Detalles y límites en `docs/animation-model-benchmark.md`. No ejecuta ni valida el worker propio.
- `pnpm vitest run server/reference-motion`: 11 pruebas (firma, subidas reales, estados medidos, idempotencia, propiedad, GPU no disponible antes de cobrar, segmento fuera de rango, vídeo negro rechazado, worker perdido + reintento, `MODEL_OOM`, cancelación, duración).
- `pytest` en el worker: 19 pruebas (token, SSRF, manifest con URL ajena, suavizado, saltos, seguimiento del sujeto, retarget, pipeline completo con subidas HTTP reales, `POSE_NOT_FOUND`, checksum, cancelación).
- Import: pruebas Vitest (fondo plano: 48 frames, registro que sigue el movimiento, idempotencia, propiedad, redibujo bloqueado; SAM simulado sobre fondo con textura: 48/48 recortes por alfa, guarda llamada una vez, audio conservado, y el recorte por fondo plano del mismo render falla con su motivo) y en navegador: render de 3 s, "Open in Flipbook", 72/72 frames listos y export MP4 verificado (3 s, 60 fps, 180 frames).
- `wan-zerogpu`: 9 pruebas pytest con `gradio_client` simulado (parámetros enviados, rechazo de 1 s y 720p, cuota → `GPU_UNAVAILABLE`, API cambiada rechazada antes de subir, cancelación del job remoto, clasificación de errores) y 1 prueba Vitest de las restricciones en Focus. Sin llamadas reales al Space salvo `view_api` para leer el esquema.
- **Primer render real a través del worker de Focus** (`wan-zerogpu`, 29/10/2026). Primer intento por la UI: el Space lo rechazó por cuota anónima agotada (job `GPU_UNAVAILABLE`, sin GPU usada). Segundo intento con `HF_TOKEN` de una cuenta gratuita, con `services/animation-worker/scripts/smoke_run.py` (worker real con un stub local de las URLs firmadas de Focus, sin servidor Focus): Seita + 2 s del baile (4–6 s del original), Low Res. Completo: DWPose 48/48 frames con sujeto (65 s en CPU), generación en el Space 72 s, export y verificación del worker: H.264 yuv420p, 336×672, 24 fps, 48 frames, 2,00 s, decodificación completa sin errores. `render_report.json` guarda `engineCommit` 96e899b7… y `engineSource`. Revisión de 8 muestras frente a la entrada: movimiento transferido (incluido el brazo levantado de los frames 4 y 6, que la prueba de Codex no reprodujo igual), identidad conservada; mismos defectos que la demo: rostro sin detalle, brazos rápidos con rastro y brazos cortados por el encuadre al final. Artefactos: `.focus-data/benchmarks/wan-zerogpu-worker-2026-10-29/` (no versionado). Después, ese mismo render pasó por el servidor de Focus con un worker de repetición temporal (sube los archivos ya generados; sin inferencia ni cuota): despacho, rutas firmadas y `verifyVideo` correctos (H.264 yuv420p, 336×672, 24 fps, 48 frames, 2,00 s, 0 % negro); `synthetic: false`.
- **Import a Flipbook de ese render, recorte por fondo plano:** 48/48 frames "ready" con aviso `subject_cropped` (la demo deja al personaje tocando los bordes). La revisión visual muestra un fallo que los controles automáticos no detectan: el fondo es blanco y la camisa y las zapatillas de Seita también, y el recorte por color les abre agujeros. Corregido el mismo día con el recorte "lineart" (abajo).
- **Recorte "lineart" para frames importados** (`keyMode: "lineart"` en `extractSubject`): el trazo oscuro del dibujo, engrosado 1 px, hace de muro para el relleno desde el borde (tolerancia 28 en vez de 52), y no se borran las zonas del color del fondo encerradas por el cuerpo (en los dibujos de Muse sí, porque allí el fondo es un color clave ajeno al personaje). Cada recorte mide `leakShare`: cuánto personaje más se conserva con el trazo 1 px más grueso; por encima del 6 % el frame recibe el aviso `cutout_leak`. Sobre los 48 frames reales: camisa, mangas y zapatillas conservadas, cobertura mediana 0,320 frente a ~0,27, `leakShare` 0 en todos (el recorte anterior perdía una mediana del 14 % del personaje, hasta el 24 %). Coste visible: pequeñas zonas blancas encerradas que se quedan (entre brazo y cabeza, entre piernas). Comprobado también que el reproductor y el export no recortan renders 1:2: escenario 9:16 de 432×768 con la celda de 384×768 entera; un recorte de cabeza que pareció verse en una captura no se reprodujo (canvas, frames 28/30/48 y MP4 exportado con la cabeza completa). Pruebas sintéticas: camisa blanca con contorno cerrado conservada; hueco de 3 px detectado (> 20 %); hueco de 1 px sellado.
- Import con SAM 3.1 real (29/10/2026, una pasada aprobada): 1 s del baile real, cuyo fondo gris con franjas negras no se puede recortar por color, importado desde la UI con el interruptor SAM. Resultado: 24/24 frames recortados por alfa, sin avisos, registro que sigue el desplazamiento. Revisión visual: fondo eliminado, pelo, manos y medias intactos. Coste registrado en `usage.jsonl`: 1 subida a la Files API y 1 llamada `sam-3.1` (concepto `person` a la primera), facturada como 50 frames (el mínimo por llamada). Para esta prueba se sustituyó el MP4 de un job del motor de prueba por ese segundo del baile, en los datos locales de prueba: valida el recorte, no un motor.
- End-to-end local con la UI: baile de 16,29 s (segmento 4–7 s) + personaje Seita; DWPose real en CPU (72/72 frames con sujeto), motor de prueba, verificación de Focus: H.264 yuv420p 480×832, 24 fps, 72 frames, 3,00 s, 0 % negro. 38 s en total, 36 s de poses en CPU.

## Pendiente

- Recorte "lineart": un trazo con huecos mayores de ~4 px, o tan borroso que no llega a oscuro, puede seguir dejando pasar el relleno sin que `leakShare` lo detecte (ambos rellenos se cuelan). Para esos casos, import con SAM 3.1.


- Smoke test y benchmark de SteadyDancer y Wan2.2-Animate en GPU; elección del motor por defecto con datos.
- RIFE en GPU y A/B.
- SAM 3.1 dentro del worker (máscaras para el modo `replacement` de Wan) y Muse Image (referencia preparada): sin conectar; solo tienen sentido con un motor real funcionando.
- Con más de una réplica de la API, sustituir el despachador en proceso por una cola (Redis) y el store JSON por Postgres; el contrato con el worker no cambia.
