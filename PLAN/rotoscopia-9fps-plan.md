# Plan — Rotoscopia IA frame a frame (9 fps, fondo transparente, firewall)

Fecha: 29/10/2026. Estado: **propuesta, pendiente de aprobación**. Nada implementado aún.

## Objetivo

Tomar el video de referencia, extraer **todos** sus fotogramas a 9 fps y redibujar cada uno con el personaje de referencia (Seita) en **la misma pose exacta** del frame, con **fondo transparente**. Cada imagen se valida antes de pasar a la siguiente. Si una imagen no pasa, el proceso **se detiene** y luego **continúa desde ese frame**, sin regenerar los ya aprobados. Velocidad lenta es aceptable.

Pruebas por **consola (CLI)**, no por la app. Solo cuando el usuario apruebe el resultado de consola se integra en Focus.

## Datos verificados

| Dato | Valor |
| --- | --- |
| Video | `~/Downloads/ScreenRecording_12-12-2025 10-03-04_1.mov`, HEVC, 828×1792, 60 fps, 16,29 s |
| Frames a 9 fps | 147 (`~/Downloads/147`). `~/Downloads/9` = los primeros 9, idénticos byte a byte |
| Barras negras | `cropdetect` → área útil `828×1472` desde y=160. Se recortan antes de generar |
| Personaje | `.focus-data/benchmarks/wan-zerogpu-2026-10-29/character.png` (Seita) — **confirmar** |
| Pose local | DWPose (`rtmlib` + ONNX) ya instalado en `services/animation-worker/.venv`, corre en CPU |
| Generador | Muse Image 1.0 (`server/animation/muse-image.ts`) |
| Revisor | Muse Spark 1.3 (`server/animation/quality-control.ts`) |

## Causa probable de las inconsistencias actuales

1. **El generador recibe el frame crudo del video como guía** (`motion-reference.ts` → `motionGuide`). Ese frame trae el pelo morado, ropa y cara de otra persona: el modelo mezcla identidades. Debe recibir **solo la pose** (esqueleto DWPose + silueta), nunca el personaje del video.
2. **El revisor no ve el video.** El prompt de `reviewFrames` dice literalmente "The source video is not supplied": nadie compara el dibujo con su frame fuente.
3. **Se revisa por lote** (contact sheet al final), no frame a frame con bloqueo. Un frame malo no detiene nada.
4. **24 fps fijos** en extracción (`fps=24`), no 9.
5. **Sin fondo transparente garantizado**: `ensureAlpha()` añade canal alfa pero opaco.

## Arquitectura propuesta (consola)

```
video ─► extraer 9 fps ─► recortar barras ─► DWPose por frame ─► esqueleto.png + pose.json
                                                                          │
     ┌────────────────────────── por cada frame N (en orden) ─────────────┘
     ▼
  generar (Muse Image): personaje + esqueleto N + último frame aprobado (N-1)
     │  fondo plano sólido (chroma) → recorte a alfa
     ▼
  Validación 1 — POSE (objetiva, local): DWPose sobre el dibujo vs pose del video
  Validación 2 — IDENTIDAD/ESTILO (Muse Spark): ref + frame fuente + dibujo lado a lado
  Validación 3 — ALFA/LIMPIEZA (local): fondo 100 % transparente, sin halo, sin recortes
     │
     ├─ pasa las 3 ─► guardar como APROBADO (inmutable, hash) ─► frame N+1
     └─ falla ─► reintento (máx. 3 intentos con feedback del fallo)
                  └─ 3 fallos ─► FIREWALL: detener, exit ≠ 0, guardar estado
```

### Validaciones (las 3 deben pasar)

| # | Qué mide | Cómo | Umbral inicial (ajustable) |
| --- | --- | --- | --- |
| 1 | Pose igual al video | DWPose en dibujo y frame. Normalizar por altura del torso. Distancia media por articulación + ángulos de codos/rodillas/hombros | error medio ≤ 6 % altura; ninguna extremidad > 12 %; ángulos ± 15° |
| 2 | Mismo personaje, mismo estilo | Muse Spark recibe 3 imágenes: Seita, frame fuente, dibujo. Responde JSON estricto (pose_match, identity_match, extra/missing limb, style) | todo `true` |
| 3 | Fondo transparente limpio | Alfa en bordes = 0, sin píxeles de chroma residual, bbox del personaje dentro del lienzo | 0 píxeles chroma; personaje no cortado |

"Validar hasta 3 veces" = **hasta 3 intentos de generación por frame**, cada intento pasa por las 3 validaciones. El intento 2 y 3 reciben en el prompt el motivo exacto del fallo anterior ("brazo izquierdo 20° más bajo", "zapatos distintos").

### Firewall y reanudación

- Estado en `run/<id>/manifest.json`: por frame `pending | approved | failed`, intentos, puntuaciones, hash SHA-256 del PNG aprobado.
- Escritura atómica (write-then-rename, mismo patrón que `server/animation/store.ts`) + lock de proceso: dos ejecuciones no pisan el mismo run.
- **Frame aprobado = inmutable.** Al reanudar se verifica su hash y se salta. Nunca se regenera.
- Fallo tras 3 intentos, error de red/cuota o Ctrl+C ⇒ se detiene en ese frame, guarda motivo y sale con código ≠ 0.
- `--resume` continúa desde el primer frame no aprobado. Los intentos fallidos quedan en `rejected/` para revisarlos.
- Opción `--approve-manual N`: si el usuario mira un frame rechazado y lo acepta, se marca aprobado sin regenerar.

### Fondo transparente

Prompt fuerza fondo plano sólido de un color ausente en el personaje (magenta `#FF00FF`; Seita tiene camisa blanca, así que blanco no sirve). Recorte por chroma con `sharp` + limpieza de borde (despill). Si el chroma deja halo, alternativa: una pasada SAM 3.1 (ya validada en el repo) solo para ese frame. Salida: PNG RGBA.

### Continuidad entre frames

Cada generación recibe: (a) Seita como ancla de identidad fija, (b) esqueleto del frame N con las proporciones de Seita, (c) el frame del video **en escala de grises** (ver ajuste abajo), (d) el dibujo **aprobado** N-1 solo como ancla de diseño, con la instrucción de no copiar su pose.

### Ajustes tras las primeras pruebas (29/10)

- **DWPose falla con brazos en escorzo** (codo hacia la cámara, frame 1): el esqueleto solo no basta. El generador recibe además el frame en grises (sin colores del otro personaje) y la validación de pose omite huesos que el video muestra acortados; esos los juzga el revisor.
- **El frame N-1 hacía copiar la pose anterior** (frame 2 del run v1 repitió el 1 y el revisor no lo vio). Ahora el revisor recibe una sola imagen lado a lado (video | dibujo) y responde parte por parte (brazo derecho, mano derecha, brazo izquierdo, mano izquierda, piernas, cabeza/torso); falla si cualquiera difiere o si omite alguna.
- **Tamaño y posición saltaban entre frames** (escala por torso, inestable). Ahora la escala sale de los huesos comparados con la hoja del personaje (cuartil superior, inmune al escorzo) y el ancla son los pies.
- **El firewall paró el frame 5** por ~200 px con tinte púrpura (rebote del magenta). Ahora se aplica despill global y el chequeo de alfa solo falla por manchas semitransparentes dentro de la figura.

- **Cuadrícula (pedido del usuario)**: esqueleto, frame en grises y frame anterior llevan la misma cuadrícula 8×12 numerada, con líneas objetivo de tope del pelo, suelas y centro de cadera. Encuadre fijo por clip (la mano más alta del clip en la línea 1, suelas en la 11,5) guardado en `layout.json`; las reanudaciones lo reutilizan. Nueva validación **escala** (pelo ±8 %, pies ±6 %, centro ±8 %), medida en píxeles. El registro final pone pelo y suelas exactamente en sus líneas: mismo tamaño en todos los frames.
- **Espejo**: Muse Image a menudo dibuja la pose invertida. La validación de pose lo detecta (compara también la versión volteada) y el prompt describe la pose por lado de pantalla ("el brazo a la DERECHA de la imagen…").
- **Manos (decisión del usuario)**: se juzgan solo por posición y dirección, no por forma de dedos ni palma.
- **Escorzo**: huesos de menos del 45 % del torso no se miden por ángulo (los juzga el revisor); la detección de espejo sí los usa (umbral 20 %).

### Resultado prueba 1 s (run `test-1s-v4`)

9/9 frames aprobados. Intentos por frame: 12 (frame 1, antes de los ajustes de espejo y manos), 1, 1, 1, 2, 2, 1, 4, 1. Reporte: `.focus-data/rotoscope/test-1s-v4/report/` (`sheet.png`, `side-by-side_1x.gif`, `side-by-side_0.5x.gif`, `transparent_*.mov`, `scores.md`).

### Integración en la app (aprobada por el usuario)

- Página `/rotoscope` (flag `NEXT_PUBLIC_ENABLE_ROTOSCOPE=true`, pestaña "Rotoscope"): nuevo run (video original + personaje + fps/inicio/duración), dibujo en segundo plano con "Resume from frame N" y "Stop", aviso del firewall con aprobación manual por intento, detalle de validaciones por intento, reproductor 0,1×–4× (deslizador + presets, frame a frame, bucle, video | dibujo, fondo transparente/blanco/oscuro) y ZIP de PNG transparentes.
- API `app/api/rotoscope/runs/**`; servicio `server/rotoscope/service.ts` (runs por cuenta en `FOCUS_DATA_DIR/rotoscope/<uuid>`); el pipeline (`server/rotoscope/pipeline.ts`) es el mismo de la consola.
- Flipbook: "Preview speed" pasa de 0.5/1/2× a deslizador 0,1×–4× con presets.
- `pnpm run rotoscope import --run <nombre> --owner <id>` abre un run de consola en la app.
- Pendiente para producción: DWPose (Python + rtmlib) no está en la imagen de Railway; allí la API responde 503 claro.

### Cómo se corre (implementado)

```bash
pnpm run rotoscope init --video "<mov>" --character <png> --fps 9 --seconds 1 --run <nombre>
```

```bash
pnpm run rotoscope generate --run <nombre> [--limit N]
```

```bash
pnpm run rotoscope status --run <nombre>
```

```bash
pnpm run rotoscope approve --run <nombre> --frame N --attempt K
```

```bash
pnpm run rotoscope report --run <nombre> [--speed 0.5]
```

Código: `server/rotoscope/` (extract, run-state, pose-match, alpha, draw, cli) y `services/animation-worker/scripts/rotoscope_pose.py`. Datos: `.focus-data/rotoscope/<nombre>/`.

## Comandos CLI (propuestos)

```bash
node --env-file=.env scripts/rotoscope.ts extract --video "<mov>" --fps 9 --start 0 --seconds 1 --out run/test-1s
```

```bash
node --env-file=.env scripts/rotoscope.ts generate --run run/test-1s --character .focus-data/benchmarks/wan-zerogpu-2026-10-29/character.png
```

```bash
node --env-file=.env scripts/rotoscope.ts generate --run run/test-1s --resume
```

```bash
node --env-file=.env scripts/rotoscope.ts report --run run/test-1s
```

`report` genera: contact sheet fuente vs dibujo lado a lado, GIF en tablero de transparencia a 9 fps, tabla de puntuaciones por frame.

## Fases y dificultad

| Fase | Contenido | Dificultad | Notas |
| --- | --- | --- | --- |
| 0 | Extracción 9 fps + recorte de barras; verificar que coincide con tus 9 / 147 PNG | Fácil | FFmpeg, determinista |
| 1 | DWPose por frame → `pose.json` + esqueleto PNG | Media | Ya instalado; ajustar oclusiones (brazo detrás del cuerpo) |
| 2 | Estado, firewall, lock, reanudación, hashes | Media | Lógica pura, 100 % testeable sin IA |
| 3 | Generación con esqueleto + ancla N-1, fondo chroma → alfa | Alta | Calidad depende de Muse Image; iterar prompt |
| 4 | Validación 1 (pose numérica) | Media-Alta | Proporciones distintas (personaje del video vs Seita): normalizar por segmentos, no por píxel |
| 5 | Validación 2 (Muse Spark, 3 imágenes) | Media | Prompt + JSON schema estricto |
| 6 | Validación 3 (alfa limpio) | Fácil-Media | Local con `sharp` |
| 7 | Prueba 1 s (9 frames) por consola → **tu revisión** | — | Gate humano |
| 8 | Prueba 16 s (147 frames) por consola → **tu revisión** | Alta (tiempo/coste) | Puede tardar horas; la reanudación evita repetir |
| 9 | Integrar en app: extracción 9 fps, progreso por frame, botón Reanudar | Media-Alta | Solo tras tu aprobación |
| 10 | Control de velocidad completo | Fácil | Ver abajo |

**Dificultad global: Alta.** La parte difícil es la 3-4: que un modelo de imagen respete una pose exacta y una identidad fija a la vez.

### Control de velocidad (fase 10)

Hoy `app/flipbook/sequence-player.tsx:51` solo tiene `[0.5, 1, 2]`. Propuesta: slider continuo 0,1×–4× (paso 0,05), campo numérico de fps (1–60), presets 0,25 / 0,5 / 0,75 / 1 / 1,5 / 2 / 3, avance frame a frame (← →) y bucle on/off. En CLI, `report --fps` para generar GIF/MP4 a cualquier velocidad.

## Tests (consola, sin la app)

- **Unitarios (Vitest), sin IA, rápidos**: extracción produce exactamente 9 frames para 1 s; recorte de barras; manifest atómico; reanudación salta aprobados; hash alterado ⇒ error; lock impide doble ejecución; firewall detiene al 3.er fallo; métrica de pose con poses sintéticas conocidas; chroma → alfa con imágenes de prueba.
- **Generador y revisor falsos** para probar el flujo completo: un fake que falla el frame 4 dos veces y lo aprueba al 3.º; otro que falla 3 veces ⇒ el proceso para en el 4, `--resume` empieza en el 4 sin tocar 1–3.
- **Prueba real 1 s** (paga cuota Meta): máx. 9 frames × 3 intentos = 27 imágenes + 27 revisiones. Revisas contact sheet y GIF.

## Límites honestos

- "Iguales a los del video" se puede garantizar en **pose** (medida con números) y en **identidad** (revisada), no a nivel de píxel: es otro personaje con otras proporciones, ropa y pelo.
- Manos y dedos son el punto más débil de DWPose y de los generadores. Umbral de manos más laxo o revisión manual.
- Si Muse Image no logra la pose en 3 intentos para ciertos frames (giros, oclusiones), el firewall parará allí con frecuencia. Ese dato es útil: dice qué frames necesitan otra estrategia (ej. usar el frame N-1 aprobado y editar solo el brazo).
- Coste del run completo: hasta 147 × 3 = 441 generaciones. Revisar cuota antes de la fase 8.

## Decisiones pendientes del usuario

1. ¿Personaje = Seita (`character.png` del benchmark)? Si es otro, indicar ruta.
2. ¿Primer segundo (frames 001–009) para la prueba?
3. ¿"Validar 3 veces" = hasta 3 intentos por frame con 3 validaciones cada uno? (supuesto de este plan)
