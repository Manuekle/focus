# Reference Motion — benchmark de motores

Plantilla para el experimento FOCUS-RM-001 y los 10 segmentos del quality gate (`PLAN/FOCUS_Animation_Engine_2_Implementation_Plan.md`, §3 y §12). **El worker propio aún no se ha validado en GPU.** Hay una prueba exploratoria real de Wan2.2 en una demo comunitaria ZeroGPU, documentada abajo; no sustituye el smoke test de Focus. Los valores del benchmark del worker saldrán de `render_report.json` y `quality_report.json`, más la revisión humana; no se estiman.

## Prueba exploratoria gratuita — 29/10/2026

- Space: [alexnasa/Wan2.2-Animate-ZEROGPU](https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU); modelo declarado por su código: `Wan-AI/Wan2.2-Animate-14B`.
- Entrada: personaje Seita de la prueba local anterior y sus mismos 3 s de baile; la demo procesó los primeros **2 s** de ese recorte, en modo **Pose Retarget**, **Low Res**, sin RIFE.
- Ejecución real remota mediante la API pública Gradio `/animate_scene`, sin token de Hugging Face, sin activar hardware de pago ni usar la GPU local.
- Salida verificada con FFprobe y decodificación completa con FFmpeg: **H.264, yuv420p, 336 × 672, 30 fps, 60 frames, 2,00 s**, sin errores de decodificación. La resolución/fps reales son los de la demo, distintos de los 480p/24 fps del smoke test previsto.
- Tiempo total del cliente: **76,73 s**, incluyendo carga, cola/procesamiento y descarga. No equivale al tiempo exclusivo de GPU. Se usó la cuota gratuita; GPU exacta, VRAM pico, tiempos por etapa y revisión de los pesos no fueron expuestos por la demo.
- Inspección visual preliminar del asistente sobre seis fotogramas: transferencia visible del movimiento de brazos y cuerpo; conserva pelo negro, camisa blanca, corbata, pantalones y zapatos del personaje. Se aprecia suavizado/desenfoque en rostro, manos y líneas durante el movimiento. La evaluación humana a velocidad normal y al 25 % sigue pendiente; no se asignaron puntuaciones.
- Artefactos locales (no versionados): `.focus-data/benchmarks/wan-zerogpu-2026-10-29/animation.mp4`, `pose.mp4`, `character.png`, `input-contact.jpg`, `output-contact.jpg` y `attempt.json`. El JSON contiene commit del Space, hashes de entrada, parámetros, tiempo del cliente y verificación de la salida.

**Alcance:** confirma que Wan2.2 puede transferir este baile a Seita en esa demo. No valida el adapter de Focus, su contrato de jobs, su import/export ni el despliegue Docker. SteadyDancer, RIFE y el benchmark reproducible del worker siguen pendientes.

## Configuración por ejecución

| Campo | Fuente |
| --- | --- |
| Job / intento / seed | `render_report.json` → `jobId`, `attempt`, `seed` |
| Motor, commit, pesos | `engine`, `engineCommit`, `weights` |
| GPU, VRAM total, pico | `gpu.name`, `gpu.vramTotalMb`, `gpu.peakVramMb` |
| Tiempos por etapa | `timings` (worker) y `timings` del job en Focus |
| Costo | `gpuSeconds` × `gpuHourlyUsd` (job → `estimatedCostUsd`) |
| Salida verificada | `output` (códec, fps, frames, duración) y `verification` del job |
| Poses | `quality_report.json` → `pose.subjectRatio`, `jumpFrames`, `retarget.framesOutsideCharacterImage` |

## Resultados

Escala 1–5 en revisión humana, con el vídeo a 1× y al 25 %, sin interpolación salvo en la fila RIFE.

| Segmento | Motor | Resolución | RIFE | Movimiento | Identidad | Líneas | Manos/pies | Fondo | Flicker | VRAM pico | GPU s | USD | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baile 4–7 s | SteadyDancer | 480p | no | | | | | | | | | | |
| Baile 4–7 s | SteadyDancer | 480p | sí | | | | | | | | | | |
| Baile 4–7 s | Wan2.2-Animate | 480p | no | | | | | | | | | | |
| Baile 4–6 s | Wan2.2 · ZeroGPU demo vía worker (`wan-zerogpu`, Low Res 336×672) | 480p | no | sin puntuar | sin puntuar | | | | | n/d | n/d (72 s de Space) | 0 (cuota gratuita) | 29/10/2026; revisión preliminar de 8 muestras en `docs/animation-operations.md` |
| Brazos cruzados | | | | | | | | | | | | | |
| Giro | | | | | | | | | | | | | |
| Pasos laterales | | | | | | | | | | | | | |
| Oclusión de mano | | | | | | | | | | | | | |
| … | | | | | | | | | | | | | |

## Decisión

Pendiente de los datos. Criterio: mejor relación calidad/costo en anime a 480p, sin cambios severos de ropa o cara, sin OOM en el hardware elegido y con licencia de pesos compatible (`docs/animation-license-audit.md`). El otro motor queda como experimental; nunca dos inferencias por job.
