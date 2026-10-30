# Reference Motion — arquitectura real (Fase 0)

Fecha: 29 de octubre de 2026. Auditoría del repositorio antes de implementar el plan `PLAN/FOCUS_Animation_Engine_2_Implementation_Plan.md`.

## Lo que existe hoy

| Área | Realidad en el repo | Consecuencia para Reference Motion |
| --- | --- | --- |
| App | Un único proceso Next.js 16 (App Router, React 19) con route handlers en `app/api/**` y toda la lógica con efectos en `server/**`. Tipos y Zod compartidos en `shared/**`. | La API pública de Reference Motion vive en `app/api/animations/**` + `server/reference-motion/**`; no se crea otro backend TypeScript. |
| Despliegue | Un contenedor Docker en Railway (`Dockerfile`, `railway.json`), 1 réplica, 1 vCPU / 1 GB, volumen en `/data`. Sin GPU. | Railway sigue siendo la orquestación CPU. La inferencia va a un worker GPU externo (`services/animation-worker`). |
| Base de datos | **No hay Postgres ni ORM.** Estado = un JSON por entidad escrito con write-then-rename bajo lock por id (`server/animation/store.ts`, `server/jobs.ts`). | Se respeta el patrón: `job.json` y `asset.json` en `FOCUS_DATA_DIR/reference-motion/`. Añadir Postgres sería una migración no pedida. |
| Cola | **No hay Redis.** Trabajos en proceso, registrados en `globalThis` (Next empaqueta cada ruta por separado), con recuperación al leer un estado activo sin worker vivo. | Mismo patrón: un despachador en proceso que hace polling al worker GPU. Con una sola réplica es suficiente para el MVP; Redis se justifica cuando haya >1 réplica de la API. |
| Archivos | Disco local / volumen Railway, TTL de 24 h, presupuesto de almacenamiento (`storage-budget.ts`). Sin S3. | Focus actúa como storage: el worker descarga entradas y sube salidas mediante URLs firmadas HMAC de corta duración servidas por la propia app (`/api/animations/worker/**`). Cambiar a S3 solo toca `signing.ts` y la ruta del worker. |
| Auth | Cookie de sesión firmada; Facebook Login (simulado en local). `requireUser`. | Reference Motion exige sesión: todo asset y job tiene `ownerId` y se comprueba en cada request. |
| Límites | `server/guard.ts`: interruptor `FOCUS_AI_DISABLED`, ventanas por hora, cupo de generaciones (`quota.ts`). | Se reutilizan; se añaden `ANIMATION_MAX_ACTIVE_JOBS_PER_USER`, `ANIMATION_MAX_ACTIVE_JOBS` y duración máxima. |
| Meta | `server/ai/meta.ts` (cliente OpenAI-compatible): Muse Spark 1.3 (planner), Muse Image 1.0 (`server/animation/muse-image.ts`), SAM 3.1 (`server/ai/sam.ts`, Files API + streaming). | No se toca. SAM y Muse quedan como etapas opcionales posteriores (Fase 2), no en el camino crítico del MVP. |
| Flipbook | `/flipbook` (flag `NEXT_PUBLIC_ENABLE_FLIPBOOK`). Ya existe "movement reference" (`server/animation/motion-reference.ts`): recorta el vídeo, muestrea 24 PNG/s y **dibuja cada frame con Muse Image** usando la muestra como guía. | Es el camino de dibujo de la hackathon (Meta): **Muse Image dibuja cada frame**. Reference Motion lo alimenta: «Draw with Muse in Flipbook» (por defecto) convierte el render del motor de movimiento en la referencia de movimiento del flipbook (`importToFlipbook(…, "muse")` → `applyMotionVideo`), y Muse Image dibuja cada tick desde el personaje con ese render como guía (12 dibujos/s por defecto, confirmados en Flipbook). Con el motor de prueba, la guía es el personaje rígido con el esqueleto DWPose encima. |
| Formato del flipbook | Dibujos clave + intermedios versionados, sprites alineados de 768 px, exportación MP4/PNG/GIF propia (`server/animation/export.ts`). | Importar los frames del render tal cual (sin Muse) sigue disponible como opción secundaria: tipo de frame `imported`, recorte por fondo plano o una pasada SAM 3.1. |
| Tests | Vitest (unit + integración con FFmpeg real), Playwright e2e, `test:live` de pago aparte. | Tests nuevos de firma, estados, validación y despachador con worker simulado; pytest en el worker. |

## Decisiones

1. **Sin infraestructura nueva en Railway para el MVP.** Ni Postgres, ni Redis, ni S3: el plan pide respetar el datastore existente y el repo no tiene ninguno de los tres. Los contratos (manifest, URLs firmadas, estados) están diseñados para poder cambiarlos sin tocar el worker.
2. **Worker GPU en Python/FastAPI** en `services/animation-worker`, empaquetado para Hugging Face Docker Spaces (`app_port: 7860`) o cualquier host GPU. Expone solo `/healthz`, `/readyz` y `/internal/jobs*` con token de servicio. Nunca acepta rutas ni comandos: recibe un manifest validado con URLs firmadas.
3. **Polling en vez de callback.** Focus consulta `GET /internal/jobs/{id}` cada pocos segundos. Evita exponer otro endpoint entrante y sobrevive a un Space que se reinicia (un 404 del worker se traduce en `GPU_UNAVAILABLE`, recuperable con reintento).
4. **Motores intercambiables** (`providers/`): `steadydancer` y `wan_animate` envuelven los scripts oficiales con listas de argumentos; `fake` solo existe con `ANIMATION_ALLOW_FAKE_ENGINE=1` y marca el resultado como `synthetic`. Ningún motor real se declara funcional sin smoke test en GPU.
5. **Poses con DWPose** (vía `rtmlib`, ONNX) en el worker. SAM 3.1 no se usa para esqueletos.
6. **RIFE desactivado por defecto**; etapa opcional detrás de configuración.

## Estado de implementación

Ver `docs/animation-operations.md` para variables, comandos y lo que está verificado y lo que no.
