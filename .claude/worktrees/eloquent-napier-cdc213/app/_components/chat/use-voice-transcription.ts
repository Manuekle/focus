"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  supportsVoiceDictation,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionResultEvent,
} from "@/lib/voice-dictation";

export type VoiceDictationError =
  | "unsupported"
  | "not-allowed"
  | "audio-capture"
  | "network"
  | "no-speech"
  | "aborted"
  | "start-failed";

/**
 * Real-time voice dictation through the browser's Web Speech recognition.
 *
 * Final transcripts are handed to `onFinalChunk` so the caller can commit
 * them into its own state (the chat composer); interim transcripts are
 * exposed as state for progressive display and are never committed, so a
 * final result can never duplicate text that is already shown.
 *
 * Chrome ends a recognition session after a pause — when the session is
 * still wanted (`isListening`) an unexpected `onend` restarts it. An
 * intentional `stopListening` (or a permission/device failure) never
 * restarts.
 */
export function useVoiceTranscription(opts: {
  readonly lang: string;
  readonly onFinalChunk: (chunk: string) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<VoiceDictationError | null>(null);

  const recognitionRef = useRef<import("@/lib/voice-dictation").SpeechRecognitionInstance | null>(null);
  // True while the person wants to keep dictating — separates an
  // intentional stop from the browser ending the session on its own.
  const shouldKeepListeningRef = useRef(false);
  // A permission/device failure must not spin into a restart loop.
  const fatalErrorRef = useRef(false);
  const onFinalChunkRef = useRef(opts.onFinalChunk);
  const langRef = useRef(opts.lang);
  // Recognition events always fire after effects flush, so the latest
  // callback and language are in place before any result can arrive.
  useEffect(() => {
    onFinalChunkRef.current = opts.onFinalChunk;
    langRef.current = opts.lang;
  });

  useEffect(() => {
    setIsSupported(supportsVoiceDictation());
  }, []);

  const startListening = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    if (recognitionRef.current) return;

    setError(null);
    setInterimTranscript("");
    fatalErrorRef.current = false;
    shouldKeepListeningRef.current = true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalTranscript.trim()) {
        onFinalChunkRef.current(finalTranscript);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error;
      // Silence and manual aborts are part of dictating, not failures.
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        fatalErrorRef.current = true;
        shouldKeepListeningRef.current = false;
        setError("not-allowed");
        return;
      }
      if (code === "audio-capture") {
        fatalErrorRef.current = true;
        shouldKeepListeningRef.current = false;
        setError("audio-capture");
        return;
      }
      setError("network");
    };

    recognition.onend = () => {
      // The browser closed the session on its own (pause timeout) while
      // dictation is still wanted — open it again on the same instance.
      if (shouldKeepListeningRef.current && !fatalErrorRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          // Falls through to idle below; the person can tap the mic again.
        }
      }
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      shouldKeepListeningRef.current = false;
      setError("start-failed");
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    setInterimTranscript("");
    const recognition = recognitionRef.current;
    if (recognition) {
      // `stop()` still delivers pending finals through `onresult` before
      // `onend`, so nothing dictated is lost.
      try {
        recognition.stop();
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
      }
    } else {
      setIsListening(false);
    }
  }, []);

  // Never leave a session running after navigating away.
  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // Already stopped — nothing to do.
        }
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    error,
  };
}
