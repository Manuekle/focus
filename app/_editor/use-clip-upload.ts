"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileUploadItem } from "../../components/motion/file-upload";
import type { VideoAsset } from "../../shared/schemas";
import type { UploadPhase } from "./studio-upload";
import { UploadError, checkFileLocally, uploadVideo } from "./upload";
import { trackActivity } from "../_activity/activity-store";

export type UploadFailure = { readonly id: number; readonly message: string; readonly detail?: string; readonly retry?: () => void };
export type UploadState = { readonly item: FileUploadItem; readonly phase: UploadPhase } | null;

/**
 * One clip upload with real progress: local check, bytes sent, then the
 * server's FFprobe/FFmpeg preparation. Shared by the home page and the editor.
 */
export function useClipUpload(onReady: (video: VideoAsset) => void) {
  const [upload, setUpload] = useState<UploadState>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const attemptRef = useRef(0);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });

  useEffect(() => () => {
    attemptRef.current += 1;
    abortRef.current?.();
  }, []);

  const start = useCallback(async (file: File) => {
    const attempt = ++attemptRef.current;
    abortRef.current?.();
    abortRef.current = null;
    setFailure(null);
    const base: FileUploadItem = { id: `${Date.now()}`, name: file.name, size: file.size, type: file.type, file };
    setUpload({ phase: "checking", item: { ...base, status: "uploading", progress: 0 } });
    try {
      const video = await trackActivity({ title: file.name, href: "/editor" }, async (update) => {
        update(null, "Checking video…");
        await checkFileLocally(file);
        if (attemptRef.current !== attempt) throw new DOMException("Canceled", "AbortError");
        setUpload({ phase: "sending", item: { ...base, status: "uploading", progress: 0 } });
        const handle = uploadVideo(file, (fraction) => {
          if (attemptRef.current !== attempt) return;
          // Bytes are in; FFprobe and FFmpeg are now running on the server.
          update(fraction >= 1 ? null : fraction, fraction >= 1 ? "Preparing video…" : "Uploading video…");
          setUpload({ phase: fraction >= 1 ? "preparing" : "sending", item: { ...base, status: "uploading", progress: Math.round(fraction * 100) } });
        });
        abortRef.current = handle.abort;
        return handle.promise;
      }, (ready) => ({ id: `upload:${ready.id}`, title: file.name, href: `/editor?v=${ready.id}`, state: "completed", detail: "Video ready", progress: 1 }));
      if (attemptRef.current !== attempt) return;
      setUpload(null);
      readyRef.current(video);
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      setUpload(null);
      if (error instanceof UploadError && error.code === "aborted") return;
      setFailure({
        id: attempt,
        message: error instanceof Error ? error.message : "We couldn’t upload your video. Try again.",
        detail: error instanceof UploadError ? error.detail : undefined,
        retry: () => void start(file),
      });
    } finally {
      if (attemptRef.current === attempt) abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    abortRef.current?.();
    abortRef.current = null;
    setUpload(null);
    setFailure(null);
  }, []);

  return { upload, failure, start, cancel };
}
