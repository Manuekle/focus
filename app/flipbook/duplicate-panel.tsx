"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import type { Character, CharacterSummary, CharacterSource } from "../../shared/characters";
import { IMAGE_ACCEPT_ATTRIBUTE, type Flipbook } from "../../shared/flipbook";
import { characterApi } from "../characters/character-client";
import { useSession } from "../_auth/session-client";
import { flipbookApi, uploadCharacter } from "./flipbook-client";
import styles from "./flipbook.module.css";

export function DuplicatePanel({ flipbook, disabled, onCreated }: { flipbook: Flipbook; disabled: boolean; onCreated: (copy: Flipbook) => void }) {
  const { session } = useSession();
  const [list, setList] = useState<CharacterSummary[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [versionId, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const signedIn = Boolean(session?.user);
  useEffect(() => { if (signedIn) void characterApi.list().then(setList).catch(() => setList([])); }, [signedIn]);
  const run = async (target: { characterSource?: CharacterSource; imageId?: string }) => {
    setBusy(true); setError("");
    try { onCreated(await flipbookApi.duplicate(flipbook.id, target)); }
    catch (error) { setError(error instanceof Error ? error.message : "The copy could not be prepared."); }
    finally { setBusy(false); }
  };
  return <section className={styles.panel} aria-labelledby="duplicate-title">
    <h2 id="duplicate-title" className={styles.panelTitle}>Duplicate with another character</h2>
    <p className={styles.hint}>Keep this animation and create an independent copy with the same movement, timing, background and audio. The copy needs {flipbook.frames.length} new drawings; it opens before drawing starts.</p>
    {signedIn ? <>
      <label className={styles.field}>Character<select className={styles.fieldInput} disabled={disabled || busy} value={character?.id ?? ""} onChange={async (event) => { const id = event.target.value; setCharacter(null); setVersion(""); if (!id) return; setBusy(true); try { const next = await characterApi.get(id); setCharacter(next); setVersion(next.selectedVersionId ?? next.versions[0]?.id ?? ""); } catch (error) { setError(error instanceof Error ? error.message : "Could not open this character."); } finally { setBusy(false); } }}><option value="">Choose a character…</option>{list.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      {character ? <label className={styles.field}>Version<select className={styles.fieldInput} value={versionId} onChange={(event) => setVersion(event.target.value)} disabled={busy || disabled}>{character.versions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label> : null}
      <Button size="sm" disabled={disabled || busy || !character || !versionId} onClick={() => void run({ characterSource: { characterId: character!.id, versionId } })}>{busy ? "Preparing copy…" : "Create character copy"}</Button>
    </> : null}
    <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => input.current?.click()}>Use another illustration</Button>
    <input ref={input} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; setBusy(true); setError(""); try { const uploaded = await uploadCharacter(file, () => undefined).promise; await run({ imageId: uploaded.id }); } catch (error) { setError(error instanceof Error ? error.message : "Upload failed."); } finally { setBusy(false); } }} />
    {error ? <p role="alert" className={styles.hint}>{error}</p> : null}
  </section>;
}
