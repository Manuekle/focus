import {
  DURATION_TOLERANCE_SECONDS,
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  formatBytes,
  hasAcceptedExtension,
  isAcceptedVideoType,
} from "../../shared/media";
import { ApiErrorBodySchema, VideoAssetSchema, type VideoAsset } from "../../shared/schemas";
import { editorErrorMessage } from "./messages";

export class UploadError extends Error {
  constructor(message: string, readonly code: string, readonly detail?: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Reads duration from the browser when it can decode the file; null otherwise. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 4000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

/**
 * Fast checks before sending bytes. The server repeats all of them with FFprobe;
 * a codec the browser cannot decode (HEVC, ProRes) is left for the server.
 */
export async function checkFileLocally(file: File): Promise<void> {
  if (!hasAcceptedExtension(file.name) || (file.type && !isAcceptedVideoType(file.type))) {
    throw new UploadError("Unsupported format. Choose an MP4 or MOV file.", "unsupported_type");
  }
  if (file.size === 0) throw new UploadError("This file is empty. Choose another video.", "empty_file");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      "file_too_large",
    );
  }
  const duration = await readDuration(file);
  if (duration !== null && duration > MAX_DURATION_SECONDS + DURATION_TOLERANCE_SECONDS) {
    throw new UploadError(
      `This clip is ${duration.toFixed(1)}s long. Trim it to ${MAX_DURATION_SECONDS}s or less, then try again.`,
      "duration_too_long",
    );
  }
}

export type UploadHandle = {
  readonly promise: Promise<VideoAsset>;
  readonly abort: () => void;
};

/** XHR rather than fetch: it is the only browser API that reports upload progress. */
export function uploadVideo(file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<VideoAsset>((resolve, reject) => {
    xhr.open("POST", "/api/videos");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Focus-Filename", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        const parsed = VideoAssetSchema.safeParse(xhr.response);
        if (parsed.success) resolve(parsed.data);
        else reject(new UploadError("We couldn’t read the server’s response. Try again.", "invalid_response"));
        return;
      }
      const body = ApiErrorBodySchema.safeParse(xhr.response);
      reject(
        body.success
          ? new UploadError(editorErrorMessage(body.data.error.code), body.data.error.code, body.data.error.detail)
          : new UploadError("We couldn’t upload your video. Try again.", `http_${xhr.status}`),
      );
    };
    xhr.onerror = () => reject(new UploadError("The connection was lost during upload. Check your network and try again.", "network"));
    xhr.onabort = () => reject(new UploadError("Upload canceled.", "aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
