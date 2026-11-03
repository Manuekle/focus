"use client";

import { useCallback, useRef, useState } from "react";
import { wholeClip, type CutSegment } from "../../shared/cut";

const HISTORY_LIMIT = 100;

type History = { readonly past: readonly CutSegment[][]; readonly present: CutSegment[]; readonly future: readonly CutSegment[][] };

/**
 * The timeline's cut list with undo and redo. `preview` changes the list
 * without a history entry (a trim handle mid-drag); `commit` records the
 * state the drag started from, so one drag is one undo step.
 */
export function useCut(duration: number) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: wholeClip(duration), future: [] }));
  const dragFrom = useRef<CutSegment[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((change: (segments: CutSegment[]) => CutSegment[]) => {
    setHistory(({ past, present }) => {
      const next = change(present);
      if (JSON.stringify(next) === JSON.stringify(present)) return { past, present, future: [] };
      return { past: [...past, present].slice(-HISTORY_LIMIT), present: next, future: [] };
    });
  }, []);

  const preview = useCallback((change: (segments: CutSegment[]) => CutSegment[]) => {
    if (!dragFrom.current) {
      dragFrom.current = history.present;
      setDragging(true);
    }
    setHistory((current) => ({ ...current, present: change(current.present) }));
  }, [history.present]);

  const commit = useCallback(() => {
    const from = dragFrom.current;
    if (!from) return;
    dragFrom.current = null;
    setDragging(false);
    setHistory(({ past, present, future }) => (JSON.stringify(from) === JSON.stringify(present) ? { past, present, future } : { past: [...past, from].slice(-HISTORY_LIMIT), present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setHistory(({ past, present, future }) => (past.length ? { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] } : { past, present, future }));
  }, []);

  const redo = useCallback(() => {
    setHistory(({ past, present, future }) => (future.length ? { past: [...past, present], present: future[0], future: future.slice(1) } : { past, present, future }));
  }, []);

  return {
    segments: history.present,
    apply,
    preview,
    commit,
    undo,
    redo,
    canUndo: history.past.length > 0 && !dragging,
    canRedo: history.future.length > 0 && !dragging,
  };
}
