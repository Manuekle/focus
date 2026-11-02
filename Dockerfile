# Focus — single-container deployment: Next.js (standalone) + FFmpeg.
# Video processing runs in-process; a long-lived container, not serverless.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public release boolean, compiled into both client and server by Next.js.
ARG NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false
ARG NEXT_PUBLIC_ENABLE_FLIPBOOK=false
ARG NEXT_PUBLIC_ENABLE_REFERENCE_MOTION=false
ARG NEXT_PUBLIC_ENABLE_ROTOSCOPE=false
# Upload limits shown by the interface; pass the same values at runtime (--env-file).
ARG FOCUS_MAX_VIDEO_DURATION_SECONDS=60
ARG FOCUS_MAX_UPLOAD_MB=150
ARG FOCUS_MAX_IMAGE_UPLOAD_MB=15
RUN NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS="${NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS}" NEXT_PUBLIC_ENABLE_FLIPBOOK="${NEXT_PUBLIC_ENABLE_FLIPBOOK}" NEXT_PUBLIC_ENABLE_REFERENCE_MOTION="${NEXT_PUBLIC_ENABLE_REFERENCE_MOTION}" NEXT_PUBLIC_ENABLE_ROTOSCOPE="${NEXT_PUBLIC_ENABLE_ROTOSCOPE}" \
  FOCUS_MAX_VIDEO_DURATION_SECONDS="${FOCUS_MAX_VIDEO_DURATION_SECONDS}" FOCUS_MAX_UPLOAD_MB="${FOCUS_MAX_UPLOAD_MB}" \
  FOCUS_MAX_IMAGE_UPLOAD_MB="${FOCUS_MAX_IMAGE_UPLOAD_MB}" pnpm build

FROM node:24-bookworm-slim AS runner
# FFmpeg/FFprobe from Debian: H.264 (libx264), AAC, lanczos scaling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates gosu python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Rotoscope's DWPose and fidelity gate run as Python scripts of the animation worker (Debian's Python 3.11,
# which onnxruntime 1.21 supports). CPU-only; the ONNX weights are baked in below so no run downloads them.
COPY services/animation-worker/pyproject.toml ./services/animation-worker/pyproject.toml
COPY services/animation-worker/app ./services/animation-worker/app
COPY services/animation-worker/scripts ./services/animation-worker/scripts
RUN python3 -m venv /opt/rotoscope \
  && /opt/rotoscope/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/rotoscope/bin/pip install --no-cache-dir "./services/animation-worker[pose]" \
  && /opt/rotoscope/bin/python -I -c "import cv2, numpy, rtmlib, onnxruntime"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 FOCUS_DATA_DIR=/data ROTOSCOPE_PYTHON=/opt/rotoscope/bin/python
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chmod=755 deploy/docker-entrypoint.sh /usr/local/bin/focus-entrypoint
COPY deploy/check-providers.mjs /usr/local/lib/focus/check-providers.mjs
RUN mkdir -p /data && chown node:node /data
USER node
# DWPose weights (~200 MB) land in ~/.cache/rtmlib of the user that runs Next.js, so no run downloads them.
RUN /opt/rotoscope/bin/python -I -c "from rtmlib import Wholebody; [Wholebody(to_openpose=False, mode=m, backend='onnxruntime', device='cpu') for m in ('performance', 'balanced')]"
# Mount /data through Railway Volumes or docker --volume.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["focus-entrypoint"]
CMD ["node", "server.js"]
