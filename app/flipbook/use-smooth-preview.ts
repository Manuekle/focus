"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Flipbook,
  FlipbookBackground,
  PlaybackSettings,
} from "../../shared/flipbook";
import { flipbookApi } from "./flipbook-client";

/** Preview and download ask for exactly the same private, cached MP4. */
export function useSmoothPreview(input: {
  flipbook: Flipbook;
  settings: PlaybackSettings;
  background: FlipbookBackground;
  backgroundStamp: string;
  ready: boolean;
  onChange: (value: Flipbook) => void;
}) {
  const { flipbook, settings, background, backgroundStamp, ready } = input;
  const enabled = settings.renderMode === "smooth" && ready;
  const key = JSON.stringify({
    id: flipbook.id,
    order: flipbook.order,
    frames: flipbook.frames.map((frame) => [frame.id, frame.version]),
    alignment: flipbook.alignment,
    settings,
    background,
    backgroundStamp,
  });
  const [result, setResult] = useState<{ key: string; src: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onChange = useRef(input.onChange);
  onChange.current = input.onChange;
  const request = useRef({ flipbook, settings, background });
  request.current = { flipbook, settings, background };

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // Scrubbing a control does not queue a render for every pointer movement.
    const timer = setTimeout(() => {
      const value = request.current;
      void flipbookApi
        .export(
          value.flipbook.id,
          {
            format: "mp4",
            settings: value.settings,
            background:
              value.background.kind === "transparent"
                ? { kind: "color", color: "#ffffff" }
                : value.background,
          },
          controller.signal,
        )
        .then(({ flipbook: updated, record }) => {
          if (controller.signal.aborted) return;
          setResult({ key, src: record.files[0].url });
          setFailure(null);
          onChange.current(updated);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setFailure({
              key,
              message:
                cause instanceof Error
                  ? cause.message
                  : "The smooth preview couldn’t be prepared.",
            });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, key, attempt]);

  const error = enabled && failure?.key === key ? failure.message : null;
  return {
    src: enabled && result?.key === key ? result.src : undefined,
    busy: enabled && result?.key !== key && !error,
    error,
    retry: () => {
      setFailure(null);
      setAttempt((value) => value + 1);
    },
  };
}
