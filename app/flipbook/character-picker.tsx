"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Skeleton } from "../../components/ui/skeleton";
import type { CharacterSummary } from "../../shared/characters";
import { useSession } from "../_auth/session-client";
import { characterApi } from "../characters/character-client";
import styles from "./flipbook.module.css";

/** Start from a saved character: its selected version, one click away. */
export function CharacterPicker() {
  const { session } = useSession();
  const signedIn = Boolean(session?.user);
  const [list, setList] = useState<CharacterSummary[] | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    characterApi.list().then((next) => live && setList(next)).catch(() => live && setList([]));
    return () => { live = false; };
  }, [signedIn]);

  const ready = list?.filter((entry) => entry.status !== "generating" && entry.selectedVersionId) ?? [];

  return (
    <section className={styles.picker} aria-labelledby="picker-title">
      <div className={styles.pickerHead}>
        <h2 id="picker-title" className={styles.sectionLabel}>My characters</h2>
        <span className="flex items-center gap-3">
          {signedIn && ready.length >= 2 ? (
            <Link href="/flipbook?together=1" className={styles.pickerAll}>
              Animate together
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} />
            </Link>
          ) : null}
          <Link href="/characters" className={styles.pickerAll}>
            {signedIn && ready.length ? "See all" : "Open my characters"}
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} />
          </Link>
        </span>
      </div>
      {signedIn && list === null ? (
        <div className={styles.pickerRow} aria-busy="true"><Skeleton className={styles.pickerSkeleton} /><Skeleton className={styles.pickerSkeleton} /></div>
      ) : ready.length ? (
        <ul className={styles.pickerRow}>
          {ready.map((entry) => (
            <li key={entry.id}>
              <Link href={`/flipbook?character=${entry.id}&version=${entry.selectedVersionId}`} className={styles.pickerItem}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the character's cover, from the media route */}
                <img src={entry.coverUrl} alt="" className={styles.pickerCover} />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-foreground">{entry.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{entry.versions} {entry.versions === 1 ? "version" : "versions"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.pickerEmpty}>
          <HugeiconsIcon icon={UserGroupIcon} size={14} strokeWidth={1.75} />
          {signedIn ? "Design a character once, then animate any version of it." : "Sign in to keep your characters and animate any version of them."}
        </p>
      )}
    </section>
  );
}
