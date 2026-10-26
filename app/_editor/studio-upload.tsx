"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload, type FileUploadItem } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { EASE_OUT } from "../../lib/ease";
import { ACCEPT_ATTRIBUTE, MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, formatBytes } from "../../shared/media";
import styles from "./studio-upload.module.css";

export type UploadPhase = "checking" | "sending" | "preparing";

function UploadCamera({ width }: { readonly width: number }) {
  return <Image src="/brand/upload-camera.svg" alt="" width={width} height={Math.round(width * 384 / 456)} unoptimized draggable={false} data-studio-camera="" />;
}

export function StudioUpload({ item, phase, onFile, onCancel }: {
  readonly item?: FileUploadItem;
  readonly phase?: UploadPhase;
  readonly onFile: (file: File) => void;
  readonly onCancel: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const progress = item?.progress ?? 0;
  const label = phase === "checking" ? "Checking your clip…" : phase === "preparing" ? "Preparing your clip…" : "Uploading your clip…";

  if (!item) return (
    <div className={styles.dropPane}>
      <FileUpload
        variant="centered"
        multiple={false}
        maxFiles={1}
        accept={ACCEPT_ATTRIBUTE}
        value={[]}
        onFilesAdded={(_items, files) => { if (files[0]) onFile(files[0]); }}
        title="Drop your video here"
        dropzoneIcon={<UploadCamera width={112} />}
        description={`MP4 or MOV · up to ${MAX_DURATION_SECONDS}s · ${formatBytes(MAX_UPLOAD_BYTES)} max`}
        browseLabel="Choose a video"
        browseVariant="default"
        classNames={{ root: styles.upload, dropzone: styles.dropzone }}
      />
      <p className={styles.next}>Add a clip. The creative part comes next.</p>
    </div>
  );

  return (
    <div className={styles.uploadPane}>
      <div className={`${styles.uploadCard} backdrop-blur-xl`} aria-busy="true">
        <div className={styles.fileRow}>
          <span className={styles.fileIcon} aria-hidden="true"><UploadCamera width={44} /></span>
          <div className={styles.fileDetails}>
            <p className={styles.fileName} title={item.name}>{item.name}</p>
            <p className={styles.fileMeta}>{formatBytes(item.size)} · Video</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Cancel upload" onClick={onCancel}><HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} /></Button>
        </div>
        <div className={styles.progressLabel}>
          <span><Spinner />{label}</span>
          {phase === "sending" ? <span className={styles.percentage}>{progress}%</span> : null}
        </div>
        <div
          role="progressbar"
          aria-label="Video upload"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === "sending" ? progress : undefined}
          aria-valuetext={phase === "sending" ? `${progress}% uploaded` : label}
          className={styles.track}
        >
          <motion.div
            className={styles.fill}
            initial={false}
            animate={{ scaleX: phase === "preparing" ? 1 : progress / 100 }}
            transition={{ duration: reducedMotion ? 0 : 0.15, ease: EASE_OUT }}
          />
        </div>
        <p className={styles.uploadNote}>Your editing options are up next.</p>
      </div>
    </div>
  );
}
