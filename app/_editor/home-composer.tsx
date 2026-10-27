"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { formatBytes } from "../../shared/media";
import type { EffectId, Suggestions, VideoAsset } from "../../shared/schemas";
import { SuggestionsSchema } from "../../shared/schemas";
import { LoginDialog } from "../_auth/login-dialog";
import { useSession } from "../_auth/session-client";
import { Composer } from "./composer";
import { saveDraft } from "./draft";
import { VideoStage } from "./video-stage";
import styles from "./editor-view.module.css";

/**
 * The home page's last step: the clip and the instruction. Generating opens
 * the full editor, which picks up the clip, the words and the effect from
 * localStorage and starts right away. With no free edits left, Facebook
 * sign-in comes first; the draft waits in localStorage through it.
 */
export function HomeComposer({
  video,
  effect,
  onEffectChange,
  prompt,
  onPromptChange,
  onReset,
}: {
  readonly video: VideoAsset;
  readonly effect: EffectId;
  readonly onEffectChange: (effect: EffectId) => void;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onReset: () => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const editorUrl = `/editor?v=${video.id}`;
  const outOfFreeEdits = Boolean(session && !session.user && session.quota?.remaining === 0);

  const [suggestions, setSuggestions] = useState<{ videoId: string; value: Suggestions | null } | null>(null);
  useEffect(() => {
    let canceled = false;
    fetch(`/api/videos/${video.id}/suggestions`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const parsed = SuggestionsSchema.safeParse(body);
        if (!canceled) setSuggestions({ videoId: video.id, value: parsed.success ? parsed.data : null });
      })
      .catch(() => { if (!canceled) setSuggestions({ videoId: video.id, value: null }); });
    return () => { canceled = true; };
  }, [video.id]);

  const handOff = (autostart: boolean) => {
    saveDraft({ videoId: video.id, prompt, effect, autostart });
    if (autostart && outOfFreeEdits) {
      setLoginOpen(true);
      return;
    }
    setLeaving(true);
    router.push(editorUrl);
  };

  return (
    <section id="editor" aria-label="Clip ready" className={styles.editor}>
      <section aria-label="Video" className={styles.preview}>
        <VideoStage key={video.id} video={video} />
        <div className={styles.fileRow}>
          <div className={styles.fileDetails}>
            <p className={styles.fileName} title={video.originalName}>{video.originalName}</p>
            <p className={styles.fileMeta}>{video.source.width}×{video.source.height} · {video.source.durationSeconds.toFixed(1)}s · {formatBytes(video.source.sizeBytes)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} aria-label="Change clip">
            <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.5} />Change clip
          </Button>
        </div>
      </section>

      <aside className={styles.controls}>
        <h2 className={styles.heading}>Make it your own.</h2>
        <Composer
          effect={effect}
          onEffectChange={onEffectChange}
          prompt={prompt}
          onPromptChange={onPromptChange}
          onSubmit={() => handOff(true)}
          canSubmit={!leaving}
          blockedReason={outOfFreeEdits ? "You’ve used your free edits. Sign in with Facebook to keep going." : undefined}
          busy={leaving}
          suggestions={suggestions?.videoId === video.id ? suggestions.value : null}
          suggestionsLoading={suggestions?.videoId !== video.id}
        />
        <p className="-mt-2 text-xs leading-5 text-muted-foreground">
          {session?.user
            ? "Opens the full editor. Your edits are saved to your projects."
            : session?.quota
              ? `Opens the full editor · ${session.quota.remaining} of ${session.quota.limit} free edits left.`
              : "Opens the full editor."}{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => handOff(false)}>
            Open the editor without generating
          </button>
        </p>
      </aside>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} next={editorUrl} reason="quota" />
    </section>
  );
}
