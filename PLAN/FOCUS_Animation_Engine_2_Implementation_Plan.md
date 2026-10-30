# Focus — Animation Engine 2.0

> **Plan técnico de implementación | Reference Motion para personajes anime 2D**  
> **Fecha:** 29 de octubre de 2026  
> **Estado:** Propuesta de implementación; no implica que ya se hayan ejecutado modelos ni desplegado servicios.  
> **Stack objetivo:** aplicación Focus existente + TypeScript/Next.js si así lo confirma el repositorio + Python/FastAPI + PyTorch + Docker + Railway + Hugging Face GPU Spaces (o proveedor GPU alternativo).

---

## 0. Resumen ejecutivo

Construir dentro de **Focus** un modo **Reference Motion** en el que un usuario suba:

1. Una imagen de un personaje (especialmente anime/ilustración 2D).
2. Un video de referencia que contenga un movimiento o baile.
3. Opcionalmente, una instrucción de estilo y un fondo.

El sistema debe entregar un video donde **el personaje de la imagen imite el movimiento del video**, intentando preservar su identidad, anatomía, ropa, colores y estilo. Debe permitir visualizar y editar el resultado desde el editor/flipbook existente de Focus, sin destruir sus funciones actuales.

**Decisión arquitectónica:** no generar todos los fotogramas con Muse Image. La generación temporal debe recaer en un **motor especializado en video** como SteadyDancer o Wan2.2-Animate, mientras Muse Image se usa para preparar/corregir referencias, SAM 3.1 para segmentación/seguimiento, DWPose para poses y RIFE para interpolación opcional.

**MVP verificable:** transformar un fragmento de **3 segundos** del video de baile compartido por el usuario en una animación de otro personaje, con pipeline reproducible, exportación MP4 y vista previa en Focus. No intentar primero clips de 10–20 segundos ni ofrecer producción sin medir consumo de GPU.

### Principios no negociables

- Inspeccionar el código actual antes de cambiarlo; no asumir rutas, modelos, ORM ni proveedor de archivos.
- Mantener las integraciones de Muse Image y SAM 3.1 existentes.
- Separar los proveedores de IA mediante **adapters** y configuraciones por entorno.
- Ejecutar inferencia GPU fuera de Railway; Railway se usa para API, orquestación y workers CPU.
- Gestionar todo el render como **job asíncrono**, con progreso real y posibilidad de cancelar/reintentar.
- Prohibir secretos en cliente, URLs de resultados públicas permanentes y almacenamiento de binarios grandes en la base de datos.
- Tratar las estimaciones de GPU/calidad como hipótesis a validar, no promesas.

---

## 1. Validación de capacidades: qué hace cada componente

| Componente | Uso correcto en Focus | **No** asumir |
|---|---|---|
| **Meta Muse Image 1.0** (`muse-image-1.0`) | Generar/editar la imagen del personaje, ajustar postura de referencia o corregir fotogramas selectos mediante referencia | Que pueda generar por sí solo video coherente o que garantice consistencia cuadro a cuadro |
| **Meta SAM 3.1** (`sam-3.1`) | Segmentar personajes y objetos, obtener máscaras y seguirlos en un video | Que regrese landmarks anatómicos o esqueletos como un estimador de poses |
| **DWPose** | Extraer keypoints de cuerpo, manos y rostro a partir del video de movimiento | Que genere una animación final por sí solo |
| **SteadyDancer** | Candidato A para transferir movimiento a una imagen de personaje mediante un modelo de video | Que funcione fluidamente en una L4 de 24 GB sin pruebas/cuántización específica |
| **Wan2.2-Animate-14B** | Candidato B, modelo especializado en animation y character replacement | Que sea barato o ligero; las configuraciones de referencia pueden requerir GPU de 80 GB |
| **RIFE** | Crear fotogramas intermedios entre los cuadros del video generado | Que arregle miembros deformados, errores semánticos o cambios graves de identidad |
| **FFmpeg/FFprobe** | Normalizar entradas, recortar, convertir, inspeccionar, componer audio y exportar | Que añada movimiento artificialmente |

**Nota de integración:** SAM 3.1 y Muse Image se consumen mediante **Meta Model API** cuando sea conveniente; la GPU externa aloja exclusivamente los modelos que requieran inferencia propia. No es necesario desplegar SAM 3.1 por separado para un primer MVP si ya está integrado como API.

---

## 2. Repositorios y fuentes de referencia

### Repositorios candidatos

1. **SteadyDancer — candidato A (prototipo comparativo)**  
   https://github.com/MCG-NJU/SteadyDancer  
   Objetivo: animación humana coherente con conservación del primer fotograma. Código y licencia de repositorio Apache-2.0; **verificar adicionalmente licencias y términos de los pesos, modelos base, datasets y dependencias**.

2. **Wan2.2-Animate — candidato B / baseline más documentado**  
   https://github.com/Wan-Video/Wan2.2  
   https://huggingface.co/Wan-AI/Wan2.2-Animate-14B  
   Implementa modos `animation` y `replacement`. La ruta oficial de inferencia y preprocesamiento ya contiene utilidades de retargeting de poses. **No trasladar flags ni rutas entre versiones sin leer el README actual.**

3. **DWPose — keypoints corporales**  
   https://github.com/IDEA-Research/DWPose  
   Implementación y modelos de estimación de pose de cuerpo completo, con posibles dependencias MMPose/MMCV.

4. **RIFE — interpolación opcional**  
   https://github.com/hzwer/ECCV2022-RIFE  
   Repositorio MIT; contiene ejemplos Python y Docker. Probar variantes optimizadas para anime si están disponibles.

5. **Referencia complementaria (no necesaria para MVP)**  
   https://github.com/AjayKudipudi/reel-forge  
   Ejemplo comunitario de una canalización SteadyDancer + RIFE + gestión de GPU. Estudiar arquitectura, **no asumir que es código listo para producción**.

### Documentación oficial

- Muse Image: https://dev.meta.ai/docs/image-generation
- Ejemplo de Muse Image: https://dev.meta.ai/docs/cookbook/image-generation-basics
- SAM 3.1: https://dev.meta.ai/models/sam-3-1
- SAM API: https://dev.meta.ai/docs/sam/overview
- Wan Animate / preprocesamiento: https://github.com/Wan-Video/Wan2.2/blob/main/wan/modules/animate/preprocess/UserGuider.md
- Hugging Face Docker Spaces: https://huggingface.co/docs/hub/spaces-sdks-docker
- Hugging Face GPU Spaces y facturación: https://huggingface.co/docs/hub/spaces-gpus
- Hugging Face precios vigentes: https://huggingface.co/pricing
- Railway API + inferencia externa: https://docs.railway.com/guides/ai-api-hosted-inference
- Railway workers asíncronos: https://docs.railway.com/guides/ai-agent-workers

---

## 3. Objetivo del MVP y criterios de éxito

### Historia de usuario

> Como usuario de Focus, quiero seleccionar una imagen de personaje anime y un video de baile; quiero que Focus transfiera el movimiento a mi personaje y me deje inspeccionar, modificar y exportar los fotogramas sin que cambie de apariencia entre ellos.

### Entrada de prueba inicial

- Video aportado en esta conversación: grabación vertical de **16,29 s, 828 × 1792**, con una chica anime bailando sobre un fondo simple.
- Para el MVP, seleccionar un tramo de **3 s** con brazos y piernas claramente visibles.
- Añadir **una segunda imagen de personaje anime diferente** como referencia de identidad.
- Primero validar recorte vertical y fondo simple; ampliar a escenas complejas después.
- La prueba con el video de referencia debe utilizarse solo cuando se tenga autorización para los materiales.

### Criterios de aceptación del MVP

- [ ] Un usuario puede cargar imagen y video, seleccionar inicio/duración y arrancar un job.
- [ ] El backend rechaza formatos, tamaños y duraciones no permitidos antes de consumir GPU.
- [ ] Se genera un archivo de poses (`poses.json`) y un video diagnóstico (`pose_overlay.mp4`).
- [ ] Se obtiene un MP4 del personaje objetivo en movimiento con audio opcional.
- [ ] La interfaz muestra **estado real del job** (cola, preparación, inferencia, postproceso, finalización).
- [ ] El resultado se reproduce en Focus y puede importarse al flipbook/timeline existente.
- [ ] El usuario puede descargar MP4 y opcionalmente secuencia PNG.
- [ ] El pipeline registra tiempos por etapa, GPU usada, memoria máxima y costo estimado.
- [ ] Ante fallo de GPU, timeout, input inválido o cancelación, el job se cierra con error recuperable y sin cargos ocultos a usuarios.
- [ ] Se produce una comparación A/B de **al menos dos variantes**: sin interpolación vs. con RIFE. No activar RIFE por defecto hasta validar que mejora los resultados.

**Quality gate manual:** evaluar 10 segmentos de prueba (brazos cruzados, giros, pasos, oclusiones) y registrar: fidelidad al movimiento, identidad, líneas de dibujo, manos/pies, fondo y flicker. La elección del modelo se hace **después** de esa evaluación, no antes.

---

## 4. Arquitectura objetivo

```text
[Focus Web / Flipbook / Timeline]
           |
           |  HTTPS: create job, poll/SSE, preview
           v
[Focus API / Railway (TypeScript or existing backend)]
   |       |        |
   |       |        +-- [Postgres: job metadata]
   |       +----------- [Redis: lightweight async queue]
   +------------------- [Object storage (S3-compatible): inputs/results]
                         |
                         | expiring signed URLs / job payload
                         v
              [GPU Worker — Python/FastAPI]
              [Hugging Face Docker GPU Space]
                         |
              +----------+-----------+
              |                      |
       [Preprocessing]         [Animation Engine]
       - FFmpeg                - SteadyDancer or Wan
       - DWPose                - reference retargeting
       - SAM masks via API     - temporal generation
       - Muse Image API (opt)  - RIFE optional
              |                      |
              +----------+-----------+
                         |
                   [MP4, PNGs, metadata]
                         |
                 [Object storage]
                         |
           [Job completion callback/status]
                         |
                    [Focus preview]
```

### Principios de separación

- **Web:** subida, previsualización, edición, visualización de progreso, historial de renders. No contiene secretos de Meta/GPU.
- **API de Focus:** autenticación, permisos, metadatos, cuotas, colas, URLs firmadas, estado y entrega de resultados.
- **Worker CPU:** despacha jobs, implementa reintentos, timeouts, cancelación, reconciliación y métricas.
- **GPU Worker:** obtiene inputs, valida manifiesto, ejecuta preprocesamiento/inferencia/postproceso, sube resultados.
- **Storage:** origen de la verdad para archivos. El directorio temporal de un Space **no es persistente**.

**Importante:** usar una cola Redis confiable y un despachador CPU de Railway para evitar depender de un único HTTP request de larga duración o del ciclo de vida de Hugging Face Spaces. El worker GPU expone un contrato seguro; no exponer públicamente una API de ejecución arbitraria.

---

## 5. Estructura sugerida del proyecto

El agente debe **adaptar** esta estructura a la organización real del repositorio; no crear un monorepo nuevo si Focus ya tiene otro patrón.

```text
focus/
├── app/ or src/                  # interfaz y API actuales (si existen)
│   ├── animation/
│   │   ├── studio/
│   │   ├── components/
│   │   └── hooks/
│   └── api/animations/
├── lib/
│   ├── animation/
│   │   ├── client.ts
│   │   ├── schemas.ts
│   │   ├── job-service.ts
│   │   ├── storage.ts
│   │   └── providers/
│   └── ...
├── services/
│   └── animation-worker/
│       ├── app/
│       │   ├── main.py             # FastAPI y health
│       │   ├── config.py
│       │   ├── schemas.py
│       │   ├── security.py
│       │   ├── orchestration.py
│       │   ├── providers/
│       │   │   ├── base.py
│       │   │   ├── steadydancer.py
│       │   │   ├── wan_animate.py
│       │   │   ├── meta_muse.py
│       │   │   └── meta_sam.py
│       │   ├── pipeline/
│       │   │   ├── ingest.py
│       │   │   ├── pose.py
│       │   │   ├── retarget.py
│       │   │   ├── animate.py
│       │   │   ├── interpolate.py
│       │   │   ├── export.py
│       │   │   └── quality.py
│       │   └── infrastructure/
│       │       ├── storage.py
│       │       └── telemetry.py
│       ├── tests/
│       ├── Dockerfile
│       ├── requirements.in / pyproject.toml
│       └── README.md             # HF Space sdk: docker, app_port: 7860
├── docs/
│   ├── animation-architecture.md
│   ├── animation-model-benchmark.md
│   ├── animation-operations.md
│   └── animation-license-audit.md
└── ...existing project files...
```

---

## 6. Pipeline detallado

### 6.1. Ingesta y normalización

1. Crear job y registrar propietario, modelo, versión, dimensiones, seed y presupuesto máximo.
2. Subir archivos directamente al object storage mediante URLs firmadas de **corta duración**.
3. Validar MIME real (magic bytes), tamaño, resolución, duración, codecs y orientación (no confiar solo en extensiones).
4. Con FFprobe extraer FPS nominal y promedio, dimensiones y audio. Convertir HEVC/variable FPS cuando el modelo requiera FPS constante.
5. Recortar el video a 3 s para el MVP, muestrear según FPS soportado por el modelo y conservar proporciones mediante letterboxing.
6. Rechazar entradas sin persona detectable o con proporciones que el motor no soporte; informar el motivo al usuario.

**Artefactos:** `input/character.png`, `input/driving.mp4`, `normalized/driving.mp4`, `manifest.json`.

### 6.2. Extracción de poses (DWPose)

1. Ejecutar detección de persona y landmarks en cada frame muestreado.
2. Elegir una persona objetivo cuando haya múltiples sujetos; pedir selección explícita en UI si hay ambigüedad.
3. Registrar keypoints, confidencias y timestamps.
4. Suavizar trayectorias con filtro temporal, **sin borrar impactos, cambios de dirección o pausas deliberadas**.
5. Dibujar un video de diagnóstico donde se vean las trayectorias del esqueleto.
6. Detectar cuadros con articulaciones perdidas, auto-oclusión o saltos bruscos, señalarlos en `quality_report.json`.

**Artefactos:** `poses.json`, `pose_overlay.mp4`, `pose_confidence.json`.

### 6.3. Segmentación opcional (SAM 3.1)

- Usar SAM 3.1 para delimitar el personaje, separar fondo u obtener máscaras de tracking cuando la tarea las requiera.
- No añadir SAM como paso obligatorio si el motor `animation` funciona sin él y el costo/rendimiento empeora.
- Asociar máscaras con frame index/timestamp y no con orden de llegada de respuesta.
- Si SAM falla, continuar con el motor que no requiera máscara (si es válido) o marcar el job como fallido con una explicación clara.
- Máscaras: necesarias especialmente para `replacement`, fondos complejos o composición con capas.

**Artefactos:** `masks/`, `tracking.json`, `source_background.mp4` (cuando aplique).

### 6.4. Identidad y Muse Image

- Priorizar conservar la imagen original y sus características (ropa, pelo, rostro, paleta y trazo).
- Muse Image puede generar una **referencia mejor alineada** con el movimiento o corregir unos pocos keyframes conflictivos.
- Cada uso de Muse debe registrar costo, prompt, referencias, salida y comparativa visual.
- Si se usa edición para retargeting, pedir aprobación opcional de la referencia corregida antes de render pesado.
- No usar Muse para generar todos los frames individualmente: no ofrece continuidad temporal garantizada.

**Artefactos:** `reference/character_prepared.png`, `reference/reference_metadata.json`.

### 6.5. Retargeting

- Normalizar escala del personaje conductor y del personaje destino.
- Estimar longitud relativa de torso, brazos y piernas y adaptar objetivos de articulaciones.
- Mantener las relaciones anatómicas del personaje objetivo, no copiar coordenadas pixel a pixel.
- Añadir validación para pies en contacto, rodillas, codos y manos fuera del campo.
- Visualizar la secuencia de poses transferidas antes de iniciar inferencia GPU de alto costo.
- En Wan2.2-Animate, comenzar por su preprocesamiento **oficial**. Evaluar retargeting básico antes de activar el basado en edición con modelos adicionales.

**Artefactos:** `retargeted_poses.json`, `retargeted_pose_preview.mp4`.

### 6.6. Motor de animación intercambiable

Diseñar interfaz común:

```python
from typing import Protocol
from dataclasses import dataclass

@dataclass
class AnimationRequest:
    job_id: str
    reference_image_path: str
    driving_video_path: str
    pose_video_path: str | None
    output_dir: str
    seed: int
    config: dict

class AnimationProvider(Protocol):
    async def validate(self, request: AnimationRequest) -> None: ...
    async def run(self, request: AnimationRequest) -> str: ...  # path MP4
```

#### A. SteadyDancer

- Reproducir primero inferencia de demostración del repo en GPU adecuada.
- Verificar versiones de PyTorch/CUDA/MMCV y si sus scripts aceptan referencia imagen/video propios.
- Medir VRAM máxima, tiempos, resolución, coherencia de identidad y cambios anatómicos.
- Registrar compromisos de cuántización si se prueba en 24 GB; **no declarar compatibilidad hasta una prueba end-to-end**.

#### B. Wan2.2-Animate

- Implementar el flujo oficial `preprocess_data.py` seguido por `generate.py --task animate-14B`.
- Empezar por `animation`, no por `replacement`.
- Usar `replacement` solo cuando la tarea exija conservar fondo/interacciones del video conductor.
- Activar offloading/precisión reducida únicamente cuando esté soportado por la versión concreta; documentar degradación o latencia.
- Tratar GPU de 80 GB como baseline conservador para la versión original; las opciones cuantizadas se comparan por separado.

**Selección del motor:** después de medir ambos, escoger el de mejor relación calidad/costo para videos anime. Mantener el otro como motor experimental, no tener dos inferencias activas por cada job.

### 6.7. Interpolación (RIFE) y composición

- Salida del motor: video base a FPS nativos.
- Ejecutar RIFE **solo cuando el usuario lo solicite o el análisis demuestre mejora**.
- Registrar frames inventados y garantizar que la interpolación no cambie duración ni sincronización de audio.
- Corregir flicker leve si hay método validado; no aplicar suavizado espacial que borre el lineart del anime.
- Componer MP4 H.264 (`yuv420p`), audio original opcional con derechos/consentimiento, vista previa WebP y secuencia PNG cuando corresponda.
- Comprobar salida con FFprobe y validaciones automáticas (FPS, duración, dimensiones, decodificación sin errores).

**Artefactos finales:** `output/animation.mp4`, `output/preview.webp`, `output/frames.zip`, `output/render_report.json`.

---

## 7. Contratos de API (orientativos, adaptar a backend actual)

### Focus API — pública autenticada

| Método | Ruta | Objetivo |
|---|---|---|
| `POST` | `/api/animations/uploads` | Obtener URL firmada para subir imagen/video |
| `POST` | `/api/animations/jobs` | Crear job con referencias a uploads verificados |
| `GET` | `/api/animations/jobs/:id` | Obtener estado, progreso, errores y outputs |
| `GET` | `/api/animations/jobs/:id/events` | SSE opcional para eventos de progreso |
| `POST` | `/api/animations/jobs/:id/cancel` | Solicitar cancelación |
| `POST` | `/api/animations/jobs/:id/retry` | Reintentar de forma idempotente |
| `GET` | `/api/animations/jobs/:id/results` | URLs de descarga firmadas para el dueño |

Ejemplo **ilustrativo** de petición:

```json
{
  "characterAssetId": "asset_character_001",
  "drivingVideoAssetId": "asset_motion_001",
  "mode": "reference-motion",
  "engine": "steadydancer",
  "startSeconds": 2,
  "durationSeconds": 3,
  "resolution": "480p",
  "outputFps": 24,
  "interpolation": false,
  "backgroundMode": "simple",
  "seed": 42
}
```

Respuesta inicial:

```json
{
  "id": "anim_job_001",
  "status": "queued",
  "progress": 0,
  "currentStage": "queued",
  "estimatedCostUsd": null
}
```

### Estados persistidos

```text
queued -> validating -> preprocessing -> awaiting_gpu
       -> generating -> postprocessing -> uploading -> completed
                           |                 |
                           +---- failed ----+
                                    |
                                  retrying
queued/active -> cancel_requested -> cancelled
```

- `progress` debe representar finalización de etapas **medida**, no una animación ficticia de 0 a 100.
- Incluir `stage`, `stageStartedAt`, `attempt`, `errorCode`, `errorMessage`, `timings`, `gpuProfile`, `costEstimateUsd` y `outputAssets`.
- Manejar `idempotencyKey` en creación/reintentos. Los callbacks de GPU se autentican y verifican contra el job actual.

### Endpoints internos de GPU Worker

- `GET /healthz` (proceso vivo).
- `GET /readyz` (modelo/pesos listos cuando corresponda).
- `POST /internal/jobs` (solo token de servicio; responde rápido con aceptación).
- `GET /internal/jobs/{id}` (estado local; conciliado con persistencia externa).
- `POST /internal/jobs/{id}/cancel` (best-effort; terminación segura).

**No implementar** un endpoint que acepte comandos shell o rutas arbitrarias desde el cliente.

---

## 8. Modelos de datos mínimos

```text
AnimationJob
  id, userId, status, stage, progress
  characterAssetId, drivingVideoAssetId
  engine, mode, configJson, seed
  durationSeconds, inputFps, outputFps, width, height
  attempt, idempotencyKey, createdAt, startedAt, completedAt
  errorCode, errorMessage, workerRunId
  inputStoragePrefix, outputStoragePrefix
  gpuType, gpuSeconds, estimatedCostUsd

AnimationAsset
  id, ownerId, jobId?, type, mime, bytes, checksum
  storageKey, width?, height?, durationSeconds?, createdAt

AnimationJobEvent
  id, jobId, stage, event, timestamp, detailsJson
```

- Respetar el esquema de base de datos y ORM existentes.
- Guardar el manifest reproducible con hashes de inputs, versión/commit de motor, versión de pesos, parámetros y seed.
- Mantener un índice para encontrar jobs abandonados; implementar reconciliador y TTL de archivos intermedios.

---

## 9. Interfaz de usuario para Focus

**Nueva sección: `Animate > Reference Motion`** (o integrada en el editor actual si ya hay un flujo de animación).

1. **Character:** subir imagen, recortar, mostrar alpha/máscara y una vista de referencia.
2. **Motion:** subir video, timeline, seleccionar segmento (3 s por defecto), scrubbing y visualización de esqueleto.
3. **Settings:** motor (Auto / Experimental), intensidad de movimiento, FPS, resolución, semilla, interpolación (off por defecto), fondo y audio.
4. **Preflight:** diagnóstico de pose, VRAM/costo estimado y errores de compatibilidad antes de generar.
5. **Generate:** botón inicia job asíncrono, estado de cada fase, cancelación y reintento.
6. **Result:** video lado a lado con original, superposición de poses, scrub de fotogramas, exportar MP4/PNG e importar al flipbook.

### Restricciones de diseño

- Conservar lenguaje visual y componentes existentes de Focus; limpio, minimalista y usable en modo claro/oscuro.
- No bloquear UI durante inferencia; persistir los jobs y permitir volver luego.
- Evitar falsos indicadores de progreso y no mostrar “render completo” antes de verificar archivo.
- Mostrar errores explicables: `INPUT_INVALID`, `POSE_NOT_FOUND`, `GPU_UNAVAILABLE`, `MODEL_OOM`, `GENERATION_FAILED`, `CANCELLED`, `OUTPUT_INVALID`.
- Incluir estado de disponibilidad de motor y costo estimado si es factible.

---

## 10. Despliegue: Railway + Hugging Face

### Railway (CPU)

Desplegar o reutilizar:

- App/API existente de Focus.
- Postgres ya existente, o el datastore actual si no conviene migrar.
- Redis/cola (si no existe, elegir una cola adecuada y justificar).
- Servicio despachador/reconciliador CPU cuando la API actual no cubra esta función.

**No intentar correr SteadyDancer ni Wan 14B en Railway:** Railway no ofrece GPU. Puede consumir APIs de inferencia externas.

Variables sugeridas (**nombres indicativos, no generar credenciales**):

```env
DATABASE_URL=...
REDIS_URL=...
OBJECT_STORAGE_ENDPOINT=...
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_ACCESS_KEY=...
OBJECT_STORAGE_SECRET_KEY=...
GPU_WORKER_URL=...
GPU_WORKER_TOKEN=...
META_MODEL_API_KEY=...
ANIMATION_MAX_DURATION_SECONDS=3
ANIMATION_MAX_ACTIVE_JOBS_PER_USER=1
ANIMATION_DEFAULT_ENGINE=steadydancer
```

### Hugging Face GPU Docker Space

Crear repositorio privado o configurado con acceso adecuado y `README.md` de Space:

```yaml
---
title: Focus Animation Worker
sdk: docker
app_port: 7860
---
```

Desplegar FastAPI con Docker de GPU, dependencias PyTorch/CUDA probadas y descarga/volumen de pesos según soporte real de Space. Al arrancar:

1. Verificar CUDA y VRAM antes de cargar pesos.
2. Cargar modelo selectivamente según engine; evitar cargar ambos 14B a la vez.
3. Esperar manifiestos de jobs autenticados y trabajar con rutas locales de una carpeta temporal aislada.
4. Descargar inputs de URL firmada con validaciones, ejecutar y subir outputs.
5. Limpiar temporales y emitir reporte final.
6. Gestionar arranques en frío: una GPU Space suspendida puede tardar en reiniciar, especialmente si debe descargar pesos.

**Persistencia:** el disco normal del Space no permanece tras reinicios. Usar object storage y, para pesos, verificar opciones de bucket/cache persistente. **No** depender de `/tmp` ni del disco del contenedor para datos de usuario.

**Facturación:** los Spaces GPU se cobran mientras están arrancando o corriendo; se puede configurar sleep/pause para evitar costos en inactividad, con el costo de cold starts. Un job debe poder reintentarse cuando una Space vuelve de suspensión.

### GPU y costos orientativos (consultar precio actual antes de activar)

| GPU en HF Spaces | VRAM | Precio listado/hora | Uso propuesto |
|---|---:|---:|---|
| T4 small | 16 GB | USD 0,40 | Preprocesado ligero o modelos muy optimizados |
| L4 | 24 GB | USD 0,80 | Poses/RIFE y pruebas de variantes ligeras |
| L40S | 48 GB | USD 1,80 | Prueba experimental de variantes optimizadas; no garantía para 14B |
| A100 large | 80 GB | USD 2,50 | Baseline conservador para Wan2.2-Animate-14B original |

Ejemplos aritméticos **solo del tiempo de GPU**: 10 min de A100 ≈ USD 0,42; 30 min ≈ USD 1,25. El costo real incluye arranques, precalentamiento, pasos de inferencia, reintentos, almacenamiento y llamadas a APIs externas. No presentar estos ejemplos como costo garantizado de un clip.

### Alternativa si HF Spaces no resulta operativo

Mantener el mismo contenedor FastAPI + storage + contratos HTTP y cambiar únicamente el proveedor GPU (RunPod, Modal u otro proveedor con GPU bajo demanda). No acoplar el núcleo de Focus a las particularidades de un host.

---

## 11. Seguridad, privacidad y cumplimiento

- Todo request público debe verificar sesión y propiedad de assets/jobs.
- Generar URLs firmadas con expiración corta y restricciones de MIME/tamaño.
- El worker descarga únicamente de destinos aprobados o claves de storage validadas para evitar SSRF.
- Limitar jobs concurrentes y duración por usuario. Aplicar rate limits y presupuestos máximos por job/día.
- No registrar imágenes, prompts privados o tokens completos en logs.
- Eliminar intermedios por política de retención; ofrecer eliminación de resultados por el propietario.
- Comprobar derecho de uso del video y de la imagen. No transferir movimiento o identidad de material ajeno sin autorización adecuada.
- En modelos/repo externos, registrar: licencia de código, pesos, modelo base, restricciones comerciales, atribución, checkpoints y dependencias.
- Revisar especialmente dependencias y pesos adicionales de pipelines de retargeting/editing, aunque el repo principal diga Apache-2.0.
- No subir secretos a Spaces públicos o al navegador.

---

## 12. Pruebas y evaluación técnica

### Unitarias

- Contratos y validación de peticiones/archivos.
- Transiciones de estado y cancelación.
- Seguridad de callbacks y URLs firmadas.
- Filtros/normalización de keypoints, retargeting y clipping temporal.
- Generación de manifiestos reproducibles y manejo de errores.

### Integración

- Mock de Meta Model API: Muse Image y SAM.
- Fake GPU engine: genera un video de prueba sin inferencia de 14B.
- Redis/DB/storage mediante containers o entornos de prueba.
- Pipeline desde creación de job hasta importación al flipbook.

### GPU smoke test

- Ejecutar video de prueba corto usando un engine real.
- Registrar commit del repo upstream, modelo/pesos, CUDA/PyTorch, resolución, duración, GPU/VRAM.
- Verificar salida decodificable y que no haya OOM.
- Validar que el personaje se mueve según referencia y se preserva su identidad (revisión visual humana).

### Benchmarks / comparación

| Métrica | Registro obligatorio | Gate inicial |
|---|---|---|
| Finalización del job | éxito/error | 100% de jobs terminan con estado consistente |
| Archivo MP4 válido | FFprobe + decode | Sí |
| Movimiento esperado | pose overlay + revisión humana | No hay desincronización obvia |
| Consistencia de identidad | comparación visual por frames | Sin cambios severos de ropa/cara |
| Artefactos anatómicos | revisar manos, piernas y oclusiones | Reportados; no ignorados |
| Costo por job | segundos GPU + APIs | Medido y visible para admin |
| Pico de VRAM | telemetría GPU | No excede capacidad configurada |
| Latencia total | etapa por etapa | Medida, sin SLO inventado |

No esconder fallos de calidad tras RIFE ni exportar un video con cuadros negros como “éxito”.

---

## 13. Roadmap de implementación por fases

### Fase 0 — Auditoría del repositorio

**Entregables:** informe de arquitectura actual, puntos de integración, inventario de Muse/SAM, editor/flipbook, storage, DB, Docker, jobs y pruebas.

- [ ] Identificar dónde se crean/generan clips hoy.
- [ ] Identificar API y SDK de Meta realmente usados.
- [ ] Confirmar si la app está en Next.js u otra tecnología.
- [ ] Verificar modelo de despliegue Railway y hosting de archivos.
- [ ] Identificar limitaciones del actual formato de flipbook/timeline.
- [ ] Publicar un plan de cambios mínimo con archivos concretos.

**Gate:** documentar arquitectura real antes de codificar.

### Fase 1 — Ingesta + UI de referencia

- [ ] Subida segura de imagen y video con storage.
- [ ] Timeline para recorte de 3 s.
- [ ] Preflight FFmpeg + pantalla de diagnóstico.
- [ ] Crear job en DB y endpoint de consulta.
- [ ] Vista de estado y manejo de errores.

**Gate:** imagen/video lleguen al storage y haya un job observable sin GPU.

### Fase 2 — Motion preprocessing

- [ ] DWPose y extracción de keypoints + confianza.
- [ ] `pose_overlay.mp4` + `poses.json`.
- [ ] Retargeting básico con vista de previsualización.
- [ ] SAM 3.1 como herramienta opcional de máscaras/tracking.
- [ ] Muse Image opcional para preparar referencia.

**Gate:** el video conductor quede descrito por poses coherentes y observables.

### Fase 3 — Worker GPU + primer render real

- [ ] Docker/FastAPI worker con auth, health y telemetría.
- [ ] Adapter SteadyDancer **o** Wan2.2-Animate, según compatibilidad real en GPU.
- [ ] Ejecutar 3 s del clip anime con personaje diferente.
- [ ] Subir MP4 y reporte a storage.
- [ ] Corregir out-of-memory/error de dependencias hasta disponer de un render reproducible.

**Gate:** al menos un render real end-to-end exitoso, reproducible y visualmente revisado.

### Fase 4 — Integración Focus + RIFE

- [ ] Conectar cola/reconciliador Railway al worker.
- [ ] Presentar progreso real y cancelación.
- [ ] Reproducir en Studio, importar frames al flipbook.
- [ ] Interpolación RIFE seleccionable y exportación MP4/PNG.
- [ ] Costos por job y limitación de consumo.

**Gate:** experiencia usable desde UI sin ejecutar scripts manualmente.

### Fase 5 — Comparación de motores y hardening

- [ ] Integrar segundo engine detrás de feature flag.
- [ ] Comparar calidad, rendimiento, VRAM, precio y licencias.
- [ ] Retrys, quotas, cancelación, timeout, reconciliación y limpieza.
- [ ] Pruebas de integración y documentación operativa.
- [ ] Elegir motor predeterminado según resultados reales.

**Gate:** motor estable y piloto controlado; no abrirlo al público sin controles de costo.

### Fase 6 — Futuro (fuera de MVP)

- [ ] Motion library con movimientos reutilizables.
- [ ] Copiar movimiento de un personaje a múltiples destinos.
- [ ] Pose editor visual y control de articulaciones.
- [ ] Composición multicapa/cámara y fondos complejos.
- [ ] Loops musicales, blending de clips y secuencias más largas con continuidad.
- [ ] Entrenamiento/adaptación solo si hay suficientes ejemplos licenciados y benchmark que justifique el costo.

---

## 14. Riesgos y mitigaciones

| Riesgo | Señal | Mitigación |
|---|---|---|
| GPU insuficiente para modelos 14B | OOM o cold start excesivo | A100 80 GB o proveedor alterno; probar versiones optimizadas en rama experimental |
| Dependencias DWPose/MMCV inestables | Error de build | Pin exacto de Python/CUDA/PyTorch y lockfile Docker probado |
| Pose de anime poco detectable | Confianza baja / manos erróneas | Diagnósticos, selección de sujeto, retargeting guiado, fallback/manual |
| El personaje cambia de cara/ropa | Deriva visual | Revisar keyframe inicial, referencias, motores y parámetros; no generar frames independientes |
| Pérdida de trabajos al reiniciar Space | Jobs atrapados | DB + storage externo + reconciliador idempotente |
| Interpolación produce deformación | Warping de brazos/manos | Desactivar RIFE o restringir a escenas seguras |
| Costo GPU aun sin usuarios | Space idle corriendo | Sleep/pause y control de presupuesto |
| Restricciones de licencia | Términos de pesos/base incompatibles | Auditoría por componente y motor alternativo |
| Archivos de usuario expuestos | URL permanente o Space abierto | URLs firmadas, validación de dueño, tokens y eliminación por TTL |

---

## 15. Definition of Done — release candidata

No considerar terminada la funcionalidad hasta que:

- [ ] El usuario pueda completar todo el flujo desde la interfaz existente.
- [ ] El render haya sido generado **de verdad** por un motor de animación, no por mock o demo pregrabado.
- [ ] Exista evidencia de un video original transformado con otro personaje.
- [ ] Poses, logs, costos, modelo, versión y artefactos se conserven en el manifest del job.
- [ ] La importación al editor/flipbook funcione sin alterar proyectos antiguos.
- [ ] El sistema resuelva trabajos abandonados y limpie temporales.
- [ ] Los secretos estén en variables del servidor.
- [ ] Pruebas unitarias/integración y smoke GPU estén documentadas y pasen.
- [ ] Se haya revisado la compatibilidad comercial de **código y pesos**.
- [ ] Los comandos para desarrollo local y despliegue estén en README.

---

## 16. Instrucciones directas para el agente de código (copiar y pegar)

```text
You are the lead engineer implementing Focus Animation Engine 2.0.

Read FOCUS_Animation_Engine_2_Implementation_Plan.md in full.

GOAL:
Extend the existing Focus application with a real Reference Motion animation
pipeline. The user supplies an anime character image and a driving-motion video;
Focus returns a temporally coherent animation that follows the video while
preserving character identity, outfit, line art, and proportions.

MANDATORY RULES:
1. Audit the actual repository first. Identify the current UI, API, flipbook,
   media storage, Docker setup, Meta Muse Image integration and SAM 3.1 integration.
2. Preserve existing functionality. Integrate instead of rebuilding the app.
3. Railway runs CPU orchestration; GPU inference runs on a separate worker
   suitable for Hugging Face Docker GPU Spaces or equivalent GPU provider.
4. SAM 3.1 provides masks/tracking, NOT skeleton joints. Use DWPose or another
   legitimate pose estimator. Muse Image is for image reference generation/editing,
   NOT a temporal video renderer.
5. Implement at least one real specialized animation backend, benchmark
   SteadyDancer versus Wan2.2-Animate when possible, and keep engines swappable.
6. Make every render an async persisted job with secure signed input/output URLs,
   retries, cancellation, clear status and cost telemetry.
7. First build a working, measurable 3-second end-to-end proof of concept.
   Do not attempt 10+ second animations until quality and VRAM are measured.
8. Add the optional RIFE interpolation stage only after the base video works.
9. Never claim GPU inference succeeded without a real output file verified
   with FFprobe and an actual visual sample.
10. Respect upstream licenses, model-weight terms and user content rights.

DELIVERABLES:
- Source code integrated into the existing Focus repository.
- Python/FastAPI GPU worker, dependency locks and Dockerfile.
- Asynchronous job endpoints and persistence.
- Reference Motion interface and result preview integrated with flipbook.
- At least one real generated MP4 from a user-supplied character/reference clip.
- Tests, benchmark results, error handling and deploy instructions.
- A short implementation report: changed files, working features, evidence,
  measured GPU specs and costs, blockers, and remaining limitations.

IMPLEMENTATION ORDER:
Audit -> secure uploads -> preprocess + DWPose -> retargeting -> GPU engine ->
MP4 export -> integrate UI -> job queue -> RIFE optional -> benchmark -> harden.

Make reasonable engineering decisions based on the actual codebase and official
upstream documentation. If a model or GPU profile is incompatible, document it,
select a supported alternative, and continue with a minimal demonstrable slice.
Do not stop after writing another plan; implement and verify as much as possible.
```

---

## 17. Primer experimento exacto a realizar

**Experimento FOCUS-RM-001**

1. Importar el video vertical del baile que se compartió (16,29 segundos en total).
2. Seleccionar un tramo de 3 segundos con desplazamiento visible de cabeza, brazos y piernas.
3. Cargar una referencia de personaje anime diferente sobre fondo simple.
4. Obtener keypoints con DWPose, generar `pose_overlay.mp4` y revisar anatomía.
5. Ejecutar un motor de animación en un worker GPU.
6. Exportar a MP4, sin RIFE en el primer intento; después producir una variante con RIFE.
7. Comparar movimiento, identidad del personaje, manos/pies, bordes y costos.
8. Importar el resultado en el editor/flipbook de Focus y registrar resultados del benchmark.

**Resultado requerido:** no solo un script que corre: un flujo usable desde Focus que produce un MP4 comprobable y permite repetir el experimento.

---

## 18. Referencias operativas y verificación

Documento preparado con revisión de fuentes oficiales y repositorios públicos al **29/10/2026**. Los precios, modelos y requisitos podrían cambiar. Verificar antes de desplegar o pagar GPU.

- SteadyDancer: https://github.com/MCG-NJU/SteadyDancer
- Wan2.2-Animate: https://github.com/Wan-Video/Wan2.2
- DWPose: https://github.com/IDEA-Research/DWPose
- RIFE: https://github.com/hzwer/ECCV2022-RIFE
- Muse Image API: https://dev.meta.ai/docs/image-generation
- SAM 3.1 API: https://dev.meta.ai/docs/sam/overview
- HF Docker: https://huggingface.co/docs/hub/spaces-sdks-docker
- HF GPU/billing: https://huggingface.co/docs/hub/spaces-gpus
- HF pricing: https://huggingface.co/pricing
- Railway GPU limitation: https://docs.railway.com/guides/ai-api-hosted-inference
- Railway async jobs: https://docs.railway.com/guides/ai-agent-workers
