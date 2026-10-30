# Reference Motion — auditoría de licencias (borrador)

Fecha: 29 de octubre de 2026. **Incompleta**: registra lo leído en los README públicos; no sustituye una revisión legal ni la lectura de los términos de cada peso.

| Componente | Código | Pesos / modelo base | Pendiente de verificar |
| --- | --- | --- | --- |
| SteadyDancer (`MCG-NJU/SteadyDancer`) | Apache-2.0 según su README | `MCG-NJU/SteadyDancer-14B`; derivado de Wan 2.1 y modifica MusePose | Licencia de la tarjeta del modelo en HF, términos de Wan 2.1 y MusePose, uso comercial |
| Wan2.2-Animate (`Wan-Video/Wan2.2`) | Ver LICENSE del repo | `Wan-AI/Wan2.2-Animate-14B`; preprocesado opcional con FLUX (`--use_flux`) | Licencia del modelo; FLUX tiene términos propios (no se activa por defecto) |
| Demo ZeroGPU `alexnasa/Wan2.2-Animate-ZEROGPU` (motor experimental `wan-zerogpu`) | Código del Space, del autor de la demo | `Wan-AI/Wan2.2-Animate-14B` según su código | Licencia del Space, términos de uso de Hugging Face y de ZeroGPU para uso automatizado; recibe contenido de usuarios de Focus |
| DWPose (vía `rtmlib`) | rtmlib Apache-2.0; DWPose Apache-2.0 | ONNX `rtmw-dw-x-l` y detector YOLOX/RTMDet descargados de OpenMMLab | Términos de los checkpoints y de los datasets de entrenamiento (COCO-WholeBody) |
| RIFE (`hzwer/ECCV2022-RIFE`) | MIT | `train_log/` del repo | Licencia de los pesos publicados |
| Meta Muse Image / SAM 3.1 | API de Meta | — | Ya usados por Focus bajo los términos de Meta; no se usan en Reference Motion todavía |
| FFmpeg | LGPL/GPL (libx264 GPL) | — | Se invoca como programa externo, igual que en Focus |

Contenido de usuario: la UI pide usar solo imágenes y vídeos con derechos. El vídeo de baile de las pruebas locales es material aportado por el usuario y se usó únicamente en el entorno local.
