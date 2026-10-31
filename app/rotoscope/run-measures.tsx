"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/ui/media-image";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/toast-provider";
import { measuresText, rotoscopeUrls, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { draftOf, MeasuresFields, parseMeasures, type MeasuresDraft } from "./measures-fields";
import { rotoscopeApi } from "./rotoscope-client";
import styles from "./rotoscope.module.css";

/**
 * The character's body for this run: its height and weight (every prompt says them), the video person's height (the
 * size ratio), the refit that puts the drawings on the person's own figure, and the reference poses drawn before it.
 */
export function RunMeasures({ run, disabled, onChange }: { readonly run: RotoscopeRun; readonly disabled: boolean; readonly onChange: (run: RotoscopeRun) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<MeasuresDraft>(() => draftOf(run.measures));
  const [saving, setSaving] = useState(false);
  const [refitting, setRefitting] = useState(false);
  const parsed = parseMeasures(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(draftOf(run.measures));
  const save = async () => {
    if (!("measures" in parsed)) return;
    setSaving(true);
    try {
      const updated = await rotoscopeApi.measure(run.id, parsed.measures);
      onChange(updated);
      setDraft(draftOf(updated.measures));
      toast({ title: "Measures saved", description: "The next drawings’ prompts say them. Refit to draw at the new height ratio.", status: "success" });
    } catch (cause) {
      toast({ title: "Couldn’t save the measures", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setSaving(false);
    }
  };
  const refit = async () => {
    setRefitting(true);
    try {
      onChange(await rotoscopeApi.refit(run.id));
      toast({ title: "Refitted to the video person", description: "Every drawing now stands on the person’s own height. The old files are kept on the server.", status: "success" });
    } catch (cause) {
      toast({ title: "Couldn’t refit", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setRefitting(false);
    }
  };
  return (
    <section className={fb.panel} aria-labelledby="ro-measures">
      <div className={fb.panelHead}><h2 id="ro-measures" className={fb.panelTitle}>Body &amp; size</h2></div>
      <p className={fb.hint}>{measuresText(run.measures) ? `The character is ${measuresText(run.measures)}: every drawing’s prompt says so.` : "No height or weight yet: give them and every drawing’s prompt keeps that body."} The video person’s height scales the character against them; left empty, it is drawn exactly as tall.</p>
      <MeasuresFields id="ro-run-measures" value={draft} fields={["heightCm", "weightKg", "personHeightCm"]} disabled={disabled || saving} onChange={setDraft} />
      {"error" in parsed ? <p className={fb.hint}>{parsed.error}</p> : null}
      {changed ? (
        <Button size="sm" variant="outline" className="w-fit" disabled={disabled || saving || "error" in parsed} onClick={() => void save()}>
          {saving ? <Spinner className="size-3.5" /> : null}Save measures
        </Button>
      ) : null}
      <div className={styles.optionRow}>
        <span>
          <span className="block text-foreground">{run.fitsPerson ? "Stands on the video person" : "Drawn larger than the video person"}</span>
          <span className="block text-muted-foreground">{run.fitsPerson
            ? "Each drawing spans the person’s own hair top to soles, times the height ratio. After changing the heights, refit to move the drawings to the new size."
            : "This run was laid out before: its character is the person’s skeleton with the sheet’s bigger head and feet added, about an eighth taller than the person. Refit moves every drawing onto the person’s height (no AI call; the old files are kept)."}</span>
        </span>
        <Button size="sm" variant={run.fitsPerson ? "outline" : "ai"} disabled={disabled || refitting || changed} onClick={() => void refit()}>
          {refitting ? <Spinner className="size-3.5" /> : null}Refit
        </Button>
      </div>
      {run.poseSheet ? (
        <figure className={styles.poseSheet}>
          <span className={fb.referenceImage}><MediaImage src={rotoscopeUrls.media(run.id, "posesheet")} alt="The character in four other poses" /></span>
          <figcaption className={fb.hint}>Reference poses: shown with every drawing and review, so joints bend only as far as here.</figcaption>
        </figure>
      ) : null}
    </section>
  );
}
