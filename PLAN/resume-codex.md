# Traspaso a Claude — Focus Animation Engine 2.0

Fecha: 29 de octubre de 2026. Repositorio: `/Users/manudev/Dev/focus`.

## Estado y objetivo

El usuario quiere que un personaje anime imite el movimiento de un video, con resultado reproducible y editable en Focus. **Ya se obtuvo una generación real gratuita de Wan2.2-Animate en una demo comunitaria de Hugging Face.** Todavía no se ejecutó inferencia real mediante el worker propio de Focus, ni se probó SteadyDancer o RIFE en GPU.

La prioridad expresada fue evitar gasto y no depender de instalar modelos en su equipo. Después preguntó por ejecución local en su Mac; se investigó, pero **no se instaló ni se probó ningún motor local**. No hay presupuesto autorizado para activar GPUs de pago.

Leer primero:

- `PLAN/FOCUS_Animation_Engine_2_Implementation_Plan.md`.
- `docs/animation-operations.md`.
- `docs/animation-model-benchmark.md`.
- `docs/animation-architecture.md`.
- `docs/animation-license-audit.md`.
- `services/animation-worker/README.md`.

## Qué existía al recibir el trabajo

Lo siguiente está documentado por el trabajo anterior; no se volvió a ejecutar en esta sesión:

- Pipeline local con DWPose real en CPU y motor de prueba marcado como sintético.
- Jobs, subidas, autenticación, URLs firmadas, errores, cancelación, reintentos y verificación de resultados.
- Import del resultado a Flipbook, tanto por fondo plano como por SAM.
- **Import con SAM 3.1 real ya validado**: 24 frames de un segundo del baile recortados por alfa, una subida a Meta y una llamada SAM. El video de esa prueba se sustituyó en un job sintético; prueba segmentación/import, no generación temporal.
- Las pruebas Vitest/Pytest y las comprobaciones de navegador anteriores se resumen en `docs/animation-operations.md`. No presentar esos resultados como pruebas ejecutadas ahora.
- El usuario informó que había detenido el servidor de prueba y retirado la configuración temporal de `launch.json`.

No volver a poner «import con SAM real» como pendiente.

## Trabajo realizado en esta sesión

### 1. Revisión del proyecto y de la infraestructura

- Se leyeron el plan, las operaciones, el README del worker y los adapters.
- Inicialmente no había URL/token de worker GPU ni credenciales de Hugging Face configurados en los `.env` revisados.
- No había NVIDIA/CUDA local disponible. Más tarde se identificó el equipo: **MacBook Air, Apple M2, 16 GB de memoria unificada**.
- Se investigaron Hugging Face Spaces, Runpod, Modal y Colab con fuentes públicas. No se activó infraestructura facturable.

### 2. Runpod: instalación y conexión, sin despliegue

El usuario pidió expresamente seguir <https://agents.runpod.io/>. Se ejecutó:

```sh
rtk proxy codex plugin marketplace add https://github.com/runpod/runpod-plugins-official.git --json
rtk proxy codex plugin add runpod@runpod --json
rtk proxy codex mcp login runpod
```

Verificación:

- Plugin **`runpod@runpod` 1.8.0**, habilitado.
- **16 habilidades** instaladas en `/Users/manudev/.codex/plugins/cache/runpod/runpod/1.8.0/skills/`.
- Servidor MCP `https://mcp.runpod.io/`, autenticado mediante **OAuth**. La última consulta de `codex mcp list --json` mostró `enabled: true`, `auth_status: o_auth`.
- Las herramientas Runpod no aparecieron en el inventario de herramientas de este chat, aun cuando la autenticación del CLI fue correcta. No se verificó un listado de Pods mediante MCP; se usó la consola web para la inspección disponible.
- La consola saludaba al usuario Manuel y mostraba **USD 0,00 de saldo** en ese momento.
- Se preparó únicamente un formulario de despliegue: `focus-rm-smoke`, PyTorch 2.8.0 / CUDA 12.8.1, una **A100 SXM de 80 GB**, 300 GB de disco temporal y sin volumen persistente.
- Precio que mostró el formulario: GPU **USD 1,79/h** + disco **USD 0,042/h**, total mostrado **USD 1,83/h**. Son precios observados, no una cotización permanente.
- **No se pulsó Deploy Pod; no se creó Pod, volumen ni endpoint; no se cargó saldo ni se inició facturación desde esta sesión.**
- Captura del formulario: `/tmp/focus-runpod-config.png` (temporal; el formulario de navegador tampoco es infraestructura persistida).

La configuración anterior sirve como referencia si más adelante el usuario autoriza gasto. No representa un límite automático: todavía no se implementó ningún control de apagado/presupuesto.

### 3. Búsqueda de opciones gratuitas

La vía que se probó fue **Hugging Face ZeroGPU**, usando una demo existente:

<https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU>

La documentación consultada publicaba 2 minutos diarios sin autenticación y 5 minutos para una cuenta gratuita; son segundos de cómputo, no duración del video, sujetos a cuota y cola. Las cuentas gratuitas elegibles podían alojar hasta dos Spaces ZeroGPU (correo verificado y antigüedad superior a 30 días). **ZeroGPU requiere Gradio: el worker Docker/FastAPI actual no puede trasladarse allí sin adaptación.** Revalidar límites antes de otra ejecución.

También se revisaron Colab (GPU gratuita sin tipo/disponibilidad garantizados), Modal (A100 80 GB alrededor de USD 2,50/h solo GPU, más CPU/memoria) y HF GPU Spaces dedicados (A100 80 GB USD 2,50/h en la documentación consultada). No se creó ningún recurso en esos servicios.

No se encontró una demo gratuita operativa de SteadyDancer que se pudiera confirmar. Esto no demuestra que no exista.

### 4. Generación real gratuita de Wan2.2

La carga automatizada por selector de archivos en el navegador integrado no funcionó. Se continuó con la **API pública Gradio** del mismo Space, mediante `gradio_client` ejecutado con `uv run --with gradio_client`. El cliente HTTP corrió localmente; **toda la inferencia del modelo ocurrió en Hugging Face**. No se descargaron pesos a la Mac.

| Campo | Resultado comprobado |
| --- | --- |
| Space | `alexnasa/Wan2.2-Animate-ZEROGPU` |
| Commit del Space | `96e899b7c57220183defee4ce91a79d694b2375d` |
| Modelo declarado por su código | `Wan-AI/Wan2.2-Animate-14B` |
| Endpoint público | `/animate_scene` |
| Modo | `Pose Retarget` |
| Calidad solicitada | `Low Res` |
| Duración solicitada | 2 s |
| RIFE | No |
| Referencia | Seita, personaje anime de cuerpo completo |
| Movimiento | Primeros 2 s del recorte de 3 s utilizado en la prueba local anterior |
| Autenticación HF | Sin token |
| Tiempo total del cliente | 76,73 s, incluyendo carga, cola/proceso y descarga |
| Salida | MP4 H.264, yuv420p, **336 × 672**, **30 fps**, **60 frames**, **2,00 s** |
| Tamaño del MP4 | 1.197.718 bytes |
| Verificación | FFprobe + decodificación completa con FFmpeg, sin errores |
| Coste para esta prueba | Cuota gratuita; no se activó hardware de pago |

Se usaron los archivos de entrada de este job anterior del motor sintético, no su salida sintética:

```text
/tmp/claude-501/-Users-manudev-Dev-focus/226ba0d1-e7c7-4786-b608-bc22fa8458ca/scratchpad/focus-e2e-data/reference-motion/jobs/4d586c80-6493-4031-a454-65d6a57a35d2/input/
```

El recorte de entrada dura 3 s, 592 × 1280, 24 fps. Para no depender de `/tmp`, al preparar este traspaso se copiaron y verificaron ambas entradas en el directorio estable de artefactos que se indica abajo.

La inspección preliminar del asistente sobre seis fotogramas mostró movimiento transferido de brazos/cuerpo y conservación de pelo negro, camisa blanca, corbata, pantalones y zapatos. Se ve desenfoque/suavizado en manos, rostro y líneas durante el movimiento. **No se hizo una evaluación humana puntuada ni se certificó ausencia de flicker en reproducción completa.**

El Space no entregó GPU física exacta, VRAM pico, tiempos por etapa ni revisión exacta de pesos. No llamar «tiempo GPU» a los 76,73 s. Su código usa wrappers/modificaciones propias; el commit del Space no equivale a un commit del adapter/upstream de Focus.

## Artefactos para revisar y reutilizar

Directorio absoluto:

```text
/Users/manudev/Dev/focus/.focus-data/benchmarks/wan-zerogpu-2026-10-29/
```

| Archivo | Contenido |
| --- | --- |
| `animation.mp4` | Animación real generada, lista para reproducir |
| `pose.mp4` | Video diagnóstico de poses devuelto por la demo |
| `inputs/driving.mp4` | Entrada original de 3 s; la solicitud procesó 2 s |
| `inputs/character.png` | Entrada exacta de Seita |
| `character.png` | Copia de referencia para inspección |
| `input-contact.jpg` | Seis muestras del movimiento de entrada |
| `output-contact.jpg` | Seis muestras del resultado |
| `attempt.json` | Parámetros, commit del Space, hashes, rutas originales, duración y verificación |
| `handoff-artifacts.json` | Rutas estables, hashes de integridad y tamaños de los artefactos para este traspaso |

Estos archivos son datos locales no versionados. No asumir que viajan con Git. Las rutas `/tmp` y las rutas de descarga originales de `attempt.json` se conservaron como evidencia histórica; para continuar usar las copias de `inputs/`.

Hashes de las entradas:

```text
driving.mp4   cf9bdd9a423e80ae1d207258682c89780bd7236f1fb179c515f64812ce24082a
character.png 4b985226b13e0f9b334b2c119e88fc9df45d722f957f771b6a9e7ec77df81fa0
```

### Cómo se llamó a la demo

Ejemplo equivalente a la llamada realizada. **No ejecutarlo solo para verificar el documento: otra solicitud consume cuota.** Antes de repetir, consultar de nuevo la API del Space con `Client.view_api()`; el esquema o el servicio pueden cambiar.

```python
from gradio_client import Client, handle_file

root = "/Users/manudev/Dev/focus/.focus-data/benchmarks/wan-zerogpu-2026-10-29"
client = Client(
    "alexnasa/Wan2.2-Animate-ZEROGPU",
    verbose=False,
    download_files=f"{root}/downloads",
)
job = client.submit(
    input_video=handle_file(f"{root}/inputs/driving.mp4"),
    max_duration_s=2,
    edited_frame=handle_file(f"{root}/inputs/character.png"),
    rc_str="Pose Retarget",
    resolution_choice="Low Res",
    api_name="/animate_scene",
)
result = job.result()
```

El script original consultaba estado cada 5 s, tenía un plazo de 900 s incluyendo cola, guardaba `attempt.json` y descargó cinco salidas. En Pose Retarget, las cuatro salidas diagnósticas apuntaron al mismo video de poses; no son cuatro inferencias distintas.

## Investigación: ejecutar en la Mac del usuario

**No es obligatorio usar NVIDIA para toda IA.** La Mac tiene GPU integrada y puede acelerar modelos compatibles mediante Metal/MPS o MLX. El problema de estos motores concretos es la compatibilidad de implementación y el consumo de memoria.

- Equipo comprobado: **MacBook Air M2, 16 GB de memoria unificada**. No confundir esos 16 GB compartidos con 16 GB de VRAM dedicada libres para el modelo.
- Los adapters actuales `services/animation-worker/app/providers/steadydancer.py` y `wan_animate.py` dependen de `cuda_available()`. En `providers/base.py` esa comprobación busca `nvidia-smi`. No existe un adapter MPS/MLX en Focus.
- No basta con eliminar la comprobación de CUDA o cambiar una cadena a `mps`: hay que validar backend, operadores, precisión, dependencias, preprocesamiento y consumo real.
- Las versiones originales de estos modelos grandes no son una ruta viable tal como están en esta Mac. Variantes cuantizadas/offload requieren una evaluación aparte; no se demostró que una variante quepa o genere un video en 16 GB.
- Se encontró **Spielberg**, una implementación comunitaria de Wan2.2-Animate en MLX con cuantización de 4 bits: <https://github.com/dtellz/spielberg>. Su README declara validación en **M4 Pro con 48 GB**, no en el M2 de 16 GB del usuario. También declara que el retargeting de poses/FLUX edit no está conectado: no asumir equivalencia con el modo Pose Retarget de la demo.
- Se encontraron rutas generales MPS en DiffSynth-Studio y forks MPS de Wan2.2. No se instaló ninguno ni se comprobó específicamente Wan2.2-Animate end-to-end en este equipo. Que un proyecto soporte Wan2.2 text/image-to-video no demuestra soporte Animate.
- SteadyDancer publica referencias a GGUF/ComfyUI, pero no se obtuvo evidencia suficiente para prometer funcionamiento local en este equipo.

La conclusión comunicada al usuario fue: **se puede investigar una variante local reducida, pero no garantizar compatibilidad, memoria o tiempos**. Se corrigió la impresión anterior demasiado categórica de que una Mac no puede hacer esto.

## Qué cambió y qué no

Durante esta sesión se actualizaron:

- `docs/animation-model-benchmark.md`: prueba exploratoria real, métricas verificadas y límites.
- `docs/animation-operations.md`: registro de la demo y distinción respecto del smoke test del worker propio.
- Este documento: `docs/claude-animation-handoff.md`.
- Datos de la prueba bajo `.focus-data/benchmarks/wan-zerogpu-2026-10-29/`.
- Configuración personal de Codex para instalar/habilitar Runpod y completar OAuth, fuera del repositorio.

No se cambió código de la aplicación, adapters, motor por defecto ni configuración de producción. No se hizo commit, push, PR ni despliegue. El repositorio ya tenía numerosos cambios sin confirmar antes de este trabajo, incluidos archivos nuevos de Reference Motion y otras modificaciones: preservarlos y no atribuirlos a esta sesión.

Se ejecutó `rtk git diff --check` sin errores. No se repitieron suites de aplicación porque este trabajo añadió documentación y ejecutó una prueba externa; la verificación efectiva del nuevo video fue FFprobe/FFmpeg.

## Pendientes y continuación sugerida

1. Revisar `animation.mp4` con el usuario y evaluar movimiento, identidad, manos/pies y flicker a velocidad normal y lenta. Los contactos son evidencia parcial.
2. Si la prioridad es cero gasto, continuar con la cuota ZeroGPU disponible. Una integración en Focus requeriría un provider específico para la API comunitaria y manejo de cuota, cola, indisponibilidad y formatos de salida; **no se ha implementado ni debe asumirse como infraestructura de producción**.
3. Si la prioridad pasa a ejecución local, inspeccionar una implementación Apple Silicon y su consumo antes de descargar decenas de GB. Preparar una prueba mínima aislada y compatible con M2/16 GB; registrar OOM, swap, duración y calidad sin prometer éxito.
4. Si el usuario decide pagar, volver a comprobar acceso, saldo, disponibilidad y precio de Runpod; obtener un límite de gasto concreto antes de activar la GPU. La autenticación OAuth de Codex no constituye una API key para CLI/SSH ni implica que Claude tenga conexión propia.
5. Ejecutar el smoke test completo del worker de Focus: 3 s a 480p, motor real, contrato de jobs, resultado reproducible, telemetría y visualización/import en Focus. La demo de 2 s no cumple ese gate.
6. Probar SteadyDancer, luego RIFE A/B. Mantener pendiente la elección de motor por defecto.
7. Las máscaras SAM dentro del worker para `replacement`, Muse para referencia preparada y la migración a cola/BD para múltiples réplicas conservan el estado descrito en operaciones; no se resolvieron aquí.

## Fuentes consultadas

Información verificada o consultada el 29/10/2026; disponibilidad, cuotas y precios pueden cambiar.

- Runpod, onboarding oficial: <https://agents.runpod.io/>.
- Plugin oficial Runpod: <https://github.com/runpod/runpod-plugins-official>.
- Runpod, precios: <https://www.runpod.io/pricing>.
- Hugging Face, ZeroGPU y cuotas: <https://huggingface.co/docs/hub/spaces-zerogpu>.
- Hugging Face, GPU Spaces/precios: <https://huggingface.co/docs/hub/spaces-gpus>.
- Demo usada y código público: <https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU>.
- Modelo Wan Animate: <https://huggingface.co/Wan-AI/Wan2.2-Animate-14B>.
- Wan2.2 oficial: <https://github.com/Wan-Video/Wan2.2>.
- SteadyDancer oficial: <https://github.com/MCG-NJU/SteadyDancer>.
- Apple, aceleración PyTorch con MPS: <https://developer.apple.com/metal/pytorch/>.
- Spielberg, port comunitario MLX (declaraciones de su autor, no validación propia): <https://github.com/dtellz/spielberg>.
- DiffSynth-Studio, soporte GPU/MPS: <https://github.com/modelscope/DiffSynth-Studio/blob/main/docs/en/Pipeline_Usage/GPU_support.md>.
- Fork comunitario MPS (no probado): <https://github.com/dandandan1983/Wan2.2_mps>.
- Colab, límites oficiales: <https://research.google.com/colaboratory/faq.html>.
- Modal, precios: <https://modal.com/pricing>.

## Instrucción breve para Claude

> Continúa desde este documento y los artefactos verificados. El objetivo es transferir movimiento a personajes anime en Focus, priorizando cero gasto. Wan2.2 funcionó en una demo externa gratuita; el worker propio, SteadyDancer y RIFE siguen sin validar en GPU. El equipo local es un MacBook Air M2 con 16 GB: investiga compatibilidad y memoria antes de prometer ejecución local. No actives recursos facturables sin límite de gasto autorizado, no vuelvas a marcar SAM real como pendiente y conserva todos los cambios previos sin confirmar del repositorio.
