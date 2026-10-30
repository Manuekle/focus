# Focus animation worker — Hugging Face Docker GPU Space (app_port 7860) or any CUDA host.
#
# The base image carries the worker, DWPose and FFmpeg. Engines (SteadyDancer,
# Wan2.2-Animate) and RIFE need their own pinned Python environments and
# weights; mount them or build a derived image, then point STEADYDANCER_DIR /
# WAN_DIR / RIFE_DIR (and *_PYTHON) at them. Nothing here is a verified GPU
# configuration until the smoke test in docs/animation-operations.md passes.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    WORK_ROOT=/tmp/focus-animation POSE_DEVICE=cuda HOME=/home/user

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3.11 python3.11-venv python3-pip ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Spaces run as uid 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
RUN python3.11 -m venv /opt/worker && /opt/worker/bin/pip install --no-cache-dir --upgrade pip
COPY --chown=user pyproject.toml ./
COPY --chown=user app ./app
RUN /opt/worker/bin/pip install --no-cache-dir ".[pose,zerogpu]" \
  && /opt/worker/bin/pip uninstall -y onnxruntime \
  && /opt/worker/bin/pip install --no-cache-dir onnxruntime-gpu==1.21.1

USER user
# Bake the DWPose ONNX weights into the image instead of fetching them per cold start.
RUN /opt/worker/bin/python -c "from rtmlib import Wholebody; Wholebody(mode='balanced', backend='onnxruntime', device='cpu')"

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:7860/healthz || exit 1
CMD ["/opt/worker/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
